import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockCodeIndex, MockLLMProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// MockCodeIndex.symbols() → path 'src/middleware/ratelimit.ts'. Provide that file
// so the extractor can read + ground the snippet.
const EVIDENCE_FILE = 'src/middleware/ratelimit.ts';
const FILE_CONTENT =
  'export function rateLimit(req) {\n  const bucketKey = bucketKey(req.ip);\n  return redis.incr(bucketKey);\n}';

d('A1 conventions extractor (MockLLM candidates + evidence grounding)', () => {
  let pg: PgFixture;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId } = await seed(pg.handle.db);
    // reuse the seeded demo repo; ensure it has a clone path for extraction
    const [repo] = await pg.handle.db
      .update(t.repos)
      .set({ clonePath: '/mock/clones/acme/payments-api' })
      .where(eq(t.repos.fullName, 'acme/payments-api'))
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWithMocks() {
    const llm = new MockLLMProvider('openai', {
      structured: {
        conventions: [
          {
            rule: 'Rate-limit buckets are keyed by client IP.',
            evidence_path: EVIDENCE_FILE,
            evidence_snippet: 'const bucketKey = bucketKey(req.ip);',
            confidence: 0.92,
          },
          {
            // hallucinated path → must be dropped by grounding
            rule: 'All handlers log to stdout.',
            evidence_path: 'src/does/not/exist.ts',
            evidence_snippet: 'console.log(x)',
            confidence: 0.8,
          },
        ],
      },
    });
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        llm: { openai: llm },
        git: new MockGitClient({ files: { [EVIDENCE_FILE]: FILE_CONTENT } }),
        codeIndex: new MockCodeIndex(),
      },
    });
  }

  it('POST /repos/:id/conventions/extract returns grounded candidates with evidence', async () => {
    const app = await appWithMocks();
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const candidates = res.json();
    // hallucinated path dropped → only the grounded one survives
    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    expect(c.evidence_path).toBe(EVIDENCE_FILE);
    expect(c.evidence_snippet).toContain('bucketKey');
    expect(c.confidence).toBeGreaterThan(0.8); // snippet found verbatim → kept high
    expect(c.accepted).toBe(false);
    await app.close();
  });

  it('POST /conventions/:id/accept marks accepted AND creates an extracted Skill', async () => {
    const app = await appWithMocks();
    const candidates = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} })
    ).json();
    const id = candidates[0].id;

    const accept = await app.inject({ method: 'POST', url: `/conventions/${id}/accept` });
    expect(accept.statusCode).toBe(200);
    const skillId = accept.json().skill_id;
    expect(skillId).toBeTruthy();

    const [skill] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, skillId));
    expect(skill!.source).toBe('extracted');
    expect(skill!.type).toBe('convention');

    // accepted candidate survives a re-extract (only un-accepted are cleared)
    const reextract = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} })
    ).json();
    const list = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    expect(list.some((x: { id: string; accepted: boolean }) => x.accepted)).toBe(true);
    expect(reextract.length).toBeGreaterThanOrEqual(0);
    await app.close();
  });
});
