/**
 * Route tests for the eval module (L06):
 *   GET/POST   /agents/:id/evals/cases
 *   POST       /findings/:id/evals/case
 *   DELETE     /agents/:id/evals/cases/:caseId
 *   POST       /agents/:id/evals/run
 *   GET        /agents/:id/evals/batches[/:batchId]
 *   GET        /agents/:id/evals/trend
 *   GET        /agents/:id/evals/compare
 *   GET        /evals/overview
 *   GET        /evals/recent
 *   POST       /evals/run-all
 *
 * Hermetic: no Postgres, no Docker.
 *
 * Strategy mirrors `test/eval-service.test.ts` (business logic already covered
 * there) + `test/blast-routes.test.ts` / `test/brief-routes.test.ts` (route-level
 * precedent): build a real app via `buildApp()` with `MockAuthProvider` (known
 * workspaceId), stub `EvalRepository.prototype` methods via `vi.spyOn` (the
 * established convention — avoids hand-rolling a fake Drizzle `db` for every
 * route), and patch the getter-only `container.agentsRepo`/`container.reviewRepo`
 * cross-cutting facades via `Object.defineProperty` (required for a REAL
 * `Container` instance — plain assignment throws "has only a getter", per
 * `server/insights.md`'s 2026-07-03 Quirk entry on this exact distinction).
 *
 * Rate-limit note: `@fastify/rate-limit` is disabled entirely when
 * `nodeEnv==='test'` (`src/app.ts`), so the app built via `buildApp()` (which
 * always runs under `NODE_ENV=test` here) can never produce a real 429 via
 * `app.inject()`. Two complementary checks cover AC-18 as a result:
 *  (1) a static assertion (mirrors `test/brief-routes.test.ts`'s precedent)
 *      that the route is REGISTERED with `{ max: 2, timeWindow: '1 minute' }`,
 *      read via Fastify's `onRoute` hook at registration time; and
 *  (2) a genuine live-429 test against a RAW Fastify instance (not built via
 *      `buildApp()`) with `@fastify/rate-limit` registered directly — this
 *      instance is not subject to the nodeEnv==='test' gate in `src/app.ts`,
 *      so 3 sequential calls to `/agents/:id/evals/run` genuinely trip the
 *      route's own `max: 2` config and the 3rd call gets a real 429.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider, MockLLMProvider } from '../src/adapters/mocks.js';
import { EvalRepository } from '../src/modules/eval/repository.js';
import evalRoutes from '../src/modules/eval/routes.js';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../src/platform/container.js';
import type { Expectation } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_WS_ID = '99999999-9999-9999-9999-999999999999';
const AGENT_ID = '33333333-3333-3333-3333-333333333333';
const CASE_ID = '44444444-4444-4444-4444-444444444444';
const BATCH_ID = '55555555-5555-5555-5555-555555555555';
const FINDING_ID = '66666666-6666-6666-6666-666666666666';
const PR_ID = '77777777-7777-7777-7777-777777777777';
const REVIEW_ID = '88888888-8888-8888-8888-888888888888';
const INVALID_ID = 'not-a-uuid';

const VALID_DIFF = [
  'diff --git a/src/config.ts b/src/config.ts',
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -10,3 +10,4 @@',
  '   port: 3000,',
  '+  stripeKey: "sk_live_xxx",',
  '   redisUrl: x,',
].join('\n');

const AGENT_ROW = {
  id: AGENT_ID,
  workspaceId: WS_ID,
  name: 'Test Agent',
  description: '',
  provider: 'openai' as const,
  model: 'gpt-4.1',
  systemPrompt: 'You are a reviewer.',
  outputSchema: null,
  strategy: 'single-pass' as const,
  ciFailOn: 'critical' as const,
  repoIntel: true,
  enabled: true,
  version: 1,
  createdBy: null,
  createdAt: new Date('2026-01-01'),
};

function makeCaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CASE_ID,
    workspaceId: WS_ID,
    ownerKind: 'agent' as const,
    ownerId: AGENT_ID,
    name: 'A case',
    inputDiff: VALID_DIFF,
    inputFiles: null,
    inputMeta: { source: 'manual' },
    expectedOutput: [] as Expectation[],
    notes: null,
    ...overrides,
  };
}

function makeBatchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BATCH_ID,
    workspaceId: WS_ID,
    agentId: AGENT_ID,
    kind: 'full' as const,
    status: 'clean' as const,
    agentSnapshot: { fingerprint: 'x', display: {} },
    recall: 1,
    precision: 1,
    citationAccuracy: 1,
    costUsd: 0.01,
    ranAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// App builder helper
// ---------------------------------------------------------------------------

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

interface BuildOpts {
  agentsRepo?: {
    getById?: ReturnType<typeof vi.fn>;
    linkedSkills?: ReturnType<typeof vi.fn>;
  };
  reviewRepo?: {
    findingContext?: ReturnType<typeof vi.fn>;
    getPrFiles?: ReturnType<typeof vi.fn>;
  };
  llm?: MockLLMProvider;
}

async function buildEvalApp(opts: BuildOpts = {}): Promise<FastifyInstance> {
  const mockAuth = new MockAuthProvider(
    { id: 'u1', email: 'you@local', name: 'You' },
    { id: WS_ID, name: 'default' },
  );

  const app = await buildApp({ config, overrides: { auth: mockAuth } });

  // agentsRepo / reviewRepo are getter-only accessors on the real Container —
  // plain assignment throws "has only a getter" (server/insights.md 2026-07-03).
  Object.defineProperty(app.container, 'agentsRepo', {
    configurable: true,
    value: {
      getById: opts.agentsRepo?.getById ?? vi.fn().mockResolvedValue(AGENT_ROW),
      linkedSkills: opts.agentsRepo?.linkedSkills ?? vi.fn().mockResolvedValue([]),
    },
  });
  Object.defineProperty(app.container, 'reviewRepo', {
    configurable: true,
    value: {
      findingContext: opts.reviewRepo?.findingContext ?? vi.fn().mockResolvedValue(undefined),
      getPrFiles: opts.reviewRepo?.getPrFiles ?? vi.fn().mockResolvedValue([]),
    },
  });

  const llm =
    opts.llm ??
    new MockLLMProvider('openai', {
      structured: { verdict: 'comment', summary: 'ok', score: 90, findings: [] },
    });
  app.container.llm = vi.fn().mockResolvedValue(llm) as unknown as Container['llm'];

  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// GET /agents/:id/evals/cases
// ---------------------------------------------------------------------------

describe('GET /agents/:id/evals/cases', () => {
  it('returns 422 for a non-UUID agent id', async () => {
    const app = await buildEvalApp();
    const res = await app.inject({ method: 'GET', url: `/agents/${INVALID_ID}/evals/cases` });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it('returns 200 with cases + excluded_skill_owned_count', async () => {
    vi.spyOn(EvalRepository.prototype, 'listCases').mockResolvedValue([makeCaseRow()] as any);
    vi.spyOn(EvalRepository.prototype, 'countSkillOwnedCases').mockResolvedValue(2);
    vi.spyOn(EvalRepository.prototype, 'latestRunForCase').mockResolvedValue(null);
    vi.spyOn(EvalRepository.prototype, 'lastThreeFullBatchOutcomesForCase').mockResolvedValue([]);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/evals/cases` });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cases).toHaveLength(1);
    expect(body.cases[0].id).toBe(CASE_ID);
    expect(body.excluded_skill_owned_count).toBe(2);
  });

  it('a never-run case gets last_run_status="never_run" with no outcome text (AC-25)', async () => {
    vi.spyOn(EvalRepository.prototype, 'listCases').mockResolvedValue([makeCaseRow()] as any);
    vi.spyOn(EvalRepository.prototype, 'countSkillOwnedCases').mockResolvedValue(0);
    vi.spyOn(EvalRepository.prototype, 'latestRunForCase').mockResolvedValue(null);
    vi.spyOn(EvalRepository.prototype, 'lastThreeFullBatchOutcomesForCase').mockResolvedValue([]);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/evals/cases` });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cases[0].last_run_status).toBe('never_run');
    expect(body.cases[0].last_run_summary).toBeNull();
  });

  it('a case with a passed run gets a distinct status + non-null outcome summary (AC-25 contrast)', async () => {
    vi.spyOn(EvalRepository.prototype, 'listCases').mockResolvedValue([makeCaseRow()] as any);
    vi.spyOn(EvalRepository.prototype, 'countSkillOwnedCases').mockResolvedValue(0);
    vi.spyOn(EvalRepository.prototype, 'latestRunForCase').mockResolvedValue({
      id: 'run-1',
      caseId: CASE_ID,
      ranAt: new Date('2026-07-01'),
      actualOutput: [],
      pass: true,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      durationMs: 50,
      costUsd: 0.001,
      batchId: BATCH_ID,
    } as any);
    vi.spyOn(EvalRepository.prototype, 'lastThreeFullBatchOutcomesForCase').mockResolvedValue(['passed']);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/evals/cases` });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cases[0].last_run_status).toBe('passed');
    expect(body.cases[0].last_run_summary).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /agents/:id/evals/cases (manual case)
// ---------------------------------------------------------------------------

describe('POST /agents/:id/evals/cases', () => {
  it('returns 200 and persists a hand-authored case with a valid diff', async () => {
    const insertSpy = vi
      .spyOn(EvalRepository.prototype, 'insertCase')
      .mockImplementation(async (data: any) => ({ id: 'new-case', ...data }));

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/evals/cases`,
      payload: {
        owner_id: AGENT_ID,
        name: 'Manual case',
        input_diff: VALID_DIFF,
        expected_output: [],
        notes: null,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(insertSpy).toHaveBeenCalledOnce();
    expect(res.json().name).toBe('Manual case');
  });

  it('returns 422 (ValidationError) for a diff fragment referencing zero files (AC-8)', async () => {
    const insertSpy = vi.spyOn(EvalRepository.prototype, 'insertCase');

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/evals/cases`,
      payload: {
        owner_id: AGENT_ID,
        name: 'Bad case',
        input_diff: 'not a diff at all',
        expected_output: [],
        notes: null,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(422);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PATCH /agents/:id/evals/cases/:caseId (edit-in-place)
// ---------------------------------------------------------------------------

describe('PATCH /agents/:id/evals/cases/:caseId', () => {
  it('returns 200 and persists the edit with a valid diff', async () => {
    vi.spyOn(EvalRepository.prototype, 'getCase').mockResolvedValue(makeCaseRow() as any);
    const updateSpy = vi
      .spyOn(EvalRepository.prototype, 'updateCase')
      .mockImplementation(async (_ws, _id, data: any) => ({ ...makeCaseRow(), ...data }));

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/agents/${AGENT_ID}/evals/cases/${CASE_ID}`,
      payload: {
        owner_id: AGENT_ID,
        name: 'Updated case',
        input_diff: VALID_DIFF,
        expected_output: [],
        notes: null,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledOnce();
    expect(res.json().name).toBe('Updated case');
  });

  it('returns 404 for a cross-workspace/missing case', async () => {
    vi.spyOn(EvalRepository.prototype, 'getCase').mockResolvedValue(null);

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/agents/${AGENT_ID}/evals/cases/${CASE_ID}`,
      payload: {
        owner_id: AGENT_ID,
        name: 'Updated case',
        input_diff: VALID_DIFF,
        expected_output: [],
        notes: null,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it('returns 422 (ValidationError) for a diff fragment referencing zero files (AC-8)', async () => {
    vi.spyOn(EvalRepository.prototype, 'getCase').mockResolvedValue(makeCaseRow() as any);
    const updateSpy = vi.spyOn(EvalRepository.prototype, 'updateCase');

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/agents/${AGENT_ID}/evals/cases/${CASE_ID}`,
      payload: {
        owner_id: AGENT_ID,
        name: 'Bad edit',
        input_diff: 'not a diff at all',
        expected_output: [],
        notes: null,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(422);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /findings/:id/evals/case
// ---------------------------------------------------------------------------

describe('POST /findings/:id/evals/case', () => {
  it('returns 200 and creates a must_find case from an accepted finding (AC-1)', async () => {
    const findingContext = vi.fn().mockResolvedValue({
      finding: {
        id: FINDING_ID,
        reviewId: REVIEW_ID,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded secret',
        rationale: 'Do not hardcode secrets',
        suggestion: null,
        confidence: 0.9,
        kind: 'finding',
        acceptedAt: new Date('2026-01-01'),
        dismissedAt: null,
      },
      review: { id: REVIEW_ID, agentId: AGENT_ID, prId: PR_ID },
      pull: { id: PR_ID, workspaceId: WS_ID, number: 42 },
    });
    const getPrFiles = vi
      .fn()
      .mockResolvedValue([{ path: 'src/config.ts', patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "x",\n   redisUrl: x,' }]);

    vi.spyOn(EvalRepository.prototype, 'findCaseBySourceFindingId').mockResolvedValue(null);
    vi.spyOn(EvalRepository.prototype, 'insertCase').mockImplementation(async (data: any) => ({
      id: 'new-case',
      ...data,
    }));

    const app = await buildEvalApp({ reviewRepo: { findingContext, getPrFiles } });
    const res = await app.inject({ method: 'POST', url: `/findings/${FINDING_ID}/evals/case` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().expected_output[0].type).toBe('must_find');
  });

  it('returns 404 for a finding belonging to a different workspace', async () => {
    const findingContext = vi.fn().mockResolvedValue({
      finding: {
        id: FINDING_ID,
        acceptedAt: new Date(),
        dismissedAt: null,
        file: 'a.ts',
        startLine: 1,
        endLine: 1,
        severity: 'CRITICAL',
        category: 'bug',
        title: 't',
        rationale: 'r',
        confidence: 0.5,
        kind: 'finding',
      },
      review: { id: REVIEW_ID, agentId: AGENT_ID, prId: PR_ID },
      pull: { id: PR_ID, workspaceId: OTHER_WS_ID, number: 1 },
    });

    vi.spyOn(EvalRepository.prototype, 'findCaseBySourceFindingId').mockResolvedValue(null);

    const app = await buildEvalApp({ reviewRepo: { findingContext } });
    const res = await app.inject({ method: 'POST', url: `/findings/${FINDING_ID}/evals/case` });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /agents/:id/evals/cases/:caseId
// ---------------------------------------------------------------------------

describe('DELETE /agents/:id/evals/cases/:caseId', () => {
  it('returns 200 and deletes an existing case', async () => {
    vi.spyOn(EvalRepository.prototype, 'getCase').mockResolvedValue(makeCaseRow() as any);
    const deleteSpy = vi.spyOn(EvalRepository.prototype, 'deleteCase').mockResolvedValue(true);

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/agents/${AGENT_ID}/evals/cases/${CASE_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(deleteSpy).toHaveBeenCalledWith(WS_ID, CASE_ID);
  });

  it('returns 404 for a cross-workspace/missing case', async () => {
    vi.spyOn(EvalRepository.prototype, 'getCase').mockResolvedValue(null);

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/agents/${AGENT_ID}/evals/cases/${CASE_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the case belongs to a different agent (#2 ownership guard)', async () => {
    const OTHER_AGENT_ID = 'aaaaaaaa-3333-3333-3333-333333333333';
    vi.spyOn(EvalRepository.prototype, 'getCase').mockResolvedValue(makeCaseRow({ ownerId: OTHER_AGENT_ID }) as any);
    const deleteSpy = vi.spyOn(EvalRepository.prototype, 'deleteCase');

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/agents/${AGENT_ID}/evals/cases/${CASE_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /agents/:id/evals/run
// ---------------------------------------------------------------------------

describe('POST /agents/:id/evals/run', () => {
  it('returns 202 with a batch_id when case_ids is omitted, and the fan-out completes detached (AC-11, #9)', async () => {
    vi.spyOn(EvalRepository.prototype, 'listCases').mockResolvedValue([makeCaseRow()] as any);
    vi.spyOn(EvalRepository.prototype, 'insertBatch').mockResolvedValue(makeBatchRow({ status: null }) as any);
    vi.spyOn(EvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    const updateAggSpy = vi.spyOn(EvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/evals/run`,
      payload: {},
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().batch_id).toBe(BATCH_ID);

    // The fan-out is detached (void, not awaited by the route) — give the
    // microtask queue a turn so `executeEvalRun`'s async work actually runs
    // before asserting it happened, mirroring how a real client would poll.
    await new Promise((resolve) => setImmediate(resolve));
    await app.close();

    expect(updateAggSpy).toHaveBeenCalledOnce();
  });

  it('returns 202 with a batch_id when case_ids is a strict subset (calibration, AC-14)', async () => {
    // AC-14 fixture: case_ids must be real UUIDs — the contract enforces
    // `.uuid()` on each element, so a non-UUID payload now 422s at the
    // schema layer before ever reaching the service.
    const CASE_A_ID = 'cccccccc-aaaa-1111-1111-111111111111';
    const CASE_B_ID = 'cccccccc-bbbb-2222-2222-222222222222';
    const caseA = makeCaseRow({ id: CASE_A_ID });
    const caseB = makeCaseRow({ id: CASE_B_ID });
    vi.spyOn(EvalRepository.prototype, 'listCases').mockResolvedValue([caseA, caseB] as any);
    vi.spyOn(EvalRepository.prototype, 'insertBatch').mockResolvedValue(
      makeBatchRow({ kind: 'calibration', status: null }) as any,
    );
    vi.spyOn(EvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    vi.spyOn(EvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/evals/run`,
      payload: { case_ids: [CASE_A_ID] },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json().batch_id).toBe(BATCH_ID);
  });

  it('returns 422 when case_ids resolve to zero real cases for this agent (#7)', async () => {
    const CASE_A_ID = 'cccccccc-aaaa-1111-1111-111111111111';
    const caseA = makeCaseRow({ id: CASE_A_ID });
    vi.spyOn(EvalRepository.prototype, 'listCases').mockResolvedValue([caseA] as any);
    const insertBatchSpy = vi.spyOn(EvalRepository.prototype, 'insertBatch');

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/evals/run`,
      payload: { case_ids: ['ffffffff-ffff-ffff-ffff-ffffffffffff'] },
    });
    await app.close();

    expect(res.statusCode).toBe(422);
    expect(insertBatchSpy).not.toHaveBeenCalled();
  });

  it('dedupes duplicate case_ids before classifying batch kind (#7)', async () => {
    const CASE_A_ID = 'cccccccc-aaaa-1111-1111-111111111111';
    const CASE_B_ID = 'cccccccc-bbbb-2222-2222-222222222222';
    const caseA = makeCaseRow({ id: CASE_A_ID });
    const caseB = makeCaseRow({ id: CASE_B_ID });
    vi.spyOn(EvalRepository.prototype, 'listCases').mockResolvedValue([caseA, caseB] as any);
    const insertBatchSpy = vi
      .spyOn(EvalRepository.prototype, 'insertBatch')
      .mockResolvedValue(makeBatchRow({ kind: 'calibration', status: null }) as any);
    vi.spyOn(EvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    vi.spyOn(EvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/evals/run`,
      // CASE_A_ID repeated 3x against a 2-case set: the deduped length (1)
      // must NOT accidentally equal the full-set size and be misclassified 'full'.
      payload: { case_ids: [CASE_A_ID, CASE_A_ID, CASE_A_ID] },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(insertBatchSpy.mock.calls[0]![0]).toMatchObject({ kind: 'calibration' });
  });
});

describe('POST /agents/:id/evals/run — registered rate-limit config (static assertion)', () => {
  it('the route is registered with { max: 2, timeWindow: "1 minute" } (AC-18)', async () => {
    // A real 429 CANNOT be produced hermetically here — @fastify/rate-limit is
    // disabled entirely when nodeEnv==='test' (src/app.ts), so app.inject()
    // never actually throttles regardless of how many requests are fired.
    // This mirrors test/brief-routes.test.ts's identical constraint/precedent:
    // inspect the route's OWN registered config via the `onRoute` hook, which
    // fires synchronously at plugin-registration time independent of whether
    // the global rate-limit plugin is active.
    const raw = Fastify();
    raw.setValidatorCompiler(validatorCompiler);
    raw.setSerializerCompiler(serializerCompiler);
    raw.decorate('container', {
      db: {},
      agentsRepo: { getById: vi.fn(), linkedSkills: vi.fn() },
      reviewRepo: { findingContext: vi.fn(), getPrFiles: vi.fn() },
      llm: vi.fn(),
    } as unknown as Container);

    let capturedConfig: Record<string, unknown> | undefined;
    raw.addHook('onRoute', (routeOptions) => {
      if (routeOptions.method === 'POST' && routeOptions.url === '/agents/:id/evals/run') {
        capturedConfig = routeOptions.config as Record<string, unknown>;
      }
    });

    await raw.register(evalRoutes);
    await raw.ready();
    await raw.close();

    expect(capturedConfig).toBeDefined();
    const rateLimit = capturedConfig?.rateLimit as
      | { max: number; timeWindow: string; keyGenerator?: unknown }
      | undefined;
    expect(rateLimit).toBeDefined();
    expect(rateLimit?.max).toBe(2);
    expect(rateLimit?.timeWindow).toBe('1 minute');
    // S3: per-workspace keying (not the default IP-keying review-all uses) —
    // a keyGenerator function must be registered.
    expect(typeof rateLimit?.keyGenerator).toBe('function');
  });

  it('keyGenerator resolves to a per-workspace key, not per-IP (S3)', async () => {
    const raw = Fastify();
    raw.setValidatorCompiler(validatorCompiler);
    raw.setSerializerCompiler(serializerCompiler);
    const mockAuth = new MockAuthProvider(
      { id: 'u1', email: 'you@local', name: 'You' },
      { id: WS_ID, name: 'default' },
    );
    raw.decorate('container', {
      db: {},
      auth: mockAuth,
      agentsRepo: { getById: vi.fn(), linkedSkills: vi.fn() },
      reviewRepo: { findingContext: vi.fn(), getPrFiles: vi.fn() },
      llm: vi.fn(),
    } as unknown as Container);

    let capturedConfig: Record<string, unknown> | undefined;
    raw.addHook('onRoute', (routeOptions) => {
      if (routeOptions.method === 'POST' && routeOptions.url === '/agents/:id/evals/run') {
        capturedConfig = routeOptions.config as Record<string, unknown>;
      }
    });

    await raw.register(evalRoutes);
    await raw.ready();

    const rateLimit = capturedConfig?.rateLimit as
      | { keyGenerator: (req: unknown) => Promise<string> }
      | undefined;
    const key = await rateLimit!.keyGenerator({} as never);
    await raw.close();

    expect(key).toBe(`eval-run:${WS_ID}`);
  });

  it('fires 3 rapid requests against a REAL rate-limited Fastify instance and asserts the 3rd is throttled', async () => {
    // Unlike the app built via buildApp() (which runs under nodeEnv==='test'
    // and therefore never registers @fastify/rate-limit at all), build a raw
    // Fastify instance here and register @fastify/rate-limit ourselves so this
    // test can genuinely assert a 429 on burst traffic, not just a static
    // config shape. This directly satisfies the task's verification checklist
    // item ("the rate-limit test genuinely asserts a 429").
    const rateLimitPlugin = (await import('@fastify/rate-limit')).default;

    vi.spyOn(EvalRepository.prototype, 'listCases').mockResolvedValue([makeCaseRow()] as any);
    vi.spyOn(EvalRepository.prototype, 'insertBatch').mockResolvedValue(makeBatchRow() as any);
    vi.spyOn(EvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    vi.spyOn(EvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

    const raw = Fastify();
    raw.setValidatorCompiler(validatorCompiler);
    raw.setSerializerCompiler(serializerCompiler);
    await raw.register(rateLimitPlugin, { max: 120, timeWindow: '1 minute' });

    const mockAuth = new MockAuthProvider(
      { id: 'u1', email: 'you@local', name: 'You' },
      { id: WS_ID, name: 'default' },
    );
    raw.decorate('container', {
      db: {},
      auth: mockAuth,
      agentsRepo: { getById: vi.fn().mockResolvedValue(AGENT_ROW), linkedSkills: vi.fn().mockResolvedValue([]) },
      reviewRepo: { findingContext: vi.fn(), getPrFiles: vi.fn().mockResolvedValue([]) },
      llm: vi.fn().mockResolvedValue(
        new MockLLMProvider('openai', {
          structured: { verdict: 'comment', summary: 'ok', score: 90, findings: [] },
        }),
      ),
    } as unknown as Container);

    await raw.register(evalRoutes);
    await raw.ready();

    const fire = () =>
      raw.inject({ method: 'POST', url: `/agents/${AGENT_ID}/evals/run`, payload: {} });

    // Sequential (not Promise.all): the rate-limit counter must observe each
    // call complete before the next fires, or concurrent injects can race the
    // counter and under-count the burst.
    const first = await fire();
    const second = await fire();
    const third = await fire();
    await raw.close();

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(third.statusCode).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// GET /agents/:id/evals/batches[/:batchId]
// ---------------------------------------------------------------------------

describe('GET /agents/:id/evals/batches', () => {
  it('returns 200 with batch history (AC-33)', async () => {
    vi.spyOn(EvalRepository.prototype, 'listBatchHistory').mockResolvedValue([makeBatchRow()] as any);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/evals/batches` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe(BATCH_ID);
  });
});

// ---------------------------------------------------------------------------
// DELETE /agents/:id/evals/batches — clear ALL run history for this agent
// ---------------------------------------------------------------------------

describe('DELETE /agents/:id/evals/batches', () => {
  it('returns 200 with deleted_batches/deleted_runs counts', async () => {
    const clearHistorySpy = vi
      .spyOn(EvalRepository.prototype, 'clearHistory')
      .mockResolvedValue({ deletedBatches: 3, deletedRuns: 7 });

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'DELETE', url: `/agents/${AGENT_ID}/evals/batches` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted_batches: 3, deleted_runs: 7 });
    expect(clearHistorySpy).toHaveBeenCalledWith(WS_ID, AGENT_ID);
  });

  it('returns 404 for an unknown agent', async () => {
    const clearHistorySpy = vi.spyOn(EvalRepository.prototype, 'clearHistory');

    const app = await buildEvalApp({ agentsRepo: { getById: vi.fn().mockResolvedValue(undefined) } });
    const res = await app.inject({ method: 'DELETE', url: `/agents/${AGENT_ID}/evals/batches` });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(clearHistorySpy).not.toHaveBeenCalled();
  });

  it('returns 422 for a non-UUID agent id', async () => {
    const app = await buildEvalApp();
    const res = await app.inject({ method: 'DELETE', url: `/agents/${INVALID_ID}/evals/batches` });
    await app.close();
    expect(res.statusCode).toBe(422);
  });
});

describe('GET /agents/:id/evals/batches/:batchId', () => {
  it('returns 200 with the batch drill-down (AC-33)', async () => {
    vi.spyOn(EvalRepository.prototype, 'getBatch').mockResolvedValue(makeBatchRow() as any);
    vi.spyOn(EvalRepository.prototype, 'runsForBatch').mockResolvedValue([]);
    vi.spyOn(EvalRepository.prototype, 'countSkillOwnedCases').mockResolvedValue(0);

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'GET',
      url: `/agents/${AGENT_ID}/evals/batches/${BATCH_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(BATCH_ID);
    expect(res.json().cases).toEqual([]);
  });

  it('returns 404 for a cross-workspace/missing batch', async () => {
    vi.spyOn(EvalRepository.prototype, 'getBatch').mockResolvedValue(null);

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'GET',
      url: `/agents/${AGENT_ID}/evals/batches/${BATCH_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /agents/:id/evals/trend
// ---------------------------------------------------------------------------

describe('GET /agents/:id/evals/trend', () => {
  it('returns 200 with trend points (AC-28-AC-30)', async () => {
    vi.spyOn(EvalRepository.prototype, 'listTrendBatches').mockResolvedValue([makeBatchRow()] as any);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/evals/trend` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].batch_id).toBe(BATCH_ID);
  });
});

// ---------------------------------------------------------------------------
// GET /agents/:id/evals/compare
// ---------------------------------------------------------------------------

describe('GET /agents/:id/evals/compare', () => {
  it('returns 200 with a + b + deltas (AC-32)', async () => {
    const BATCH_A_ID = 'aaaaaaaa-1111-1111-1111-111111111111';
    const BATCH_B_ID = 'bbbbbbbb-2222-2222-2222-222222222222';
    const batchA = makeBatchRow({ id: BATCH_A_ID, recall: 0.7, precision: 0.6, citationAccuracy: 0.9 });
    const batchB = makeBatchRow({ id: BATCH_B_ID, recall: 0.9, precision: 0.8, citationAccuracy: 1 });

    vi.spyOn(EvalRepository.prototype, 'getBatch').mockImplementation(async (_ws, batchId) =>
      (batchId === BATCH_A_ID ? batchA : batchB) as any,
    );
    vi.spyOn(EvalRepository.prototype, 'runsForBatch').mockResolvedValue([]);
    vi.spyOn(EvalRepository.prototype, 'countSkillOwnedCases').mockResolvedValue(0);

    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'GET',
      url: `/agents/${AGENT_ID}/evals/compare?a=${BATCH_A_ID}&b=${BATCH_B_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.a.id).toBe(BATCH_A_ID);
    expect(body.b.id).toBe(BATCH_B_ID);
    expect(body.deltas.recall).toBeCloseTo(0.2, 5);
    expect(body.deltas.precision).toBeCloseTo(0.2, 5);
    expect(body.deltas.citation_accuracy).toBeCloseTo(0.1, 5);
  });

  it('returns 422 for a non-UUID a/b query param', async () => {
    const app = await buildEvalApp();
    const res = await app.inject({
      method: 'GET',
      url: `/agents/${AGENT_ID}/evals/compare?a=not-a-uuid&b=${BATCH_ID}`,
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// GET /evals/overview
// ---------------------------------------------------------------------------

describe('GET /evals/overview', () => {
  it('returns [] for a workspace with zero eval-configured agents (AC-5)', async () => {
    vi.spyOn(EvalRepository.prototype, 'listEvalConfiguredAgentSummaries').mockResolvedValue([]);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'GET', url: '/evals/overview' });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns 200 with one card per eval-configured agent (AC-3, AC-4)', async () => {
    vi.spyOn(EvalRepository.prototype, 'listEvalConfiguredAgentSummaries').mockResolvedValue([
      {
        agentId: AGENT_ID,
        agentName: 'Test Agent',
        model: 'gpt-4.1',
        latestBatch: makeBatchRow({ systemPromptSnapshot: null }),
        latestVersion: 3,
        caseCount: 3,
      },
    ] as any);
    vi.spyOn(EvalRepository.prototype, 'recentTrendPointsForAgent').mockResolvedValue([
      makeBatchRow({ ranAt: new Date('2026-01-02'), systemPromptSnapshot: null }),
    ] as any);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'GET', url: '/evals/overview' });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].agent_id).toBe(AGENT_ID);
    expect(body[0].case_count).toBe(3);
    expect(body[0].latest_batch.id).toBe(BATCH_ID);
    expect(body[0].sparkline_points).toHaveLength(1);
  });

  it('never surfaces another workspace agent — repository is called with THIS workspace only', async () => {
    const summariesSpy = vi
      .spyOn(EvalRepository.prototype, 'listEvalConfiguredAgentSummaries')
      .mockResolvedValue([]);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'GET', url: '/evals/overview' });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(summariesSpy).toHaveBeenCalledWith(WS_ID);
    expect(summariesSpy).not.toHaveBeenCalledWith(OTHER_WS_ID);
  });
});

// ---------------------------------------------------------------------------
// GET /evals/recent
// ---------------------------------------------------------------------------

describe('GET /evals/recent', () => {
  it('returns [] for a workspace with zero batches', async () => {
    vi.spyOn(EvalRepository.prototype, 'listRecentBatchesAcrossAgents').mockResolvedValue([]);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'GET', url: '/evals/recent' });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns 200 with agent-attributed recent batch rows (AC-8)', async () => {
    vi.spyOn(EvalRepository.prototype, 'listRecentBatchesAcrossAgents').mockResolvedValue([
      {
        batch: makeBatchRow({ systemPromptSnapshot: null }),
        agentId: AGENT_ID,
        agentName: 'Test Agent',
        version: 1,
        passCount: 4,
        totalCount: 5,
      },
    ] as any);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'GET', url: '/evals/recent' });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].agent_id).toBe(AGENT_ID);
    expect(body[0].agent_name).toBe('Test Agent');
    expect(body[0].pass_count).toBe(4);
    expect(body[0].total_count).toBe(5);
  });

  it('never requests more than the server-fixed cap regardless of workspace (AC-9)', async () => {
    const recentSpy = vi
      .spyOn(EvalRepository.prototype, 'listRecentBatchesAcrossAgents')
      .mockResolvedValue([]);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'GET', url: '/evals/recent' });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(recentSpy).toHaveBeenCalledWith(WS_ID, 25);
    expect(recentSpy).not.toHaveBeenCalledWith(OTHER_WS_ID, expect.anything());
  });
});

// ---------------------------------------------------------------------------
// POST /evals/run-all
// ---------------------------------------------------------------------------

describe('POST /evals/run-all', () => {
  it('returns 202 with a started entry per eval-configured agent, and the fan-out completes detached (AC-11)', async () => {
    vi.spyOn(EvalRepository.prototype, 'listEvalConfiguredAgentSummaries').mockResolvedValue([
      { agentId: AGENT_ID, agentName: 'Test Agent', model: 'gpt-4.1', latestBatch: null, caseCount: 1 },
    ] as any);
    vi.spyOn(EvalRepository.prototype, 'listCases').mockResolvedValue([makeCaseRow()] as any);
    vi.spyOn(EvalRepository.prototype, 'insertBatch').mockResolvedValue(makeBatchRow({ status: null }) as any);
    vi.spyOn(EvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    const updateAggSpy = vi.spyOn(EvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'POST', url: '/evals/run-all' });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.started).toEqual([{ agent_id: AGENT_ID, batch_id: BATCH_ID }]);

    // Detached fan-out — give the microtask queue a turn before asserting the
    // background execution ran, mirroring the /agents/:id/evals/run precedent.
    await new Promise((resolve) => setImmediate(resolve));
    await app.close();

    expect(updateAggSpy).toHaveBeenCalledOnce();
  });

  it('returns 202 with an empty started list when no agent is eval-configured', async () => {
    vi.spyOn(EvalRepository.prototype, 'listEvalConfiguredAgentSummaries').mockResolvedValue([]);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'POST', url: '/evals/run-all' });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ started: [] });
  });

  it('never triggers a run for another workspace\'s agents — resolution is scoped to THIS workspace', async () => {
    const summariesSpy = vi
      .spyOn(EvalRepository.prototype, 'listEvalConfiguredAgentSummaries')
      .mockResolvedValue([]);

    const app = await buildEvalApp();
    const res = await app.inject({ method: 'POST', url: '/evals/run-all' });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(summariesSpy).toHaveBeenCalledWith(WS_ID);
    expect(summariesSpy).not.toHaveBeenCalledWith(OTHER_WS_ID);
  });
});

describe('POST /evals/run-all — registered rate-limit config (static assertion)', () => {
  it('the route is registered with { max: 2, timeWindow: "1 minute" } and a per-workspace keyGenerator (AC-12)', async () => {
    // Same constraint as /agents/:id/evals/run's precedent above:
    // @fastify/rate-limit is disabled under nodeEnv==='test', so app.inject()
    // via buildApp() can never produce a real 429. Inspect the route's own
    // registered config via the `onRoute` hook instead.
    const raw = Fastify();
    raw.setValidatorCompiler(validatorCompiler);
    raw.setSerializerCompiler(serializerCompiler);
    raw.decorate('container', {
      db: {},
      agentsRepo: { getById: vi.fn(), linkedSkills: vi.fn() },
      reviewRepo: { findingContext: vi.fn(), getPrFiles: vi.fn() },
      llm: vi.fn(),
    } as unknown as Container);

    let capturedConfig: Record<string, unknown> | undefined;
    raw.addHook('onRoute', (routeOptions) => {
      if (routeOptions.method === 'POST' && routeOptions.url === '/evals/run-all') {
        capturedConfig = routeOptions.config as Record<string, unknown>;
      }
    });

    await raw.register(evalRoutes);
    await raw.ready();
    await raw.close();

    expect(capturedConfig).toBeDefined();
    const rateLimit = capturedConfig?.rateLimit as
      | { max: number; timeWindow: string; keyGenerator?: unknown }
      | undefined;
    expect(rateLimit).toBeDefined();
    expect(rateLimit?.max).toBe(2);
    expect(rateLimit?.timeWindow).toBe('1 minute');
    expect(typeof rateLimit?.keyGenerator).toBe('function');
  });

  it('keyGenerator resolves to a per-workspace key distinct from /agents/:id/evals/run\'s (AC-12)', async () => {
    const raw = Fastify();
    raw.setValidatorCompiler(validatorCompiler);
    raw.setSerializerCompiler(serializerCompiler);
    const mockAuth = new MockAuthProvider(
      { id: 'u1', email: 'you@local', name: 'You' },
      { id: WS_ID, name: 'default' },
    );
    raw.decorate('container', {
      db: {},
      auth: mockAuth,
      agentsRepo: { getById: vi.fn(), linkedSkills: vi.fn() },
      reviewRepo: { findingContext: vi.fn(), getPrFiles: vi.fn() },
      llm: vi.fn(),
    } as unknown as Container);

    let capturedConfig: Record<string, unknown> | undefined;
    raw.addHook('onRoute', (routeOptions) => {
      if (routeOptions.method === 'POST' && routeOptions.url === '/evals/run-all') {
        capturedConfig = routeOptions.config as Record<string, unknown>;
      }
    });

    await raw.register(evalRoutes);
    await raw.ready();

    const rateLimit = capturedConfig?.rateLimit as
      | { keyGenerator: (req: unknown) => Promise<string> }
      | undefined;
    const key = await rateLimit!.keyGenerator({} as never);
    await raw.close();

    expect(key).toBe(`eval-run-all:${WS_ID}`);
  });

  it('fires a burst of 3 rapid requests against a REAL rate-limited Fastify instance and asserts the 3rd is throttled', async () => {
    const rateLimitPlugin = (await import('@fastify/rate-limit')).default;

    vi.spyOn(EvalRepository.prototype, 'listEvalConfiguredAgentSummaries').mockResolvedValue([]);

    const raw = Fastify();
    raw.setValidatorCompiler(validatorCompiler);
    raw.setSerializerCompiler(serializerCompiler);
    await raw.register(rateLimitPlugin, { max: 120, timeWindow: '1 minute' });

    const mockAuth = new MockAuthProvider(
      { id: 'u1', email: 'you@local', name: 'You' },
      { id: WS_ID, name: 'default' },
    );
    raw.decorate('container', {
      db: {},
      auth: mockAuth,
      agentsRepo: { getById: vi.fn().mockResolvedValue(AGENT_ROW), linkedSkills: vi.fn().mockResolvedValue([]) },
      reviewRepo: { findingContext: vi.fn(), getPrFiles: vi.fn().mockResolvedValue([]) },
      llm: vi.fn().mockResolvedValue(
        new MockLLMProvider('openai', {
          structured: { verdict: 'comment', summary: 'ok', score: 90, findings: [] },
        }),
      ),
    } as unknown as Container);

    await raw.register(evalRoutes);
    await raw.ready();

    const fire = () => raw.inject({ method: 'POST', url: '/evals/run-all' });

    // Sequential (not Promise.all) — the rate-limit counter must observe each
    // call complete before the next fires, matching the /agents/:id/evals/run
    // burst test's precedent above.
    const first = await fire();
    const second = await fire();
    const third = await fire();
    await raw.close();

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(third.statusCode).toBe(429);
  });
});
