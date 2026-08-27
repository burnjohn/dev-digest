import { describe, it, expect } from 'vitest';
import type {
  BlastRadiusResponse,
  GitHubClient,
  IssueMeta,
  LLMProvider,
  RiskBriefResponse,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import type { Db } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { ExternalServiceError, NotFoundError } from '../src/platform/errors.js';
import { BriefService, type BriefServiceDeps } from '../src/modules/reviews/brief-service.js';
import { RISK_BRIEF_SCHEMA_NAME } from '../src/modules/reviews/brief-generator.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider, MockBlastProvider } from '../src/adapters/mocks.js';

/**
 * Hermetic unit coverage for `brief-service.ts` (server/specs/SPEC-02-pr-risk-brief.md, plan
 * 08-pr-risk-brief.md T6). No DB, no network — `fakeDb` below is the same "table -> rows" stub
 * `test/blast-port.test.ts` uses, extended with a minimal `insert().values().onConflictDoUpdate()`
 * so `upsertBrief` can be asserted on and so a cache-hit test can read back what a prior miss
 * wrote (`rowsByTable` is mutated on every upsert — this IS the fake's persistence).
 */

type Row = Record<string, unknown>;

const WORKSPACE_ID = 'ws-1';
const PR_ID = 'pr-1';
const MODEL = { provider: 'openai' as const, model: 'gpt-4.1' };

function pullRow(overrides: Row = {}): Row {
  return {
    id: PR_ID,
    workspaceId: WORKSPACE_ID,
    repoId: 'repo-1',
    title: 'Add payments retry',
    body: 'Adds retry logic for the payments webhook. Closes #42.',
    ...overrides,
  };
}

function repoRow(): Row {
  return { id: 'repo-1', owner: 'acme', name: 'payments-api' };
}

function prFileRow(): Row {
  return {
    path: 'src/payments.ts',
    additions: 5,
    deletions: 1,
    patch: '@@ -1,2 +1,3 @@\n context line',
  };
}

function blastFixture(): BlastRadiusResponse {
  return {
    status: 'ok',
    status_reason: '',
    coverage: {
      callers_available: true,
      endpoints_available: true,
      crons_available: true,
      imports_available: true,
      prior_prs_available: true,
      files_indexed: 10,
      files_skipped: 0,
      index_truncated: false,
    },
    changed_file_count: 1,
    totals: { symbols: 0, callers: 0, endpoints: 1, crons: 0 },
    symbols: [
      {
        name: 'chargeCard',
        file: 'src/payments.ts',
        kind: 'function',
        callers: [],
        caller_count: 0,
        chips: [{ label: 'POST /pay', kind: 'endpoint', file: 'src/payments.ts' }],
      },
    ],
    file_impact: [],
    prior_prs: [],
    narrative: null,
  };
}

function validGenerationFixture(overrides: Row = {}): Row {
  return {
    what: 'Adds retry to the payments webhook handler.',
    why: 'Transient webhook failures currently drop the event.',
    risk_level: 'medium',
    risks: [
      {
        title: 'Retry could double-charge',
        explanation: 'A retried webhook may re-trigger the charge if idempotency is not enforced.',
        severity: 'medium',
        file: 'src/payments.ts',
        endpoint: 'POST /pay',
      },
    ],
    review_focus: [{ file: 'src/payments.ts', reason: 'Verify idempotency key handling.' }],
    ...overrides,
  };
}

/** Fake `Db` — table -> rows, with insert() mutating the map so a later select
 *  observes a prior upsert (mirrors `test/blast-port.test.ts`'s `fakeDb`). */
function fakeDb(opts: {
  pull?: Row;
  repo?: Row;
  prFiles?: Row[];
  intent?: Row;
  existingBrief?: Row;
}) {
  const rowsByTable = new Map<unknown, Row[]>([
    [schema.pullRequests, opts.pull ? [opts.pull] : []],
    [schema.repos, opts.repo ? [opts.repo] : []],
    [schema.prFiles, opts.prFiles ?? []],
    [schema.prIntent, opts.intent ? [opts.intent] : []],
    [schema.prBrief, opts.existingBrief ? [opts.existingBrief] : []],
  ]);
  const upserts: Row[] = [];

  const db = {
    select: (..._cols: unknown[]) => ({
      from: (table: unknown) => ({
        where: async () => rowsByTable.get(table) ?? [],
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Row) => ({
        onConflictDoUpdate: async () => {
          upserts.push(v);
          rowsByTable.set(table, [v]);
        },
      }),
    }),
  };
  return { db: db as unknown as Db, upserts, rowsByTable };
}

function makeLogger() {
  const infoCalls: unknown[][] = [];
  const errorCalls: unknown[][] = [];
  return {
    info: (msg: string, data?: unknown) => infoCalls.push([msg, data]),
    error: (msg: string, data?: unknown) => errorCalls.push([msg, data]),
    infoCalls,
    errorCalls,
  };
}

function rejectingGitHub(): GitHubClient {
  const notUsed = async () => {
    throw new Error('not used');
  };
  return {
    listPullRequests: notUsed,
    getPullRequest: notUsed,
    postReview: notUsed,
    listReviewComments: notUsed,
    createReviewComment: notUsed,
    openPullRequest: notUsed,
    commitFiles: notUsed,
    findOpenPr: notUsed,
    getIssue: async (): Promise<IssueMeta> => {
      throw new Error('getIssue failed');
    },
    currentLogin: async () => 'mock-user',
  } as unknown as GitHubClient;
}

function rejectingLlm(err: Error): LLMProvider {
  return {
    id: 'openai',
    listModels: async () => [],
    complete: async () => {
      throw new Error('not used');
    },
    completeStructured: async <T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> => {
      throw err;
    },
    embed: async () => [],
  };
}

function makeDeps(opts: {
  db: Db;
  llm?: LLMProvider;
  github?: GitHubClient;
  blast?: MockBlastProvider;
}): BriefServiceDeps {
  const llm = opts.llm ?? new MockLLMProvider('openai', { structuredBySchema: { [RISK_BRIEF_SCHEMA_NAME]: validGenerationFixture() } });
  return {
    db: opts.db,
    git: new MockGitClient(),
    github: async () => opts.github ?? new MockGitHubClient(),
    llm: async () => llm,
    blast: opts.blast ?? new MockBlastProvider({ response: blastFixture() }),
  };
}

describe('BriefService.getOrGenerateBrief', () => {
  it('REQ-1: a miss gathers sources, calls the model exactly once, grounds and writes one row', async () => {
    const { db, upserts } = fakeDb({ pull: pullRow(), repo: repoRow(), prFiles: [prFileRow()] });
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { [RISK_BRIEF_SCHEMA_NAME]: validGenerationFixture() },
    });
    const service = new BriefService(makeDeps({ db, llm }));
    let resolveCalls = 0;

    const response = await service.getOrGenerateBrief(WORKSPACE_ID, PR_ID, {
      resolveModel: async () => {
        resolveCalls++;
        return MODEL;
      },
    });

    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(resolveCalls).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(response.pr_id).toBe(PR_ID);
    expect(response.model).toBe('gpt-4.1');
    expect(response.risks).toHaveLength(1);
    expect(response.risks[0]!.file).toBe('src/payments.ts');
    expect(response.risks[0]!.endpoint).toBe('POST /pay');
  });

  it('REQ-2: force absent, null, then false returns the cached brief with zero further model/GitHub calls', async () => {
    const { db } = fakeDb({ pull: pullRow(), repo: repoRow(), prFiles: [prFileRow()] });
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { [RISK_BRIEF_SCHEMA_NAME]: validGenerationFixture() },
    });
    const github = new MockGitHubClient();
    const service = new BriefService(makeDeps({ db, llm, github }));
    let resolveCalls = 0;
    const resolveModel = async () => {
      resolveCalls++;
      return MODEL;
    };

    const first = await service.getOrGenerateBrief(WORKSPACE_ID, PR_ID, { resolveModel });
    const callsAfterFirst = llm.calls.length;
    expect(resolveCalls).toBe(1);

    for (const force of [undefined, null, false] as const) {
      const again = await service.getOrGenerateBrief(WORKSPACE_ID, PR_ID, {
        force: force === null ? undefined : force,
        resolveModel,
      });
      expect(again).toEqual(first);
    }

    expect(llm.calls.length).toBe(callsAfterFirst); // unchanged — cache hit, zero cost
    expect(resolveCalls).toBe(1); // REQ-22 — a cache hit resolves nothing
  });

  it('REQ-3: {force:true} regenerates and replaces the stored row', async () => {
    const { db, upserts } = fakeDb({ pull: pullRow(), repo: repoRow(), prFiles: [prFileRow()] });
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { [RISK_BRIEF_SCHEMA_NAME]: validGenerationFixture() },
    });
    const service = new BriefService(makeDeps({ db, llm }));
    const resolveModel = async () => MODEL;

    await service.getOrGenerateBrief(WORKSPACE_ID, PR_ID, { resolveModel });
    expect(upserts).toHaveLength(1);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    await service.getOrGenerateBrief(WORKSPACE_ID, PR_ID, { force: true, resolveModel });
    expect(upserts).toHaveLength(2);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(2);
  });

  it('REQ-5: an unknown PR 404s before any model/GitHub/blast call, and zero rows are written', async () => {
    const { db, upserts } = fakeDb({}); // no pull row — simulates a miss/other workspace
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { [RISK_BRIEF_SCHEMA_NAME]: validGenerationFixture() },
    });
    const service = new BriefService(makeDeps({ db, llm }));
    let resolveCalls = 0;

    await expect(
      service.getOrGenerateBrief(WORKSPACE_ID, PR_ID, {
        resolveModel: async () => {
          resolveCalls++;
          return MODEL;
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(llm.calls).toHaveLength(0);
    expect(resolveCalls).toBe(0);
    expect(upserts).toHaveLength(0);
  });

  it('REQ-6/REQ-7/REQ-10: an ungrounded risks[].file is dropped, down to risks: [], with no retry', async () => {
    const { db } = fakeDb({ pull: pullRow(), repo: repoRow(), prFiles: [prFileRow()] });
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        [RISK_BRIEF_SCHEMA_NAME]: validGenerationFixture({
          risks: [
            {
              title: 'Fabricated risk',
              explanation: 'Names a file never in this diff.',
              severity: 'high',
              file: 'src/not-a-real-file.ts',
              endpoint: null,
            },
          ],
        }),
      },
    });
    const service = new BriefService(makeDeps({ db, llm, blast: new MockBlastProvider() }));

    const response = await service.getOrGenerateBrief(WORKSPACE_ID, PR_ID, {
      resolveModel: async () => MODEL,
    });

    expect(response.risks).toEqual([]);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
  });

  it('REQ-11/REQ-18: an unparseable/rejecting/timed-out model call maps to 502, writes no row, and leaves a stored row untouched', async () => {
    const existing: RiskBriefResponse = {
      ...(validGenerationFixture() as unknown as Omit<RiskBriefResponse, 'pr_id' | 'sources' | 'model' | 'generated_at'>),
      pr_id: PR_ID,
      sources: {
        intent: 'unavailable',
        blast: 'used',
        pr_body: 'used',
        linked_issue: 'used',
        file_list: 'used',
        md_files: [],
      },
      model: 'gpt-4.1',
      generated_at: '2026-08-20T00:00:00.000Z',
    };

    const cases: { name: string; llm: LLMProvider }[] = [
      {
        name: 'invalid risk_level enum value',
        llm: new MockLLMProvider('openai', {
          structuredBySchema: { [RISK_BRIEF_SCHEMA_NAME]: validGenerationFixture({ risk_level: 'critical' }) },
        }),
      },
      {
        name: 'risks[] entry missing file',
        llm: new MockLLMProvider('openai', {
          structuredBySchema: {
            [RISK_BRIEF_SCHEMA_NAME]: validGenerationFixture({
              risks: [{ title: 't', explanation: 'e', severity: 'low', endpoint: null }],
            }),
          },
        }),
      },
      { name: 'llm rejects outright', llm: rejectingLlm(new Error('provider unavailable')) },
      { name: 'llm times out', llm: rejectingLlm(new Error('request timed out')) },
    ];

    for (const c of cases) {
      const { db, upserts, rowsByTable } = fakeDb({
        pull: pullRow(),
        repo: repoRow(),
        prFiles: [prFileRow()],
        existingBrief: { prId: PR_ID, json: existing },
      });
      const service = new BriefService(makeDeps({ db, llm: c.llm }));

      const err = await service
        .getOrGenerateBrief(WORKSPACE_ID, PR_ID, { force: true, resolveModel: async () => MODEL })
        .catch((e: unknown) => e);

      expect(err, c.name).toBeInstanceOf(ExternalServiceError);
      expect((err as ExternalServiceError).statusCode).toBe(502);
      expect(upserts, c.name).toHaveLength(0);
      expect(rowsByTable.get(schema.prBrief), c.name).toEqual([{ prId: PR_ID, json: existing }]);
    }
  });

  it('REQ-16/REQ-17/REQ-39: missing intent, a throwing blast, and a rejecting getIssue still succeed with "unavailable" sources, each logged', async () => {
    const { db, upserts } = fakeDb({ pull: pullRow(), repo: repoRow(), prFiles: [prFileRow()] });
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { [RISK_BRIEF_SCHEMA_NAME]: validGenerationFixture() },
    });
    const logger = makeLogger();
    const service = new BriefService(
      makeDeps({
        db,
        llm,
        github: rejectingGitHub(),
        blast: new MockBlastProvider({ error: new Error('blast unavailable') }),
      }),
    );

    const response = await service.getOrGenerateBrief(WORKSPACE_ID, PR_ID, {
      resolveModel: async () => MODEL,
      log: logger,
    });

    expect(response.sources.intent).toBe('unavailable'); // no pr_intent row (REQ-16)
    expect(response.sources.blast).toBe('unavailable'); // blast threw (REQ-17)
    expect(response.sources.linked_issue).toBe('unavailable'); // getIssue rejected (REQ-39)
    expect(upserts).toHaveLength(1); // generation still succeeds — 200, one row

    const errorMessages = logger.errorCalls.map((c) => c[0]);
    expect(errorMessages.some((m) => String(m).includes('blast'))).toBe(true);
    expect(errorMessages.some((m) => String(m).includes('linked issue'))).toBe(true);
  });

  it('REQ-23/REQ-25: one info log line per completed generation carries provider, model, tokens, sources, cost and grounding counts', async () => {
    const { db } = fakeDb({ pull: pullRow(), repo: repoRow(), prFiles: [prFileRow()] });
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { [RISK_BRIEF_SCHEMA_NAME]: validGenerationFixture() },
    });
    const logger = makeLogger();
    const service = new BriefService(makeDeps({ db, llm }));

    await service.getOrGenerateBrief(WORKSPACE_ID, PR_ID, {
      resolveModel: async () => MODEL,
      log: logger,
    });

    const completed = logger.infoCalls.find((c) => c[0] === 'brief: generation complete');
    expect(completed).toBeDefined();
    const payload = completed![1] as Record<string, unknown>;
    expect(payload).toMatchObject({ provider: 'openai', model: 'gpt-4.1' });
    expect(payload.tokensIn).toBeTypeOf('number');
    expect(payload.tokensOut).toBeTypeOf('number');
    expect(payload).toHaveProperty('costUsd');
    expect(payload).toHaveProperty('sources');
    expect(payload).toHaveProperty('grounding');
    expect(payload).not.toHaveProperty('promptSections');
  });

  it('FIX-1: the logged charCounts is read off gatherBriefSources, not the assembled prompt sections, and reports 0 for a missing/unavailable source', async () => {
    // No pull.body → pr_body/linked_issue "missing"; no pr_intent row → intent
    // "unavailable" (REQ-16) — none of the three emits a prompt section, so
    // an approximation over `promptSections` would omit all three entirely.
    const { db } = fakeDb({
      pull: pullRow({ body: null }),
      repo: repoRow(),
      prFiles: [prFileRow()],
    });
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { [RISK_BRIEF_SCHEMA_NAME]: validGenerationFixture() },
    });
    const logger = makeLogger();
    const service = new BriefService(makeDeps({ db, llm }));

    await service.getOrGenerateBrief(WORKSPACE_ID, PR_ID, {
      resolveModel: async () => MODEL,
      log: logger,
    });

    const completed = logger.infoCalls.find((c) => c[0] === 'brief: generation complete');
    expect(completed).toBeDefined();
    const payload = completed![1] as Record<string, unknown>;
    const charCounts = payload.charCounts as {
      intent: number;
      blast: number;
      pr_body: number;
      linked_issue: number;
      file_list: number;
      md_files: { path: string; chars: number }[];
    };

    expect(charCounts).toBeDefined();
    expect(charCounts.intent).toBe(0);
    expect(charCounts.pr_body).toBe(0);
    expect(charCounts.linked_issue).toBe(0);
    expect(charCounts.file_list).toBeGreaterThan(0);
    expect(charCounts.blast).toBeGreaterThan(0); // MockBlastProvider succeeds by default in makeDeps
  });

  it('a stored row that fails RiskBriefResponse parsing is treated as a cache MISS and regenerated', async () => {
    const { db, upserts } = fakeDb({
      pull: pullRow(),
      repo: repoRow(),
      prFiles: [prFileRow()],
      existingBrief: { prId: PR_ID, json: { garbage: true } },
    });
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { [RISK_BRIEF_SCHEMA_NAME]: validGenerationFixture() },
    });
    const service = new BriefService(makeDeps({ db, llm }));

    const response = await service.getOrGenerateBrief(WORKSPACE_ID, PR_ID, {
      resolveModel: async () => MODEL,
    });

    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(upserts).toHaveLength(1);
    expect(response.what).toBe(validGenerationFixture().what);
  });

  it('REQ-46: the response carries no score, verdict, findings count, cost or token figure', async () => {
    const { db } = fakeDb({ pull: pullRow(), repo: repoRow(), prFiles: [prFileRow()] });
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { [RISK_BRIEF_SCHEMA_NAME]: validGenerationFixture() },
    });
    const service = new BriefService(makeDeps({ db, llm }));

    const response = await service.getOrGenerateBrief(WORKSPACE_ID, PR_ID, {
      resolveModel: async () => MODEL,
    });

    expect(Object.keys(response).sort()).toEqual(
      ['what', 'why', 'risk_level', 'risks', 'review_focus', 'pr_id', 'sources', 'model', 'generated_at'].sort(),
    );
  });
});
