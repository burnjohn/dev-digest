/**
 * Unit tests for the promote-from-eval-batch flow + version provenance
 * (Agent Eval Dashboard, Step 5).
 *
 * Hermetic: no Postgres, no Docker. `AgentsRepository.prototype` methods are
 * stubbed via `vi.spyOn` (mirrors `eval-service.test.ts`'s convention of
 * stubbing the repository layer rather than hand-rolling a fake Drizzle
 * `db`), and `container` is a plain object literal exposing only the member
 * the service touches (`evalRepo`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentsService } from '../src/modules/agents/service.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { toAgentVersionDto } from '../src/modules/agents/helpers.js';
import { ValidationError, NotFoundError } from '../src/platform/errors.js';
import type { Container } from '../src/platform/container.js';
import type { AgentRow, AgentVersionRow } from '../src/db/rows.js';

const WS_ID = '11111111-1111-1111-1111-111111111111';
const AGENT_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_AGENT_ID = '33333333-3333-3333-3333-333333333333';
const BATCH_ID = '44444444-4444-4444-4444-444444444444';

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

function buildContainer(opts: {
  getBatchPromptSnapshot?: { agentId: string; systemPromptSnapshot: string | null } | null;
}): Container {
  const container = {
    db: {} as never,
    evalRepo: {
      getBatchPromptSnapshot: vi.fn().mockResolvedValue(
        'getBatchPromptSnapshot' in opts ? opts.getBatchPromptSnapshot : null,
      ),
    },
  };
  return container as unknown as Container;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// AgentsService.promoteFromBatch
// ---------------------------------------------------------------------------

describe('AgentsService.promoteFromBatch', () => {
  it('throws NotFoundError when the batch does not exist/is not in this workspace, without mutating', async () => {
    const container = buildContainer({ getBatchPromptSnapshot: null });
    const updateSpy = vi.spyOn(AgentsRepository.prototype, 'update');
    const promoteSpy = vi.spyOn(AgentsRepository.prototype, 'promoteSystemPrompt');

    const service = new AgentsService(container);
    await expect(service.promoteFromBatch(WS_ID, AGENT_ID, BATCH_ID)).rejects.toThrow(
      NotFoundError,
    );

    expect(updateSpy).not.toHaveBeenCalled();
    expect(promoteSpy).not.toHaveBeenCalled();
  });

  it('throws ValidationError when the batch belongs to a DIFFERENT agent, without mutating (AC-25)', async () => {
    const container = buildContainer({
      getBatchPromptSnapshot: { agentId: OTHER_AGENT_ID, systemPromptSnapshot: 'Some prompt.' },
    });
    const updateSpy = vi.spyOn(AgentsRepository.prototype, 'update');
    const promoteSpy = vi.spyOn(AgentsRepository.prototype, 'promoteSystemPrompt');

    const service = new AgentsService(container);
    await expect(service.promoteFromBatch(WS_ID, AGENT_ID, BATCH_ID)).rejects.toThrow(
      ValidationError,
    );

    expect(updateSpy).not.toHaveBeenCalled();
    expect(promoteSpy).not.toHaveBeenCalled();
  });

  it('throws ValidationError when the batch has no stored prompt snapshot (AC-22), without mutating', async () => {
    const container = buildContainer({
      getBatchPromptSnapshot: { agentId: AGENT_ID, systemPromptSnapshot: null },
    });
    const updateSpy = vi.spyOn(AgentsRepository.prototype, 'update');
    const promoteSpy = vi.spyOn(AgentsRepository.prototype, 'promoteSystemPrompt');

    const service = new AgentsService(container);
    await expect(service.promoteFromBatch(WS_ID, AGENT_ID, BATCH_ID)).rejects.toThrow(
      ValidationError,
    );

    expect(updateSpy).not.toHaveBeenCalled();
    expect(promoteSpy).not.toHaveBeenCalled();
  });

  it('promotes the batch prompt onto the agent and returns the updated Agent DTO', async () => {
    const container = buildContainer({
      getBatchPromptSnapshot: { agentId: AGENT_ID, systemPromptSnapshot: 'Promoted prompt text.' },
    });
    const promoteSpy = vi
      .spyOn(AgentsRepository.prototype, 'promoteSystemPrompt')
      .mockResolvedValue({
        ...AGENT_ROW,
        systemPrompt: 'Promoted prompt text.',
        version: 2,
      });

    const service = new AgentsService(container);
    const result = await service.promoteFromBatch(WS_ID, AGENT_ID, BATCH_ID);

    expect(promoteSpy).toHaveBeenCalledWith(WS_ID, AGENT_ID, 'Promoted prompt text.', BATCH_ID);
    expect(result.system_prompt).toBe('Promoted prompt text.');
    expect(result.version).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AgentsRepository.update / promoteSystemPrompt — version provenance
// ---------------------------------------------------------------------------

describe('AgentsRepository — version provenance', () => {
  function makeDb(opts: { existing: AgentRow; updated: AgentRow }) {
    const insertedVersions: Record<string, unknown>[] = [];

    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [opts.existing]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [opts.updated]),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          insertedVersions.push(values);
          return { onConflictDoNothing: vi.fn(async () => undefined) };
        }),
      })),
    };
    return { db, insertedVersions };
  }

  it('an ordinary config edit (no promote) writes source: "manual" / source_batch_id: null', async () => {
    const existing = AGENT_ROW;
    const updated: AgentRow = { ...AGENT_ROW, model: 'gpt-4o', version: 2 };
    const { db, insertedVersions } = makeDb({ existing, updated });

    const repo = new AgentsRepository(db as never);
    vi.spyOn(AgentsRepository.prototype, 'skillIdsForAgent').mockResolvedValue([]);

    const row = await repo.update(WS_ID, AGENT_ID, { model: 'gpt-4o' });

    expect(row?.version).toBe(2);
    expect(insertedVersions).toHaveLength(1);
    expect(insertedVersions[0]).toMatchObject({
      agentId: AGENT_ID,
      version: 2,
      source: 'manual',
      sourceBatchId: null,
    });
  });

  it('a promote call bumps agents.version and inserts an agent_versions row with source: "eval_promote" + the correct source_batch_id', async () => {
    const existing = AGENT_ROW;
    const updated: AgentRow = { ...AGENT_ROW, systemPrompt: 'Promoted!', version: 2 };
    const { db, insertedVersions } = makeDb({ existing, updated });

    const repo = new AgentsRepository(db as never);
    vi.spyOn(AgentsRepository.prototype, 'skillIdsForAgent').mockResolvedValue([]);

    const row = await repo.update(
      WS_ID,
      AGENT_ID,
      { systemPrompt: 'Promoted!' },
      { sourceBatchId: BATCH_ID },
    );

    expect(row?.version).toBe(2);
    expect(insertedVersions).toHaveLength(1);
    expect(insertedVersions[0]).toMatchObject({
      agentId: AGENT_ID,
      version: 2,
      source: 'eval_promote',
      sourceBatchId: BATCH_ID,
    });
  });

  it('promoteSystemPrompt delegates to update() with the promote provenance and the new prompt text', async () => {
    const existing = AGENT_ROW;
    const updated: AgentRow = { ...AGENT_ROW, systemPrompt: 'New prompt.', version: 2 };
    const { db, insertedVersions } = makeDb({ existing, updated });

    const repo = new AgentsRepository(db as never);
    vi.spyOn(AgentsRepository.prototype, 'skillIdsForAgent').mockResolvedValue([]);
    const updateSpy = vi.spyOn(repo, 'update');

    const row = await repo.promoteSystemPrompt(WS_ID, AGENT_ID, 'New prompt.', BATCH_ID);

    expect(updateSpy).toHaveBeenCalledWith(
      WS_ID,
      AGENT_ID,
      { systemPrompt: 'New prompt.' },
      { sourceBatchId: BATCH_ID },
    );
    expect(row?.systemPrompt).toBe('New prompt.');
    expect(insertedVersions[0]).toMatchObject({ source: 'eval_promote', sourceBatchId: BATCH_ID });
  });
});

// ---------------------------------------------------------------------------
// helpers.toAgentVersionDto — maps source/source_batch_id
// ---------------------------------------------------------------------------

describe('toAgentVersionDto', () => {
  const BASE_VERSION_ROW: AgentVersionRow = {
    agentId: AGENT_ID,
    version: 1,
    configJson: {
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'x',
      output_schema: null,
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skills: [],
    },
    source: null,
    sourceBatchId: null,
    createdAt: new Date('2026-01-01'),
  };

  it('defaults source to "manual" and source_batch_id to null for a legacy row (both columns null)', () => {
    const dto = toAgentVersionDto(BASE_VERSION_ROW);
    expect(dto.source).toBe('manual');
    expect(dto.source_batch_id).toBeNull();
  });

  it('maps a promoted version row to source: "eval_promote" + the batch id', () => {
    const dto = toAgentVersionDto({
      ...BASE_VERSION_ROW,
      source: 'eval_promote',
      sourceBatchId: BATCH_ID,
    });
    expect(dto.source).toBe('eval_promote');
    expect(dto.source_batch_id).toBe(BATCH_ID);
  });
});
