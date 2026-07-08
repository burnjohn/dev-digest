/**
 * Route test for `POST /agents/:id/evals/promote` (Agent Eval Dashboard, Step 7).
 *
 * Hermetic: no Postgres, no Docker. `AgentsService.promoteFromBatch` is already
 * fully unit-tested against a fake container in `test/agents-promote.test.ts`
 * (NotFoundError / cross-agent ValidationError / no-snapshot ValidationError /
 * happy path) — this file only exercises the ROUTE layer: schema wiring
 * (`IdParams` + `EvalPromoteRequest`), the `getContext`→service call, and the
 * error → HTTP status mapping (`ApiErrorBody` shape for 400).
 *
 * Strategy mirrors `test/eval-routes.test.ts`: build a real app via
 * `buildApp()` with `MockAuthProvider` (known workspaceId), and stub
 * `EvalRepository.prototype.getBatchPromptSnapshot` +
 * `AgentsRepository.prototype.promoteSystemPrompt` via `vi.spyOn` — the
 * established convention for avoiding a hand-rolled fake Drizzle `db` per
 * route test.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import { EvalRepository } from '../src/modules/eval/repository.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import type { FastifyInstance } from 'fastify';
import type { AgentRow } from '../src/db/rows.js';

const WS_ID = '22222222-2222-2222-2222-222222222222';
const AGENT_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_AGENT_ID = '44444444-4444-4444-4444-444444444444';
const BATCH_ID = '55555555-5555-5555-5555-555555555555';
const INVALID_ID = 'not-a-uuid';

const AGENT_ROW: AgentRow = {
  id: AGENT_ID,
  workspaceId: WS_ID,
  name: 'Test Agent',
  description: '',
  provider: 'openai',
  model: 'gpt-4.1',
  systemPrompt: 'You are a reviewer.',
  outputSchema: null,
  strategy: 'single-pass',
  ciFailOn: 'critical',
  repoIntel: true,
  enabled: true,
  version: 1,
  createdBy: null,
  createdAt: new Date('2026-01-01'),
};

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

async function buildPromoteApp(): Promise<FastifyInstance> {
  const mockAuth = new MockAuthProvider(
    { id: 'u1', email: 'you@local', name: 'You' },
    { id: WS_ID, name: 'default' },
  );
  return buildApp({ config, overrides: { auth: mockAuth } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /agents/:id/evals/promote', () => {
  it('returns 422 for a non-UUID agent id', async () => {
    const app = await buildPromoteApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${INVALID_ID}/evals/promote`,
      payload: { batch_id: BATCH_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(422);
  });

  it('returns 422 for a non-UUID batch_id in the body', async () => {
    const app = await buildPromoteApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/evals/promote`,
      payload: { batch_id: INVALID_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(422);
  });

  it('returns 422 with an ApiErrorBody shape when the batch belongs to a DIFFERENT agent (ValidationError)', async () => {
    // ValidationError (src/platform/errors.ts) is constructed with statusCode
    // 422, not 400 — the setErrorHandler maps AppError subclasses to their own
    // `statusCode` field. Verified against the actual error handler behavior.
    vi.spyOn(EvalRepository.prototype, 'getBatchPromptSnapshot').mockResolvedValue({
      agentId: OTHER_AGENT_ID,
      systemPromptSnapshot: 'Some prompt.',
    });
    const promoteSpy = vi.spyOn(AgentsRepository.prototype, 'promoteSystemPrompt');

    const app = await buildPromoteApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/evals/promote`,
      payload: { batch_id: BATCH_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(422);
    const body = res.json();
    // ApiErrorBody envelope (src/app.ts's setErrorHandler): { error: { code, message, details? } }
    expect(body).toMatchObject({
      error: { code: 'validation_error', message: expect.any(String) },
    });
    expect(promoteSpy).not.toHaveBeenCalled();
  });

  it('returns 200 with the updated Agent when the same-agent batch has a stored prompt snapshot', async () => {
    vi.spyOn(EvalRepository.prototype, 'getBatchPromptSnapshot').mockResolvedValue({
      agentId: AGENT_ID,
      systemPromptSnapshot: 'Promoted prompt text.',
    });
    const promoteSpy = vi
      .spyOn(AgentsRepository.prototype, 'promoteSystemPrompt')
      .mockResolvedValue({
        ...AGENT_ROW,
        systemPrompt: 'Promoted prompt text.',
        version: 2,
      });

    const app = await buildPromoteApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/evals/promote`,
      payload: { batch_id: BATCH_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(AGENT_ID);
    expect(body.system_prompt).toBe('Promoted prompt text.');
    expect(body.version).toBe(2);
    expect(promoteSpy).toHaveBeenCalledWith(WS_ID, AGENT_ID, 'Promoted prompt text.', BATCH_ID);
  });
});
