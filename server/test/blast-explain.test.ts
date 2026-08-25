import { describe, it, expect, vi, afterEach } from 'vitest';
import type { LLMProvider } from '@devdigest/shared';
import type { Db } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import type { RepoIntel, BlastResult, IndexState } from '../src/modules/repo-intel/types.js';
import { BlastService, type BlastServiceDeps } from '../src/modules/blast/service.js';
import {
  narrateBlastRadius,
  BLAST_NARRATION_SCHEMA_NAME,
  type BlastNarrationInput,
} from '../src/modules/blast/explain.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';

/**
 * Hermetic coverage for D3/T9's flagged one-paragraph narration (plan
 * 06-blast-radius.md T9) — `explain.ts`'s prompt/grounding logic directly,
 * plus `service.ts`'s wiring (REQ-20's structural "flag off => no model, no
 * LLM call" and REQ-19's "verify, do not trust" grounding check). No DB, no
 * Docker (`onion-architecture` §5 Tests; `server/INSIGHTS.md` 2026-08-09) —
 * `Deps` object literals throughout, no `as never`, no private-field write.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function baseInput(overrides: Partial<BlastNarrationInput> = {}): BlastNarrationInput {
  return {
    status: 'ok',
    totals: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
    symbols: [
      {
        name: 'getBlastRadius',
        file: 'src/modules/blast/service.ts',
        kind: 'method',
        callers: [{ file: 'src/modules/blast/routes.ts', symbol: 'blastRoutes', line: 33, rank: 1 }],
        caller_count: 1,
        chips: [{ label: 'GET /pulls/:id/blast', kind: 'endpoint', file: 'src/modules/blast/routes.ts' }],
      },
    ],
    file_impact: [],
    ...overrides,
  };
}

function llmResolvingTo(provider: LLMProvider) {
  return async () => provider;
}

describe('narrateBlastRadius — prompt is facts-only, verify-don\'t-trust grounding', () => {
  it('returns the model\'s paragraph when every mention traces back to the computed input', async () => {
    const mock = new MockLLMProvider('openai', {
      structuredBySchema: {
        [BLAST_NARRATION_SCHEMA_NAME]: {
          narrative:
            'getBlastRadius in src/modules/blast/service.ts is called from src/modules/blast/routes.ts.',
        },
      },
    });
    const result = await narrateBlastRadius(
      { llm: llmResolvingTo(mock) },
      baseInput(),
      { provider: 'openai', model: 'gpt-test' },
    );
    expect(result).toBe(
      'getBlastRadius in src/modules/blast/service.ts is called from src/modules/blast/routes.ts.',
    );
  });

  it('drops a narration that names a symbol absent from the computed input (fabrication)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mock = new MockLLMProvider('openai', {
      structuredBySchema: {
        [BLAST_NARRATION_SCHEMA_NAME]: {
          narrative: 'This also touches processPaymentRefund, which is unrelated to the diff.',
        },
      },
    });
    const result = await narrateBlastRadius(
      { llm: llmResolvingTo(mock) },
      baseInput(),
      { provider: 'openai', model: 'gpt-test' },
    );
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('drops a narration that names a file path absent from the computed input', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mock = new MockLLMProvider('openai', {
      structuredBySchema: {
        [BLAST_NARRATION_SCHEMA_NAME]: {
          narrative: 'It also affects src/modules/payments/gateway.ts.',
        },
      },
    });
    const result = await narrateBlastRadius(
      { llm: llmResolvingTo(mock) },
      baseInput(),
      { provider: 'openai', model: 'gpt-test' },
    );
    expect(result).toBeNull();
  });

  it('resolves to null (never throws) when the paragraph is empty', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mock = new MockLLMProvider('openai', {
      structuredBySchema: { [BLAST_NARRATION_SCHEMA_NAME]: { narrative: '   ' } },
    });
    const result = await narrateBlastRadius(
      { llm: llmResolvingTo(mock) },
      baseInput(),
      { provider: 'openai', model: 'gpt-test' },
    );
    expect(result).toBeNull();
  });

  it('resolves to null (never throws) when the provider cannot be resolved', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await narrateBlastRadius(
      {
        llm: async () => {
          throw new Error('no OPENAI_API_KEY configured');
        },
      },
      baseInput(),
      { provider: 'openai', model: 'gpt-test' },
    );
    expect(result).toBeNull();
  });

  it('resolves to null (never throws) when completeStructured itself rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rejecting: LLMProvider = {
      id: 'openai',
      listModels: async () => [],
      complete: async () => {
        throw new Error('unused');
      },
      completeStructured: async () => {
        throw new Error('timeout');
      },
      embed: async () => [],
    };
    const result = await narrateBlastRadius(
      { llm: llmResolvingTo(rejecting) },
      baseInput(),
      { provider: 'openai', model: 'gpt-test' },
    );
    expect(result).toBeNull();
  });
});

// ---- service.ts wiring --------------------------------------------------

type Row = Record<string, unknown>;

function fakeDb(rowsByTable: Map<unknown, Row[]>): Db {
  const db = {
    select: (..._cols: unknown[]) => ({
      from: (table: unknown) => ({
        where: async () => rowsByTable.get(table) ?? [],
      }),
    }),
  };
  return db as unknown as Db;
}

function fakeRepoIntel(overrides: Partial<RepoIntel>): RepoIntel {
  const notStubbed =
    (name: string) =>
    (..._args: unknown[]) => {
      throw new Error(`fakeRepoIntel.${name} not stubbed for this test`);
    };
  return {
    indexRepo: notStubbed('indexRepo'),
    refreshIndex: notStubbed('refreshIndex'),
    getIndexState: notStubbed('getIndexState'),
    getBlastRadius: notStubbed('getBlastRadius'),
    getRepoMap: notStubbed('getRepoMap'),
    getFileRank: notStubbed('getFileRank'),
    getSymbolsInFiles: notStubbed('getSymbolsInFiles'),
    getCallerSignatures: notStubbed('getCallerSignatures'),
    getUnresolvedReferences: notStubbed('getUnresolvedReferences'),
    getConventionSamples: notStubbed('getConventionSamples'),
    getAllSymbolNames: notStubbed('getAllSymbolNames'),
    getTopFilesByRank: notStubbed('getTopFilesByRank'),
    getCriticalPaths: notStubbed('getCriticalPaths'),
    ...overrides,
  };
}

function baseIndexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo-1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: 'sha1',
    indexerVersion: 2,
    updatedAt: new Date('2026-08-24T00:00:00Z'),
    ...overrides,
  };
}

function throwingLlm(): BlastServiceDeps['llm'] {
  return () => {
    throw new Error('deps.llm must NOT be invoked — REQ-20');
  };
}

function baseDeps(overrides: Partial<BlastServiceDeps> = {}): BlastServiceDeps {
  const blastResult: BlastResult = {
    changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
    callers: [{ file: 'src/caller.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 5 }],
    impactedEndpoints: [],
    degraded: false,
  };
  const db = fakeDb(
    new Map<unknown, Row[]>([
      [schema.pullRequests, [{ id: 'pr-1', repoId: 'repo-1', headSha: 'sha1' }]],
      [schema.prFiles, [{ path: 'src/a.ts' }]],
      [schema.fileFacts, []],
    ]),
  );
  return {
    db,
    repoIntel: fakeRepoIntel({
      getBlastRadius: async () => blastResult,
      getIndexState: async () => baseIndexState({ status: 'full' }),
    }),
    llm: throwingLlm(),
    ...overrides,
  };
}

describe('BlastService.getBlastRadius — narration wiring (T9, D3)', () => {
  it('REQ-20 — no narrationModel arg: narrative stays null and deps.llm is NEVER called', async () => {
    // D2: a real spy, not `throwingLlm()`. Two spies, because a spy on `llm`
    // ALONE cannot prove this: `explain.ts` calls `deps.llm(model.provider)`
    // — with the guard deleted, `narrationModel` is `undefined`, and
    // `model.provider` throws while the CALL'S ARGUMENT is being evaluated,
    // before `deps.llm` is ever invoked. So `llmSpy` stays uncalled either
    // way and cannot alone distinguish "the guard skipped narration" from
    // "narration ran and blew up before reaching the mock" (verified: with
    // only the `llmSpy` assertion below, deleting the guard stayed GREEN).
    // `narrateBlastRadius`'s own try/catch DOES call `console.warn` on that
    // path, so a spy on `console.warn` is the assertion that actually
    // discriminates "the guard ran" from "narration was attempted and
    // failed" — which is exactly the boundary REQ-20 is meant to guarantee.
    const llmSpy = vi.fn((): Promise<LLMProvider> => {
      throw new Error('deps.llm must NOT be invoked — REQ-20');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new BlastService(baseDeps({ llm: llmSpy }));
    const result = await service.getBlastRadius('ws-1', 'pr-1');
    if (!result) throw new Error('expected a result');
    expect(result.narrative).toBeNull();
    expect(llmSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('REQ-19 — a narrationModel is provided: a grounded reply is attached as narrative', async () => {
    const mock = new MockLLMProvider('openai', {
      structuredBySchema: {
        [BLAST_NARRATION_SCHEMA_NAME]: {
          narrative: 'foo in src/a.ts is called from src/caller.ts.',
        },
      },
    });
    const service = new BlastService(baseDeps({ llm: async () => mock }));
    const result = await service.getBlastRadius('ws-1', 'pr-1', {
      provider: 'openai',
      model: 'gpt-test',
    });
    if (!result) throw new Error('expected a result');
    expect(result.narrative).toBe('foo in src/a.ts is called from src/caller.ts.');
    // The rest of the already-computed response is untouched by narration.
    expect(result.symbols).toHaveLength(1);
  });

  it('REQ-19 — an ungrounded reply narrows to null without failing the request', async () => {
    const mock = new MockLLMProvider('openai', {
      structuredBySchema: {
        [BLAST_NARRATION_SCHEMA_NAME]: { narrative: 'Also touches processPaymentRefund.' },
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new BlastService(baseDeps({ llm: async () => mock }));
    const result = await service.getBlastRadius('ws-1', 'pr-1', {
      provider: 'openai',
      model: 'gpt-test',
    });
    if (!result) throw new Error('expected a result');
    expect(result.narrative).toBeNull();
    expect(result.symbols).toHaveLength(1); // the rest of the response still returned
  });
});
