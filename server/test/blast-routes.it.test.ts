/**
 * `GET /pulls/:id/blast` — the `blastExplainEnabled` feature-flag branch
 * (docs/plans/06-blast-radius.md, T9/D3/A3, REQ-19/REQ-20). Closes the gap
 * `plan-verifier` found: `grep -rn "BLAST_EXPLAIN_ENABLED\|blastExplainEnabled"
 * server/test` returned nothing before this file — no test executed either
 * arm of the ternary in `blast/routes.ts:50-52`.
 *
 * Two cases, one per arm, both driven through `buildApp` + `app.inject` (the
 * ROUTE, never `BlastService`/`narrateBlastRadius` directly — every existing
 * narration test (`blast-explain.test.ts`) already covers those in isolation
 * with a hand-written `{provider, model}` literal, which is exactly what
 * left this branch unexercised):
 *
 *   1. Flag OFF (default): `narrative` is `null`, proven together with the
 *      REAL teeth — `vi.spyOn(app.container, 'llm')` never fires, so
 *      `resolveFeatureModel`'s settings read can't have been reached either
 *      (nothing downstream of it runs). Follows the exact
 *      `vi.spyOn(app.container, 'llm')` / `.not.toHaveBeenCalled()` shape
 *      `smart-diff-api.it.test.ts` REQ-8 already established for "prove a
 *      code path made zero LLM calls".
 *   2. Flag ON: a workspace override for `review_intent` (seeded through the
 *      real `PUT /settings`, `settings-models.it.test.ts`'s own shape) points
 *      narration at `openai`/a throwaway model id instead of the registry
 *      default (`openrouter`/`deepseek-v4-flash`). The mocked `openai`
 *      provider's recorded `req.model` is asserted directly against that
 *      override — proof the model reaching the LLM adapter is what Settings
 *      resolved, not a hardcoded literal.
 *
 * `hermeticOverrides()` on every `buildApp()` call (server/INSIGHTS.md,
 * 2026-08-21) — case 2 deliberately exercises the LLM path, so skipping this
 * would make a real, billed completion. Every test seeds its own repo (unique
 * name via `repoSeq`) per `blast.it.test.ts`'s template; case 2 additionally
 * deletes the `feature_models` settings row it writes afterwards, because
 * settings are workspace-scoped and `freshRepo()`/per-test repo seeding does
 * NOT isolate them (server/INSIGHTS.md, 2026-08-17).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { hermeticOverrides } from './helpers/overrides.js';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/platform/config.js';
import type { ContainerOverrides } from '../src/platform/container.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { BLAST_NARRATION_SCHEMA_NAME } from '../src/modules/blast/explain.js';
import type { BlastRadiusResponse } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

type Db = PgFixture['handle']['db'];

let repoSeq = 0;

// Reused wholesale from `blast.it.test.ts` (same seeding shape for this route).
async function setupRepo(db: Db, workspaceId: string) {
  const name = `blast-routes-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  return repo!;
}

async function insertPr(db: Db, workspaceId: string, repoId: string, number: number) {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number,
      title: `PR #${number}`,
      author: 'octocat',
      branch: `feat/${number}`,
      base: 'main',
      headSha: `sha${number}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return pr!;
}

async function insertPrFiles(db: Db, prId: string, paths: string[]) {
  await db.insert(t.prFiles).values(paths.map((path) => ({ prId, path })));
}

d('GET /pulls/:id/blast — blastExplainEnabled flag branch (Testcontainers pg)', () => {
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

  function appWith(cfg: AppConfig, overrides: ContainerOverrides = {}) {
    return buildApp({ config: cfg, db: pg.handle.db, overrides: hermeticOverrides(overrides) });
  }

  it('case 1 — flag OFF: narrative is null and no LLM resolution is ever attempted (REQ-20)', async () => {
    const db = pg.handle.db;
    const repo = await setupRepo(db, workspaceId);
    const pr = await insertPr(db, workspaceId, repo.id, 101);
    await insertPrFiles(db, pr.id, ['src/off.ts']);

    const app = await appWith({ ...config(), blastExplainEnabled: false });
    // The real teeth: with the flag off, `resolveFeatureModel` must never run,
    // so `deps.llm` (== `app.container.llm`, per `blast/routes.ts`'s wiring)
    // must never be called either — asserting `narrative === null` alone
    // would NOT catch a mutation that resolves a model nobody ends up able to
    // use (the hermetic default `openrouter` mock only knows the intent
    // schema, so an unconditional resolve+narrate call still falls back to
    // `null` on a schema mismatch — see case 2's mutation note for why this
    // spy is the assertion that actually bites).
    const llmSpy = vi.spyOn(app.container, 'llm');

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadiusResponse;

    // Mutation this catches: inverting or dropping the
    // `app.container.config.blastExplainEnabled ? … : undefined` ternary in
    // `blast/routes.ts` — either variant makes `resolveFeatureModel` (and
    // therefore `app.container.llm`) run even with the flag off.
    expect(body.narrative).toBeNull();
    expect(llmSpy).not.toHaveBeenCalled();

    await app.close();
  });

  it('case 2 — flag ON: the model reaching the LLM adapter is the workspace override for review_intent, not the registry default (REQ-19)', async () => {
    const db = pg.handle.db;
    const repo = await setupRepo(db, workspaceId);
    const pr = await insertPr(db, workspaceId, repo.id, 102);
    await insertPrFiles(db, pr.id, ['src/on.ts']);

    const overrideModel = 'gpt-blast-narration-test';
    const narrativeText = 'This change affects several symbols and files across the repository.';
    const openaiMock = new MockLLMProvider('openai', {
      structuredBySchema: { [BLAST_NARRATION_SCHEMA_NAME]: { narrative: narrativeText } },
    });

    const app = await appWith(
      { ...config(), blastExplainEnabled: true },
      { llm: { openai: openaiMock } },
    );

    try {
      // Seed the workspace override through the real route — same shape as
      // `settings-models.it.test.ts` — so `review_intent` resolves to `openai`
      // (the registry default is `openrouter`/`deepseek-v4-flash`; the
      // hermetic `openrouter` mock only carries an intent-classifier fixture,
      // so a resolve that ignored this override would hit that mock instead
      // and fail its schema, per the note below).
      const put = await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: {
          feature_models: { review_intent: { provider: 'openai', model: overrideModel } },
        },
      });
      expect(put.statusCode).toBe(200);

      const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as BlastRadiusResponse;

      // Mutation this catches: `blast/routes.ts` resolving `narrationModel`
      // from the registry default (or any hardcoded `{provider, model}`
      // literal) instead of
      // `resolveFeatureModel(app.container, workspaceId, 'review_intent')`.
      // Under that mutation the call would land on the hermetic `openrouter`
      // mock, which has no `BlastNarration` fixture — `completeStructured`
      // throws on `safeParse({})`, `narrateBlastRadius` catches it and
      // returns `null`, so BOTH assertions below flip: `narrative` stays
      // `null` instead of matching, and `openaiMock.calls` stays empty.
      expect(body.narrative).toBe(narrativeText);
      expect(openaiMock.calls).toHaveLength(1);
      expect(openaiMock.calls[0]?.req).toMatchObject({
        model: overrideModel,
        schemaName: BLAST_NARRATION_SCHEMA_NAME,
      });

      await app.close();
    } finally {
      // Settings are workspace-scoped (server/INSIGHTS.md, 2026-08-17) —
      // clean up so this override can't leak into any later test in this file.
      await db
        .delete(t.settings)
        .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    }
  });
});
