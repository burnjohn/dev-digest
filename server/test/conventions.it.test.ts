import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * Conventions extraction — end-to-end over a real Postgres.
 *
 * Covers the things that only break in SQL and wiring: the code-only
 * evidence gate dropping an out-of-bounds candidate before it ever reaches
 * the DB, PATCH covering both the accept toggle and rule/category edits, and
 * a re-scan deleting stale PENDING rows while leaving accepted ones alone.
 */
d('conventions', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonePath: string;
  let repoId: string;
  let uncloneRepoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    clonePath = await mkdtemp(join(tmpdir(), 'devdigest-conventions-it-'));
    await mkdir(join(clonePath, 'src'), { recursive: true });
    await writeFile(join(clonePath, 'tsconfig.json'), '{}');
    await writeFile(
      join(clonePath, 'src', 'a.ts'),
      Array.from({ length: 8 }, (_, i) => `// a-line ${i + 1}`).join('\n'),
    );
    await writeFile(
      join(clonePath, 'src', 'b.ts'),
      Array.from({ length: 4 }, (_, i) => `// b-line ${i + 1}`).join('\n'),
    );

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'conventions-fixture',
        fullName: 'acme/conventions-fixture',
        clonePath,
      })
      .returning();
    if (!repo) throw new Error('failed to insert fixture repo');
    repoId = repo.id;

    const [uncloned] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'uncloned-fixture',
        fullName: 'acme/uncloned-fixture',
        clonePath: null,
      })
      .returning();
    if (!uncloned) throw new Error('failed to insert uncloned fixture repo');
    uncloneRepoId = uncloned.id;
  });

  afterAll(async () => {
    await pg?.stop();
    if (clonePath) await rm(clonePath, { recursive: true, force: true });
  });

  /** Minimal repo-intel stub — only getConventionSamples is called by the module under test. */
  function fakeRepoIntel(samplePaths: string[]): RepoIntel {
    return { getConventionSamples: async () => samplePaths } as unknown as RepoIntel;
  }

  function makeApp(opts: { llm: MockLLMProvider; samplePaths: string[] }) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openrouter: opts.llm },
        repoIntel: fakeRepoIntel(opts.samplePaths),
      },
    });
  }

  it('grounds candidates against disk: keeps in-bounds ones, drops an out-of-bounds one, never persists the model paraphrase', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        ConventionCandidates: {
          candidates: [
            {
              category: 'comments',
              rule: 'Rule A1 - keep after accept',
              evidence_path: 'src/a.ts',
              evidence_start_line: 2,
              evidence_end_line: 3,
              evidence_snippet: 'the model made this up',
              confidence: 0.9,
            },
            {
              category: 'comments',
              rule: 'Rule A2 - should be deleted on rescan',
              evidence_path: 'src/a.ts',
              evidence_start_line: 5,
              evidence_end_line: 6,
              evidence_snippet: 'also made up',
              confidence: 0.6,
            },
            {
              category: 'comments',
              rule: 'Rule hallucinated line range',
              evidence_path: 'src/a.ts',
              evidence_start_line: 900,
              evidence_end_line: 901,
              evidence_snippet: 'never real',
              confidence: 0.5,
            },
          ],
        },
      },
    });
    const app = await makeApp({ llm, samplePaths: ['src/a.ts'] });

    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    const scan = res.json();

    expect(scan.candidates).toHaveLength(2);
    expect(scan.sampled_files).toBe(2); // tsconfig.json + src/a.ts
    expect(scan.scanned_at).toEqual(expect.any(String));

    const a1 = scan.candidates.find((c: { rule: string }) => c.rule === 'Rule A1 - keep after accept');
    expect(a1.evidence_snippet).toBe('// a-line 2\n// a-line 3');
    expect(a1.evidence_snippet).not.toContain('made up');
    expect(a1.accepted).toBe(false);

    await app.close();
  });

  it('GET returns the same scan without another LLM call', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { ConventionCandidates: { candidates: [] } } });
    const app = await makeApp({ llm, samplePaths: [] });

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(res.statusCode).toBe(200);
    expect(res.json().candidates).toHaveLength(2);
    expect(llm.calls).toHaveLength(0);

    await app.close();
  });

  it('PATCH accepts a candidate, and separately edits its rule/category', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { ConventionCandidates: { candidates: [] } } });
    const app = await makeApp({ llm, samplePaths: [] });

    const before = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    const a1 = before.json().candidates.find((c: { rule: string }) => c.rule === 'Rule A1 - keep after accept');

    const accepted = await app.inject({
      method: 'PATCH',
      url: `/conventions/${a1.id}`,
      payload: { accepted: true },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().accepted).toBe(true);
    expect(accepted.json().rule).toBe('Rule A1 - keep after accept');

    const edited = await app.inject({
      method: 'PATCH',
      url: `/conventions/${a1.id}`,
      payload: { rule: 'Rule A1 - edited by user', category: 'renamed-category' },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().rule).toBe('Rule A1 - edited by user');
    expect(edited.json().category).toBe('renamed-category');
    // Editing text must not silently flip the accept decision.
    expect(edited.json().accepted).toBe(true);

    const missing = await app.inject({
      method: 'PATCH',
      url: `/conventions/00000000-0000-0000-0000-000000000000`,
      payload: { accepted: false },
    });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  it('re-scan deletes the stale pending candidate but keeps the accepted one', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        ConventionCandidates: {
          candidates: [
            {
              category: 'comments',
              rule: 'Rule B - fresh from rescan',
              evidence_path: 'src/b.ts',
              evidence_start_line: 2,
              evidence_end_line: 3,
              evidence_snippet: 'made up again',
              confidence: 0.7,
            },
          ],
        },
      },
    });
    const app = await makeApp({ llm, samplePaths: ['src/b.ts'] });

    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    const rules = res.json().candidates.map((c: { rule: string }) => c.rule);

    expect(rules).toContain('Rule A1 - edited by user'); // accepted, survives re-scan
    expect(rules).toContain('Rule B - fresh from rescan'); // freshly inserted
    expect(rules).not.toContain('Rule A2 - should be deleted on rescan'); // stale pending, deleted

    await app.close();
  });

  it('refuses to extract for a repo that has not been cloned yet', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { ConventionCandidates: { candidates: [] } } });
    const app = await makeApp({ llm, samplePaths: [] });

    const res = await app.inject({ method: 'POST', url: `/repos/${uncloneRepoId}/conventions/extract` });
    expect(res.statusCode).toBe(422);

    await app.close();
  });
});
