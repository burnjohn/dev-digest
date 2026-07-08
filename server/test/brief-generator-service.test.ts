/**
 * Hermetic tests for `BriefGeneratorService` — the orchestration heart of the
 * PR Why + Risk Brief generation pipeline. No Postgres, no Docker.
 *
 * The fake `db` routes by requested column keys (the generic fake db cannot
 * see which table a query targets) — same convention established in
 * `test/context-docs-service.test.ts` / `test/onboarding-service.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { BriefGeneratorService } from '../src/modules/reviews/brief-generator.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { NotFoundError, AppError } from '../src/platform/errors.js';
import type { Container } from '../src/platform/container.js';
import type { BlastResponse } from '@devdigest/shared';

const WS_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_WS_ID = '99999999-9999-9999-9999-999999999999';
const PR_ID = '11111111-1111-1111-1111-111111111111';
const REPO_ID = '33333333-3333-3333-3333-333333333333';

const PULL_ROW = {
  id: PR_ID,
  workspaceId: WS_ID,
  repoId: REPO_ID,
  number: 42,
  title: 'Add rate limiting to public API',
  author: 'marisa.koch',
  branch: 'feat/rate-limit',
  base: 'main',
  headSha: 'deadbeef',
  lastReviewedSha: null,
  additions: 40,
  deletions: 5,
  filesCount: 2,
  status: 'needs_review',
  body: 'Adds a rate limiter middleware.',
  openedAt: null,
  updatedAt: null,
};

const REPO_ROW = {
  id: REPO_ID,
  workspaceId: WS_ID,
  owner: 'acme',
  name: 'api',
  fullName: 'acme/api',
  defaultBranch: 'main',
  clonePath: '/mock/clones/acme/api',
  lastPolledAt: null,
  createdBy: null,
  createdAt: null,
  contextFolders: null,
};

const PR_FILE_ROWS = [
  { id: 'f1', prId: PR_ID, path: 'src/middleware/ratelimit.ts', additions: 30, deletions: 2, patch: null, pseudocodeSummary: 'Adds token bucket limiter' },
  { id: 'f2', prId: PR_ID, path: 'src/config.ts', additions: 10, deletions: 3, patch: null, pseudocodeSummary: 'Wires config' },
];

const NARRATIVE_FIXTURE = {
  what: 'Adds a rate limiter middleware to public endpoints.',
  why: 'Prevents abuse of unauthenticated endpoints.',
  risk_level: 'medium',
  risks: [
    {
      title: 'Rate limiter may block legitimate bursts',
      explanation: 'The limiter window is short.',
      severity: 'medium',
      kind: 'reliability',
      file: 'src/middleware/ratelimit.ts',
      line: 12,
      endpoint: null,
      symbol: null,
    },
    {
      title: 'Unresolvable reference risk',
      explanation: 'References a file that does not exist in this PR.',
      severity: 'low',
      kind: 'correctness',
      file: 'src/nonexistent/ghost.ts',
      line: 5,
      endpoint: null,
      symbol: null,
    },
  ],
  review_focus: [
    { path: 'src/middleware/ratelimit.ts', line: 12, reason: 'Core limiter logic', priority: 1 },
  ],
};

function makeBlastResponse(overrides: Partial<BlastResponse> = {}): BlastResponse {
  return {
    available: true,
    blast: {
      changed_symbols: [{ name: 'rateLimit', file: 'src/middleware/ratelimit.ts', kind: 'function' }],
      downstream: [
        {
          symbol: 'rateLimit',
          callers: [{ name: 'registerRoutes', file: 'src/api/index.ts', line: 10 }],
          endpoints_affected: ['/api/public'],
          crons_affected: [],
        },
      ],
      summary: '1 symbol changed · 1 caller · 1 endpoint · 0 crons reachable',
    },
    history: { history: [] },
    index: { status: 'full', degraded: false, reason: null },
    link: { owner: 'acme', repo: 'api', head_sha: 'deadbeef' },
    ...overrides,
  };
}

interface FakeDbOpts {
  pullRow?: Record<string, unknown> | null;
  repoRow?: Record<string, unknown> | null;
  prFileRows?: Record<string, unknown>[];
  intentRow?: Record<string, unknown> | null;
  findingRows?: Record<string, unknown>[];
  briefRow?: Record<string, unknown> | null;
  transactionSpy?: (kind: 'select' | 'insert' | 'update') => void;
}

function makeChain(resolve: () => Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: (_n: number) => Promise.resolve(resolve()),
    for: () => chain,
    then: (onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onF, onR),
    catch: (onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).catch(onR),
  };
  return chain;
}

/**
 * Fake db that routes `pull.repo.ts`'s calls by column-key sniffing, plus
 * call-order for the four full-row (no column map) selects — getPull,
 * getRepo, getIntent, getPrFiles all call `select()` with no column map, so
 * they are distinguished by the FIXED call order `generate()` issues them in.
 */
function makeFakeDb(opts: FakeDbOpts) {
  const pullRow = 'pullRow' in opts ? opts.pullRow : PULL_ROW;
  const repoRow = 'repoRow' in opts ? opts.repoRow : REPO_ROW;
  const prFileRows = opts.prFileRows ?? PR_FILE_ROWS;
  const intentRow = 'intentRow' in opts ? opts.intentRow : null;
  const findingRows = opts.findingRows ?? [];
  let briefRow = 'briefRow' in opts ? opts.briefRow : null;
  let noColsCallIndex = 0;

  return {
    select: (cols?: Record<string, unknown>) => {
      // getPull (1st), getRepo (2nd), getIntent (3rd), getPrFiles (4th):
      // full-row select() with no column map, in that fixed order.
      if (!cols) {
        const myIndex = noColsCallIndex++;
        return makeChain(() => {
          if (myIndex === 0) return pullRow ? [pullRow] : [];
          if (myIndex === 1) return repoRow ? [repoRow] : [];
          if (myIndex === 2) return intentRow ? [intentRow] : [];
          return prFileRows;
        });
      }
      if ('json' in cols && Object.keys(cols).length === 1) {
        // pull.repo.ts's upsertBrief/upsertLlmBrief transactional SELECT ... FOR UPDATE
        // (also getBrief's select) — routed via tx.select below, not here.
        return makeChain(() => (briefRow ? [briefRow] : []));
      }
      if ('title' in cols && 'rationale' in cols && 'severity' in cols) {
        return makeChain(() => findingRows);
      }
      if ('key' in cols && 'value' in cols) {
        // resolveFeatureModel's settings read — no workspace override configured.
        return makeChain(() => []);
      }
      return makeChain(() => []);
    },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: (cols?: Record<string, unknown>) => {
          opts.transactionSpy?.('select');
          return makeChain(() => (briefRow ? [briefRow] : []));
        },
        insert: () => ({
          values: (row: { json: unknown }) => {
            opts.transactionSpy?.('insert');
            briefRow = { json: row.json };
            return {
              onConflictDoUpdate: (arg: { set: { json: unknown } }) => {
                briefRow = { json: arg.set.json };
                return Promise.resolve();
              },
            };
          },
        }),
        update: () => ({
          set: (arg: { json: unknown }) => {
            opts.transactionSpy?.('update');
            briefRow = { json: arg.json };
            return { where: () => Promise.resolve() };
          },
        }),
      };
      return cb(tx);
    },
  };
}

function makeContainer(opts: {
  db?: ReturnType<typeof makeFakeDb>;
  llm?: MockLLMProvider;
  blast?: { getBlast: ReturnType<typeof vi.fn> };
  contextDocs?: {
    getContextFolders: ReturnType<typeof vi.fn>;
    listDocuments: ReturnType<typeof vi.fn>;
    getDocumentContent: ReturnType<typeof vi.fn>;
  };
  dbOpts?: FakeDbOpts;
} = {}): Container {
  const llm = opts.llm ?? new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
  const blast = opts.blast ?? { getBlast: vi.fn().mockResolvedValue(makeBlastResponse()) };
  const contextDocs = opts.contextDocs ?? {
    getContextFolders: vi.fn().mockResolvedValue(['docs']),
    listDocuments: vi.fn().mockResolvedValue([]),
    getDocumentContent: vi.fn().mockResolvedValue(undefined),
  };
  const db = opts.db ?? makeFakeDb(opts.dbOpts ?? {});

  return {
    db,
    blast,
    contextDocs,
    tokenizer: { count: (s: string) => Math.ceil(s.length / 4) },
    llm: async () => llm,
  } as unknown as Container;
}

describe('BriefGeneratorService.generate — happy path', () => {
  it('makes exactly one completeStructured call (AC-4)', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    const container = makeContainer({ llm });
    const service = new BriefGeneratorService(container);

    await service.generate(WS_ID, PR_ID);

    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
  });

  it('calls container.blast.getBlast() directly for blast facts (regression guard vs Blocking-Issue-#1 duplication)', async () => {
    const getBlast = vi.fn().mockResolvedValue(makeBlastResponse());
    const container = makeContainer({ blast: { getBlast } });
    const service = new BriefGeneratorService(container);

    await service.generate(WS_ID, PR_ID);

    expect(getBlast).toHaveBeenCalledWith(WS_ID, PR_ID);
    // No repoIntel surface is used for blast facts in this service at all.
    expect((container as unknown as { repoIntel?: unknown }).repoIntel).toBeUndefined();
  });

  it('returns the persisted PrBrief with the llm field populated', async () => {
    const container = makeContainer();
    const service = new BriefGeneratorService(container);

    const brief = await service.generate(WS_ID, PR_ID);

    expect(brief.llm).toBeTruthy();
    expect(brief.llm?.what).toBe(NARRATIVE_FIXTURE.what);
    expect(brief.llm?.risk_level).toBe('medium');
  });

  it('a resolvable reference gets a github_link; an unresolvable one is nulled but title/explanation survive (AC-6)', async () => {
    const container = makeContainer();
    const service = new BriefGeneratorService(container);

    const brief = await service.generate(WS_ID, PR_ID);

    const resolvedRisk = brief.risks.risks.find((r) => r.title === 'Rate limiter may block legitimate bursts');
    expect(resolvedRisk).toBeDefined();
    expect(resolvedRisk?.github_link).toBe('https://github.com/acme/api/blob/deadbeef/src/middleware/ratelimit.ts#L12');

    const unresolvedRisk = brief.risks.risks.find((r) => r.title === 'Unresolvable reference risk');
    expect(unresolvedRisk).toBeDefined();
    expect(unresolvedRisk?.file).toBeNull();
    expect(unresolvedRisk?.github_link).toBeNull();
    // Prose survives even when the reference is dropped.
    expect(unresolvedRisk?.explanation).toBe('References a file that does not exist in this PR.');
  });

  it('a risk/review_focus reference with no meaningful LLM line falls back to the file\'s first-changed-line-from-patch, with a matching github_link (data-quality fix)', async () => {
    const patchedPrFileRows = [
      {
        id: 'f1',
        prId: PR_ID,
        path: 'src/middleware/ratelimit.ts',
        additions: 30,
        deletions: 2,
        // First hunk: new-side starts at 20; first "+" line lands at 22.
        patch: ['@@ -18,3 +20,4 @@', ' context at 20', ' context at 21', '+added at 22', '+added at 23'].join('\n'),
        pseudocodeSummary: 'Adds token bucket limiter',
      },
      { id: 'f2', prId: PR_ID, path: 'src/config.ts', additions: 10, deletions: 3, patch: null, pseudocodeSummary: 'Wires config' },
    ];

    const narrativeNoLine = {
      what: NARRATIVE_FIXTURE.what,
      why: NARRATIVE_FIXTURE.why,
      risk_level: NARRATIVE_FIXTURE.risk_level,
      risks: [
        {
          title: 'Rate limiter may block legitimate bursts',
          explanation: 'The limiter window is short.',
          severity: 'medium',
          kind: 'reliability',
          file: 'src/middleware/ratelimit.ts',
          line: null, // LLM omitted the line entirely
          endpoint: null,
          symbol: null,
        },
      ],
      review_focus: [
        // LLM gave the useless default `1` — must be overridden too.
        { path: 'src/middleware/ratelimit.ts', line: 1, reason: 'Core limiter logic', priority: 1 },
      ],
    };

    const llm = new MockLLMProvider('openrouter', { structured: narrativeNoLine });
    const container = makeContainer({ llm, dbOpts: { prFileRows: patchedPrFileRows } });
    const service = new BriefGeneratorService(container);

    const brief = await service.generate(WS_ID, PR_ID);

    const risk = brief.risks.risks.find((r) => r.title === 'Rate limiter may block legitimate bursts');
    expect(risk).toBeDefined();
    expect(risk?.line).toBe(22);
    expect(risk?.github_link).toBe('https://github.com/acme/api/blob/deadbeef/src/middleware/ratelimit.ts#L22');

    const focusItem = brief.llm?.review_focus.find((f) => f.path === 'src/middleware/ratelimit.ts');
    expect(focusItem).toBeDefined();
    expect(focusItem?.line).toBe(22);
    expect(focusItem?.github_link).toBe('https://github.com/acme/api/blob/deadbeef/src/middleware/ratelimit.ts#L22');
  });

  it('logs exactly one structured completion line (AC-11/§12)', async () => {
    const container = makeContainer();
    const infoSpy = vi.fn();
    const logger = { info: infoSpy, warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const service = new BriefGeneratorService(container, logger);

    await service.generate(WS_ID, PR_ID);

    const completionLog = infoSpy.mock.calls.find(
      (call) => typeof call[0] === 'object' && call[0] !== null && 'llmCalls' in call[0],
    );
    expect(completionLog).toBeDefined();
    expect(completionLog![0]).toMatchObject({ prId: PR_ID, llmCalls: 1 });
    expect(completionLog![1]).toBe('risk-brief: generation complete');
  });
});

describe('BriefGeneratorService.generate — failure handling', () => {
  it('a thrown LLM error results in AppError(brief_generation_failed, 502) and no DB write occurs (AC-12/AC-13)', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    llm.completeStructured = vi.fn().mockRejectedValue(new Error('LLM unavailable'));

    let transactionCalled = false;
    const dbOpts: FakeDbOpts = { transactionSpy: () => { transactionCalled = true; } };
    const db = makeFakeDb(dbOpts);
    // Wrap transaction to prove upsertLlmBrief's transaction never runs.
    const wrappedDb = {
      ...db,
      transaction: async (_cb: unknown) => {
        transactionCalled = true;
        throw new Error('upsertLlmBrief should not be called on LLM failure');
      },
    };
    const container = makeContainer({ llm, db: wrappedDb as unknown as ReturnType<typeof makeFakeDb> });
    const service = new BriefGeneratorService(container);

    let caught: unknown;
    try {
      await service.generate(WS_ID, PR_ID);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toMatchObject({ code: 'brief_generation_failed', statusCode: 502 });
    expect(transactionCalled).toBe(false);
  });

  it('cross-workspace PR id throws NotFoundError (AC-15)', async () => {
    const container = makeContainer({ dbOpts: { pullRow: null } });
    const service = new BriefGeneratorService(container);

    await expect(service.generate(WS_ID, PR_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('missing repo throws NotFoundError', async () => {
    const container = makeContainer({ dbOpts: { repoRow: null } });
    const service = new BriefGeneratorService(container);

    await expect(service.generate(WS_ID, PR_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('pull.repo.ts getLatestFindings — workspace scoping', () => {
  it('the query includes the reviews.workspaceId predicate', async () => {
    // Static source inspection: the implementation must construct its WHERE
    // clause with eq(t.reviews.workspaceId, workspaceId) alongside eq(t.reviews.prId, prId).
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../src/modules/reviews/repository/pull.repo.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    const fnMatch = source.match(/export async function getLatestFindings[\s\S]*?\n}/);
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch![0];
    expect(fnBody).toMatch(/eq\(t\.reviews\.workspaceId, workspaceId\)/);
    expect(fnBody).toMatch(/eq\(t\.reviews\.prId, prId\)/);
  });
});
