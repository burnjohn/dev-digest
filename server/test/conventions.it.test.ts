import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * The Conventions Extractor end to end: a code-picked sample goes to the model,
 * the code-side evidence gate drops what the model could not ground, the user
 * triages what is left, and the accepted rules assemble into a skill draft.
 *
 * The model is a fixture, so this test is really about the two halves AROUND
 * it — which is where the feature's correctness lives.
 */
const USERS_TS = [
  'import { db } from "../db";',
  '',
  'export async function getUser(id: string) {',
  '  const user = await db.users.find(id);',
  '  if (!user) throw new NotFoundError("User not found");',
  '  return user;',
  '}',
].join('\n');

/** Two grounded candidates and one invented one — the gate must split them. */
const EXTRACTION = {
  candidates: [
    {
      category: 'errors',
      rule: 'Throw NotFoundError for a missing row instead of returning null',
      rationale: 'Callers rely on the throw, never on a null check.',
      evidence_path: 'src/api/users.ts',
      evidence_line: 5,
      evidence_snippet: '  if (!user) throw new NotFoundError("User not found");',
      occurrences: 4,
      confidence: 0.9,
    },
    {
      category: 'imports',
      rule: 'Relative imports omit the file extension',
      rationale: 'Matches the bundler resolution the repo assumes.',
      evidence_path: 'src/api/users.ts',
      evidence_line: 1,
      evidence_snippet: 'import { db } from "../db";',
      occurrences: 2,
      confidence: 0.7,
    },
    {
      category: 'api',
      rule: 'All route handlers return Result<T, ApiError>',
      rationale: 'Invented — this code is nowhere in the sample.',
      evidence_path: 'src/api/users.ts',
      evidence_line: 4,
      evidence_snippet: 'function handler(): Result<Item[], ApiError> {',
      occurrences: 6,
      confidence: 0.95,
    },
  ],
};

d('conventions module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      // The seed already owns `acme/payments-api`; this suite needs its own row.
      .values({ workspaceId, owner: 'acme', name: 'billing-api', fullName: 'acme/billing-api' })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** Only `getConventionSamples` is exercised; the rest of the facade is unused here. */
  const repoIntel = {
    getConventionSamples: async () => ['src/api/users.ts'],
  } as unknown as RepoIntel;

  function makeApp(structured: unknown = EXTRACTION) {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        repoIntel,
        git: new MockGitClient({
          files: { 'src/api/users.ts': USERS_TS, 'package.json': '{ "type": "module" }' },
        }),
        llm: { openai: new MockLLMProvider('openai', { structured }) },
      },
    });
  }

  it('samples in code, then drops the candidate whose snippet is not in the file', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.proposed).toBe(3);
    expect(body.dropped_ungrounded).toBe(1);
    expect(body.candidates).toHaveLength(2);
    expect(body.candidates.map((c: { rule: string }) => c.rule)).not.toContain(
      'All route handlers return Result<T, ApiError>',
    );
    // The sample is what code chose: the config wish-list plus repo-intel's pick.
    expect(body.sampled_files).toContain('package.json');
    expect(body.sampled_files).toContain('src/api/users.ts');
    // Highest confidence first, and every survivor carries a real line number.
    expect(body.candidates[0].confidence).toBeGreaterThanOrEqual(body.candidates[1].confidence);
    expect(body.candidates[0].evidence_line).toBe(5);
    expect(body.candidates.every((c: { status: string }) => c.status === 'pending')).toBe(true);

    await app.close();
  });

  it('keeps the user’s decisions across a re-scan and never re-proposes them', async () => {
    const app = await makeApp();
    const first = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json();
    const [accept, reject] = first.candidates;

    await app.inject({ method: 'PATCH', url: `/conventions/${accept.id}`, payload: { status: 'accepted' } });
    await app.inject({ method: 'PATCH', url: `/conventions/${reject.id}`, payload: { status: 'rejected' } });

    const second = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json();

    // Both rules were proposed again and both were suppressed as duplicates of
    // a decision already made; the rows themselves keep their status and id.
    expect(second.dropped_duplicate).toBe(2);
    expect(second.candidates).toHaveLength(2);
    const byId = new Map(second.candidates.map((c: { id: string }) => [c.id, c]));
    expect((byId.get(accept.id) as { status: string }).status).toBe('accepted');
    expect((byId.get(reject.id) as { status: string }).status).toBe('rejected');

    await app.close();
  });

  it('edits a rule and builds a skill draft from the accepted ones only', async () => {
    const app = await makeApp();
    const listed = (await app.inject({ url: `/repos/${repoId}/conventions` })).json();
    const accepted = listed.find((c: { status: string }) => c.status === 'accepted');

    const edited = (
      await app.inject({
        method: 'PATCH',
        url: `/conventions/${accepted.id}`,
        payload: { rule: 'Throw NotFoundError for a missing row' },
      })
    ).json();
    expect(edited.rule).toBe('Throw NotFoundError for a missing row');

    const draft = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/skill`, payload: {} })
    ).json();
    expect(draft.name).toBe('billing-api-conventions');
    expect(draft.type).toBe('convention');
    expect(draft.body).toContain('Throw NotFoundError for a missing row');
    expect(draft.body).toContain('Detected in `src/api/users.ts:5`:');
    expect(draft.convention_ids).toEqual([accepted.id]);

    // The draft is a preview: nothing was written to /skills by building it.
    const skills = (await app.inject({ url: '/skills' })).json();
    expect(skills.some((s: { name: string }) => s.name === 'billing-api-conventions')).toBe(false);

    // …and the ordinary create route persists it, source-tagged as extracted.
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: draft.name,
        description: draft.description,
        type: draft.type,
        body: draft.body,
        source: 'extracted',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().source).toBe('extracted');

    await app.close();
  });

  it('refuses to draft a skill when nothing is accepted', async () => {
    const app = await makeApp();
    const [other] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'ledger', fullName: 'acme/ledger' })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${other!.id}/conventions/skill`,
      payload: {},
    });
    // ValidationError → 422 in this app's error handler, not 400.
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('reports an unsampleable repo instead of calling the model', async () => {
    const app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        repoIntel: { getConventionSamples: async () => [] } as unknown as RepoIntel,
        git: new MockGitClient({ files: {} }),
        llm: { openai: new MockLLMProvider('openai', { structured: EXTRACTION }) },
      },
    });
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/clone|index|sample/i);

    await app.close();
  });
});
