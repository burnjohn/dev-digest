/**
 * Route tests for the skill-eval sub-plugin (`src/modules/skills/eval-routes.ts`)
 * plus the reshaped `GET /skills/:id/evals` handler in `skills/routes.ts`:
 *
 *   GET    /skills/:id/evals                  (reshaped — SkillEvalCaseListResponse)
 *   PATCH  /skills/:id/evals/:caseId
 *   POST   /findings/:id/evals/skill-case
 *   POST   /skills/:id/evals/run
 *   GET    /skills/:id/evals/batches
 *   GET    /skills/:id/evals/batches/:batchId
 *
 * Hermetic: no Postgres, no Docker.
 *
 * Strategy mirrors `test/eval-routes.test.ts` (buildApp + MockAuthProvider +
 * repository-prototype spies) and `test/blast-routes.test.ts`/
 * `test/brief-routes.test.ts` (getter-only container facade patching via
 * `Object.defineProperty` — plain assignment throws "has only a getter" on a
 * REAL `Container` instance, per `server/insights.md`'s 2026-07-03 Quirk
 * entry).
 *
 * Rate-limit note: `@fastify/rate-limit` is disabled entirely when
 * `nodeEnv==='test'` (`src/app.ts`), so the app built via `buildApp()` can
 * never produce a real 429 via `app.inject()`. AC-18 is therefore covered by
 * a genuine live-429 test against a RAW Fastify instance (not built via
 * `buildApp()`) with `@fastify/rate-limit` registered directly — mirrors
 * `test/eval-routes.test.ts`'s identical precedent.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider, MockLLMProvider } from '../src/adapters/mocks.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';
import { SkillEvalRepository } from '../src/modules/skills/eval-repository.js';
import skillEvalRoutes from '../src/modules/skills/eval-routes.js';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../src/platform/container.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_WS_ID = '99999999-9999-9999-9999-999999999999';
const SKILL_ID = '33333333-3333-3333-3333-333333333333';
const HOST_AGENT_ID = 'aaaaaaaa-4444-4444-4444-444444444444';
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

const SKILL_ROW = {
  id: SKILL_ID,
  workspaceId: WS_ID,
  name: 'Test Skill',
  description: '',
  type: 'convention' as const,
  source: 'manual' as const,
  body: 'Always validate input.',
  enabled: true,
  version: 1,
  createdAt: new Date('2026-01-01'),
};

const AGENT_ROW = {
  id: HOST_AGENT_ID,
  workspaceId: WS_ID,
  name: 'Host Agent',
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
    ownerKind: 'skill' as const,
    ownerId: SKILL_ID,
    name: 'A case',
    inputDiff: VALID_DIFF,
    inputFiles: null,
    inputMeta: { source: 'manual' },
    expectedOutput: { practices: ['does the thing'], grounding: ['thing'], threshold: 0.6 },
    notes: null,
    ...overrides,
  };
}

function makeBatchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BATCH_ID,
    workspaceId: WS_ID,
    skillId: SKILL_ID,
    hostAgentId: HOST_AGENT_ID,
    kind: 'full' as const,
    status: 'clean' as const,
    snapshotIdentity: { skillBody: 'x', skillVersion: 1, hostAgentModel: 'gpt-4.1', hostAgentId: HOST_AGENT_ID },
    model: 'gpt-4.1',
    judgeScore: 1,
    groundingPassRate: 1,
    casesPassing: 1,
    casesTotal: 1,
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

async function buildSkillEvalApp(opts: BuildOpts = {}): Promise<FastifyInstance> {
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
      structured: { results: [{ practice: 'does the thing', passed: true, evidence: 'thing' }] },
    });
  app.container.llm = vi.fn().mockResolvedValue(llm) as unknown as Container['llm'];

  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// GET /skills/:id/evals (reshaped — SkillEvalCaseListResponse)
// ---------------------------------------------------------------------------

describe('GET /skills/:id/evals (reshaped)', () => {
  it('returns 200 with { cases } and flat last_run_status/last_run_summary/last_host_agent_id fields', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(SKILL_ROW as any);
    vi.spyOn(SkillEvalRepository.prototype, 'listCases').mockResolvedValue([makeCaseRow()] as any);
    vi.spyOn(SkillEvalRepository.prototype, 'latestRunForCase').mockResolvedValue(null);

    const app = await buildSkillEvalApp();
    const res = await app.inject({ method: 'GET', url: `/skills/${SKILL_ID}/evals` });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('cases');
    expect(body.cases).toHaveLength(1);
    expect(body.cases[0]).toMatchObject({
      id: CASE_ID,
      last_run_status: 'never_run',
    });
    // flat fields present (not nested under a last_run object)
    expect(body.cases[0]).toHaveProperty('last_run_summary');
    expect(body.cases[0]).toHaveProperty('last_host_agent_id');
  });

  it('returns 404 for a cross-workspace/missing skill', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(undefined);

    const app = await buildSkillEvalApp();
    const res = await app.inject({ method: 'GET', url: `/skills/${SKILL_ID}/evals` });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /skills/:id/evals/:caseId
// ---------------------------------------------------------------------------

describe('PATCH /skills/:id/evals/:caseId', () => {
  it('returns 200 and persists the edit with valid practices/grounding', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(SKILL_ROW as any);
    const updateSpy = vi
      .spyOn(SkillsRepository.prototype, 'updateEvalCase')
      .mockImplementation(async (_ws, _skillId, _caseId, data: any) => ({
        ...makeCaseRow(),
        name: data.name,
        expectedOutput: data.expected_output,
      }));

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/skills/${SKILL_ID}/evals/${CASE_ID}`,
      payload: {
        skill_id: SKILL_ID,
        name: 'Updated case',
        fixture: VALID_DIFF,
        practices: ['does the thing'],
        grounding: [],
        threshold: 0.7,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledOnce();
    expect(res.json().name).toBe('Updated case');
    expect(res.json().threshold).toBe(0.7);
  });

  it('returns 404 for a cross-workspace/missing skill', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(undefined);
    const updateSpy = vi.spyOn(SkillsRepository.prototype, 'updateEvalCase');

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/skills/${SKILL_ID}/evals/${CASE_ID}`,
      payload: {
        skill_id: SKILL_ID,
        name: 'Updated case',
        fixture: VALID_DIFF,
        practices: ['does the thing'],
        grounding: [],
        threshold: 0.7,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('returns 400/422 (ValidationError) when both practices and grounding are missing', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(SKILL_ROW as any);
    const updateSpy = vi.spyOn(SkillsRepository.prototype, 'updateEvalCase');

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/skills/${SKILL_ID}/evals/${CASE_ID}`,
      payload: {
        skill_id: SKILL_ID,
        name: 'Bad edit',
        fixture: VALID_DIFF,
        practices: [],
        grounding: [],
        threshold: 0.6,
      },
    });
    await app.close();

    expect([400, 422]).toContain(res.statusCode);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /skills/:id/evals (create — via SkillEvalService.createCaseManual)
// ---------------------------------------------------------------------------

describe('POST /skills/:id/evals (create)', () => {
  it('returns 201 and persists a valid manual case with source:manual (AC-8)', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(SKILL_ROW as any);
    const insertSpy = vi
      .spyOn(SkillsRepository.prototype, 'insertEvalCase')
      .mockImplementation(async (data: any) => ({
        ...makeCaseRow(),
        name: data.name,
        inputDiff: data.input_diff,
        expectedOutput: data.expected_output,
        inputMeta: data.input_meta,
      }));

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${SKILL_ID}/evals`,
      payload: {
        skill_id: SKILL_ID,
        name: 'New case',
        fixture: VALID_DIFF,
        practices: ['does the thing'],
        grounding: [],
        threshold: 0.6,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    expect(insertSpy).toHaveBeenCalledOnce();
    expect(res.json().name).toBe('New case');
    // AC-8: manual provenance defaulted server-side.
    expect((insertSpy.mock.calls[0]![0] as any).input_meta).toEqual({ source: 'manual' });
  });

  it('returns 400/422 (ValidationError) when both practices and grounding are missing (AC-2)', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(SKILL_ROW as any);
    const insertSpy = vi.spyOn(SkillsRepository.prototype, 'insertEvalCase');

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${SKILL_ID}/evals`,
      payload: {
        skill_id: SKILL_ID,
        name: 'Bad create',
        fixture: VALID_DIFF,
        practices: [],
        grounding: [],
        threshold: 0.6,
      },
    });
    await app.close();

    expect([400, 422]).toContain(res.statusCode);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('returns 400/422 (ValidationError) when the fixture is empty (AC-3)', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(SKILL_ROW as any);
    const insertSpy = vi.spyOn(SkillsRepository.prototype, 'insertEvalCase');

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${SKILL_ID}/evals`,
      payload: {
        skill_id: SKILL_ID,
        name: 'Empty fixture',
        fixture: '   ',
        practices: ['does the thing'],
        grounding: [],
        threshold: 0.6,
      },
    });
    await app.close();

    expect([400, 422]).toContain(res.statusCode);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /findings/:id/evals/skill-case
// ---------------------------------------------------------------------------

describe('POST /findings/:id/evals/skill-case', () => {
  it('returns 200 and creates a case from an accepted finding (AC-4/AC-6)', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(SKILL_ROW as any);
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
        rationale: 'Do not hardcode secrets in source',
        suggestion: null,
        confidence: 0.9,
        kind: 'finding',
        acceptedAt: new Date('2026-01-01'),
        dismissedAt: null,
      },
      review: { id: REVIEW_ID, agentId: HOST_AGENT_ID, prId: PR_ID },
      pull: { id: PR_ID, workspaceId: WS_ID, number: 42 },
    });
    const getPrFiles = vi
      .fn()
      .mockResolvedValue([
        { path: 'src/config.ts', patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "x",\n   redisUrl: x,' },
      ]);

    vi.spyOn(SkillsRepository.prototype, 'insertEvalCase').mockImplementation(async (data: any) => ({
      id: 'new-case',
      workspaceId: data.workspaceId,
      ownerKind: 'skill',
      ownerId: data.skillId,
      name: data.name,
      inputDiff: data.input_diff,
      inputFiles: null,
      inputMeta: data.input_meta,
      expectedOutput: data.expected_output,
      notes: data.notes ?? null,
    }));

    const app = await buildSkillEvalApp({ reviewRepo: { findingContext, getPrFiles } });
    const res = await app.inject({
      method: 'POST',
      url: `/findings/${FINDING_ID}/evals/skill-case`,
      payload: { skill_id: SKILL_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().skill_id).toBe(SKILL_ID);
    expect(res.json().practices[0]).toContain('security');
  });

  it('returns 404 for a finding belonging to a different workspace', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(SKILL_ROW as any);
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
      review: { id: REVIEW_ID, agentId: HOST_AGENT_ID, prId: PR_ID },
      pull: { id: PR_ID, workspaceId: OTHER_WS_ID, number: 1 },
    });

    const app = await buildSkillEvalApp({ reviewRepo: { findingContext } });
    const res = await app.inject({
      method: 'POST',
      url: `/findings/${FINDING_ID}/evals/skill-case`,
      payload: { skill_id: SKILL_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a cross-workspace/missing skill_id', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(undefined);

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'POST',
      url: `/findings/${FINDING_ID}/evals/skill-case`,
      payload: { skill_id: SKILL_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /skills/:id/evals/run
// ---------------------------------------------------------------------------

describe('POST /skills/:id/evals/run', () => {
  it('returns 202 with a batch_id when case_ids is omitted, and the fan-out completes detached (AC-11/12/14/18/19)', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(SKILL_ROW as any);
    vi.spyOn(SkillEvalRepository.prototype, 'listCases').mockResolvedValue([makeCaseRow()] as any);
    vi.spyOn(SkillEvalRepository.prototype, 'insertBatch').mockResolvedValue(makeBatchRow({ status: null }) as any);
    vi.spyOn(SkillEvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    const updateAggSpy = vi.spyOn(SkillEvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${SKILL_ID}/evals/run`,
      payload: { host_agent_id: HOST_AGENT_ID },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().batch_id).toBe(BATCH_ID);

    // The fan-out is detached (void, not awaited by the route) — give the
    // microtask queue a turn so `executeEvalRun`'s async work actually runs
    // before asserting it happened.
    await new Promise((resolve) => setImmediate(resolve));
    await app.close();

    expect(updateAggSpy).toHaveBeenCalledOnce();
  });

  it('returns 404 for a cross-workspace/missing skill', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(undefined);
    const insertBatchSpy = vi.spyOn(SkillEvalRepository.prototype, 'insertBatch');

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${SKILL_ID}/evals/run`,
      payload: { host_agent_id: HOST_AGENT_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(insertBatchSpy).not.toHaveBeenCalled();
  });

  it('returns 404 for a cross-workspace/missing host agent', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(SKILL_ROW as any);
    const insertBatchSpy = vi.spyOn(SkillEvalRepository.prototype, 'insertBatch');

    const app = await buildSkillEvalApp({ agentsRepo: { getById: vi.fn().mockResolvedValue(undefined) } });
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${SKILL_ID}/evals/run`,
      payload: { host_agent_id: HOST_AGENT_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(insertBatchSpy).not.toHaveBeenCalled();
  });

  it('returns 422 for a missing host_agent_id in the body', async () => {
    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${SKILL_ID}/evals/run`,
      payload: {},
    });
    await app.close();

    expect(res.statusCode).toBe(422);
  });
});

describe('POST /skills/:id/evals/run — registered rate-limit config (static assertion)', () => {
  it('the route is registered with { max: 2, timeWindow: "1 minute" } and a per-workspace keyGenerator (AC-18)', async () => {
    // A real 429 CANNOT be produced hermetically here — @fastify/rate-limit is
    // disabled entirely when nodeEnv==='test' (src/app.ts), so app.inject()
    // never actually throttles regardless of how many requests are fired.
    const raw = Fastify();
    raw.setValidatorCompiler(validatorCompiler);
    raw.setSerializerCompiler(serializerCompiler);
    raw.decorate('container', {
      db: {},
      skillsRepo: { getById: vi.fn() },
      agentsRepo: { getById: vi.fn(), linkedSkills: vi.fn() },
      reviewRepo: { findingContext: vi.fn(), getPrFiles: vi.fn() },
      llm: vi.fn(),
    } as unknown as Container);

    let capturedConfig: Record<string, unknown> | undefined;
    raw.addHook('onRoute', (routeOptions) => {
      if (routeOptions.method === 'POST' && routeOptions.url === '/skills/:id/evals/run') {
        capturedConfig = routeOptions.config as Record<string, unknown>;
      }
    });

    await raw.register(skillEvalRoutes);
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

  it('fires 3 rapid requests against a REAL rate-limited Fastify instance and asserts the 3rd is throttled', async () => {
    // Unlike the app built via buildApp() (which runs under nodeEnv==='test'
    // and therefore never registers @fastify/rate-limit at all), build a raw
    // Fastify instance here and register @fastify/rate-limit ourselves so
    // this test can genuinely assert a 429 on burst traffic, not just a
    // static config shape.
    const rateLimitPlugin = (await import('@fastify/rate-limit')).default;

    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(SKILL_ROW as any);
    vi.spyOn(SkillEvalRepository.prototype, 'listCases').mockResolvedValue([makeCaseRow()] as any);
    vi.spyOn(SkillEvalRepository.prototype, 'insertBatch').mockResolvedValue(makeBatchRow() as any);
    vi.spyOn(SkillEvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    vi.spyOn(SkillEvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

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
      skillsRepo: { getById: vi.fn().mockResolvedValue(SKILL_ROW) },
      agentsRepo: { getById: vi.fn().mockResolvedValue(AGENT_ROW), linkedSkills: vi.fn().mockResolvedValue([]) },
      reviewRepo: { findingContext: vi.fn(), getPrFiles: vi.fn().mockResolvedValue([]) },
      llm: vi.fn().mockResolvedValue(
        new MockLLMProvider('openai', {
          structured: { results: [{ practice: 'does the thing', passed: true, evidence: 'thing' }] },
        }),
      ),
    } as unknown as Container);

    await raw.register(skillEvalRoutes);
    await raw.ready();

    const fire = () =>
      raw.inject({
        method: 'POST',
        url: `/skills/${SKILL_ID}/evals/run`,
        payload: { host_agent_id: HOST_AGENT_ID },
      });

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
// GET /skills/:id/evals/batches[/:batchId]
// ---------------------------------------------------------------------------

describe('GET /skills/:id/evals/batches', () => {
  it('returns 200 with batch history (AC-32)', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'listBatchHistory').mockResolvedValue([makeBatchRow()] as any);

    const app = await buildSkillEvalApp();
    const res = await app.inject({ method: 'GET', url: `/skills/${SKILL_ID}/evals/batches` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe(BATCH_ID);
  });
});

describe('GET /skills/:id/evals/batches/:batchId', () => {
  it('returns 200 with the batch drill-down (AC-32)', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'getBatch').mockResolvedValue(makeBatchRow() as any);
    vi.spyOn(SkillEvalRepository.prototype, 'runsForBatch').mockResolvedValue([]);

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'GET',
      url: `/skills/${SKILL_ID}/evals/batches/${BATCH_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(BATCH_ID);
    expect(res.json().cases).toEqual([]);
  });

  it('returns 404 for a cross-workspace/missing batch', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'getBatch').mockResolvedValue(null);

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'GET',
      url: `/skills/${SKILL_ID}/evals/batches/${BATCH_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it('returns 422 for a non-UUID batch id', async () => {
    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'GET',
      url: `/skills/${SKILL_ID}/evals/batches/${INVALID_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// GET /skills/:id/evals/trend
// ---------------------------------------------------------------------------

describe('GET /skills/:id/evals/trend', () => {
  it('returns 200 with trend points', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'listTrendBatches').mockResolvedValue([makeBatchRow()] as any);

    const app = await buildSkillEvalApp();
    const res = await app.inject({ method: 'GET', url: `/skills/${SKILL_ID}/evals/trend` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].batch_id).toBe(BATCH_ID);
  });
});

// ---------------------------------------------------------------------------
// GET /skills/:id/evals/compare
// ---------------------------------------------------------------------------

describe('GET /skills/:id/evals/compare', () => {
  it('returns 200 with a/b/deltas for two valid UUID batch ids', async () => {
    const OTHER_BATCH_ID = '99999999-4444-4444-4444-444444444444';
    const detailA = { ...makeBatchRow({ id: BATCH_ID, judgeScore: 0.6 }), cases: [] };
    const detailB = { ...makeBatchRow({ id: OTHER_BATCH_ID, judgeScore: 0.9 }), cases: [] };
    vi.spyOn(SkillEvalRepository.prototype, 'getBatch').mockImplementation(
      async (_ws: string, batchId: string) => (batchId === BATCH_ID ? detailA : detailB) as any,
    );
    vi.spyOn(SkillEvalRepository.prototype, 'runsForBatch').mockResolvedValue([]);

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'GET',
      url: `/skills/${SKILL_ID}/evals/compare?a=${BATCH_ID}&b=${OTHER_BATCH_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().a.id).toBe(BATCH_ID);
    expect(res.json().b.id).toBe(OTHER_BATCH_ID);
    expect(res.json().deltas.judge_score).toBeCloseTo(0.3, 6);
  });

  it('returns 422 for a non-uuid a/b', async () => {
    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'GET',
      url: `/skills/${SKILL_ID}/evals/compare?a=${INVALID_ID}&b=${BATCH_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// GET /skills/:id/evals/kpi-delta
// ---------------------------------------------------------------------------

describe('GET /skills/:id/evals/kpi-delta', () => {
  it('returns 200 with a delta when a previous full batch exists', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'getBatch').mockResolvedValue(
      makeBatchRow({ judgeScore: 0.9, groundingPassRate: 1, casesPassing: 5, casesTotal: 5 }) as any,
    );
    vi.spyOn(SkillEvalRepository.prototype, 'previousFullBatch').mockResolvedValue(
      makeBatchRow({ id: 'previous-batch', judgeScore: 0.7, groundingPassRate: 0.8, casesPassing: 3, casesTotal: 5 }) as any,
    );

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'GET',
      url: `/skills/${SKILL_ID}/evals/kpi-delta?batch_id=${BATCH_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().judge_score).toBeCloseTo(0.2, 6);
  });

  it('returns 200 with null when there is no previous full batch', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'getBatch').mockResolvedValue(makeBatchRow() as any);
    vi.spyOn(SkillEvalRepository.prototype, 'previousFullBatch').mockResolvedValue(null);

    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'GET',
      url: `/skills/${SKILL_ID}/evals/kpi-delta?batch_id=${BATCH_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('returns 422 for a non-uuid batch_id', async () => {
    const app = await buildSkillEvalApp();
    const res = await app.inject({
      method: 'GET',
      url: `/skills/${SKILL_ID}/evals/kpi-delta?batch_id=${INVALID_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// DELETE /skills/:id/evals/batches
// ---------------------------------------------------------------------------

describe('DELETE /skills/:id/evals/batches', () => {
  it('returns 200 with deleted_batches/deleted_runs on a valid skill', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(SKILL_ROW as any);
    const clearHistorySpy = vi
      .spyOn(SkillEvalRepository.prototype, 'clearHistory')
      .mockResolvedValue({ deletedBatches: 2, deletedRuns: 7 });

    const app = await buildSkillEvalApp();
    const res = await app.inject({ method: 'DELETE', url: `/skills/${SKILL_ID}/evals/batches` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted_batches: 2, deleted_runs: 7 });
    expect(clearHistorySpy).toHaveBeenCalledWith(WS_ID, SKILL_ID);
  });

  it('returns 404 for a cross-workspace/missing skill', async () => {
    vi.spyOn(SkillsRepository.prototype, 'getById').mockResolvedValue(undefined);
    const clearHistorySpy = vi.spyOn(SkillEvalRepository.prototype, 'clearHistory');

    const app = await buildSkillEvalApp();
    const res = await app.inject({ method: 'DELETE', url: `/skills/${SKILL_ID}/evals/batches` });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(clearHistorySpy).not.toHaveBeenCalled();
  });
});
