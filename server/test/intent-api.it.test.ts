/**
 * PR intent: the service's cache-first `getOrClassifyIntent` (REQ-8) and the
 * two routes it backs (REQ-10) — `GET /pulls/:id/intent` (purely read-only,
 * 404 when absent, never classifies) and `POST /pulls/:id/intent` (get-or-
 * create; `{ force: true }` is the only path that re-classifies). Gated on
 * Docker (needs Postgres). Every case asserts on the injected
 * `MockLLMProvider('openrouter', …)`'s recorded `completeStructured` call
 * count — never on wall-clock or "it didn't throw" alone.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { hermeticOverrides, intentLlm, INTENT_FIXTURE } from './helpers/overrides.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { ReviewService } from '../src/modules/reviews/service.js';
import { upsertIntent } from '../src/modules/reviews/repository/pull.repo.js';
import type { ClassifiedIntent } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `intent-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: repoSeq,
      title: `PR #${repoSeq}`,
      author: 'octocat',
      branch: `feat/${repoSeq}`,
      base: 'main',
      headSha: `sha${repoSeq}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
      body: 'Add rate limiting.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

/** Just the completeStructured calls — listModels/embed noise excluded. */
function structuredCalls(llm: MockLLMProvider) {
  return llm.calls.filter((c) => c.method === 'completeStructured');
}

/** The shape `fallbackIntent()` in intent-classifier.ts produces (REQ-7):
 *  low confidence, no sources, `model: null` when persisted — used here to
 *  pre-seed a row directly via `upsertIntent`, bypassing classification. */
const FALLBACK_INTENT: ClassifiedIntent = {
  intent: 'Fallback intent from title + file names.',
  in_scope: [],
  out_of_scope: [],
  confidence: 'low',
  sources: [],
};

d('PR intent: getOrClassifyIntent + GET/POST /pulls/:id/intent (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(llm: MockLLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: hermeticOverrides({
        git: new MockGitClient({ diff: DIFF }),
        llm: { openrouter: llm },
      }),
    });
  }

  it('REQ-8: getOrClassifyIntent classifies once; a second call with no force makes ZERO more model calls', async () => {
    const llm = intentLlm();
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const service = new ReviewService(app.container);

    const first = await service.getOrClassifyIntent(workspaceId, pr.id);
    expect(structuredCalls(llm)).toHaveLength(1);
    expect(first.intent).toBe(INTENT_FIXTURE.intent);

    const second = await service.getOrClassifyIntent(workspaceId, pr.id);
    expect(structuredCalls(llm)).toHaveLength(1); // unchanged — cache hit, zero cost
    expect(second.generated_at).toBe(first.generated_at);

    await app.close();
  });

  it('REQ-8: {force:true} re-classifies (call count increments) and upserts the SAME row', async () => {
    const llm = intentLlm();
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const service = new ReviewService(app.container);

    await service.getOrClassifyIntent(workspaceId, pr.id);
    expect(structuredCalls(llm)).toHaveLength(1);

    await service.getOrClassifyIntent(workspaceId, pr.id, { force: true });
    expect(structuredCalls(llm)).toHaveLength(2);

    const rows = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(rows).toHaveLength(1);

    await app.close();
  });

  it('REQ-10: getIntent (the read path) never classifies — no row means undefined, zero model calls', async () => {
    const llm = intentLlm();
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const service = new ReviewService(app.container);

    const result = await service.getIntent(workspaceId, pr.id);
    expect(result).toBeUndefined();
    expect(structuredCalls(llm)).toHaveLength(0);

    await app.close();
  });

  it('REQ-10: GET /pulls/:id/intent 404s when no row exists and never calls the classifier; POST then makes it 200', async () => {
    const llm = intentLlm();
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const before = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(before.statusCode).toBe(404);
    expect(structuredCalls(llm)).toHaveLength(0);

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent`, payload: {} });
    expect(post.statusCode).toBe(200);
    expect(structuredCalls(llm)).toHaveLength(1);

    const after = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(after.statusCode).toBe(200);
    expect(after.json().intent).toBe(INTENT_FIXTURE.intent);
    expect(structuredCalls(llm)).toHaveLength(1); // GET still made no call

    await app.close();
  });

  it('REQ-8/REQ-10: POST is get-or-create by default; {force:true} is the ONLY path that re-classifies', async () => {
    const llm = intentLlm();
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const first = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent`, payload: {} });
    expect(first.statusCode).toBe(200);
    expect(structuredCalls(llm)).toHaveLength(1);

    const second = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent`, payload: {} });
    expect(second.statusCode).toBe(200);
    expect(structuredCalls(llm)).toHaveLength(1); // unchanged

    const forced = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/intent`,
      payload: { force: true },
    });
    expect(forced.statusCode).toBe(200);
    expect(structuredCalls(llm)).toHaveLength(2);

    await app.close();
  });

  // ---------------------------------------------------------------------
  // W-A: the `isStaleFallback` retry-window branch (service.ts ~line 248) —
  // a persisted `model: null` row is a cache MISS only once `generatedAt`
  // is older than INTENT_RETRY_WINDOW_MS (15 min), never on every call.
  // ---------------------------------------------------------------------

  it('W-A: a stale REQ-7 fallback row (model: null, 16min old) is re-classified even without force', async () => {
    const llm = intentLlm();
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await upsertIntent(pg.handle.db, pr.id, FALLBACK_INTENT, {
      model: null,
      generatedAt: new Date(Date.now() - 16 * 60_000),
    });

    const service = new ReviewService(app.container);
    const result = await service.getOrClassifyIntent(workspaceId, pr.id);

    // Exactly one call spent re-classifying the stale fallback.
    expect(structuredCalls(llm)).toHaveLength(1);
    expect(result.intent).toBe(INTENT_FIXTURE.intent);

    await app.close();
  });

  it('W-A: a fresh REQ-7 fallback row (model: null, generatedAt now) is still a cache hit — zero model calls', async () => {
    const llm = intentLlm();
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await upsertIntent(pg.handle.db, pr.id, FALLBACK_INTENT, {
      model: null,
      generatedAt: new Date(),
    });

    const service = new ReviewService(app.container);
    const result = await service.getOrClassifyIntent(workspaceId, pr.id);

    expect(structuredCalls(llm)).toHaveLength(0);
    expect(result.model).toBeNull();
    expect(result.intent).toBe(FALLBACK_INTENT.intent);

    await app.close();
  });

  // ---------------------------------------------------------------------
  // W-B: `persistedModel = fallback ? null : model.model` (service.ts ~line
  // 278) — a REQ-7 fallback (the model call itself rejects) must persist
  // `model: null`, never the resolved-but-unused model id.
  // ---------------------------------------------------------------------

  it('W-B: when completeStructured rejects, the REQ-7 fallback persists model: null in the DB row and the returned detail', async () => {
    // No fixture supplied: MockLLMProvider.completeStructured's default `{}`
    // fixture fails IntentClassification.safeParse (required fields absent),
    // so the call REJECTS — the same failure mode as an unresolvable
    // provider or a malformed response (intent-classifier.ts's REQ-7 catch).
    const rejectingLlm = new MockLLMProvider('openrouter');
    const app = await appWith(rejectingLlm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const service = new ReviewService(app.container);

    const result = await service.getOrClassifyIntent(workspaceId, pr.id);

    expect(structuredCalls(rejectingLlm)).toHaveLength(1);
    expect(result.model).toBeNull();

    const rows = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.model).toBeNull();

    await app.close();
  });
});
