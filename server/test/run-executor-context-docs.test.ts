/**
 * Hermetic tests for `ReviewRunExecutor`'s Project Context document injection
 * (Step 6's `buildContextDocs`, exercised indirectly via the public
 * `executeRuns` entry point — `buildContextDocs`/`runOneAgent` are private).
 *
 * No Postgres, no Docker. `ReviewRepository` and `Container['agentsRepo']`
 * are constructor-injected (see `run-executor.ts`'s constructor), so both are
 * hand-rolled `vi.fn()` stubs here — no real DB. `container.git`/`llm` use
 * the mocks in `src/adapters/mocks.ts`. `container.db` is a minimal
 * call-counted fake satisfying only `ContextDocsRepository`'s queries
 * (agent/skill attachments + repo context-folders), which the executor
 * constructs internally from `container.db`.
 *
 * Covers (per plan Step 9 / §7 Testing Plan):
 *  (a) AC-14 — agent-direct + skill-derived attachment of the SAME path
 *      dedupes to exactly one entry in the `specs` array passed to
 *      `reviewPullRequest` (asserted via the persisted `run_traces` /
 *      `prompt_assembly.specs`, which reflects exactly what reviewer-core
 *      received).
 *  (b) AC-12 — a stale/deleted path produces a `skipped` trace entry and the
 *      run still completes successfully (status='done').
 *  (c) AC-13 — a path-traversal-crafted stored path never reaches
 *      `container.git.readFile`.
 */
import { describe, it, expect, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import { RunBus } from '../src/platform/sse.js';
import type { Container } from '../src/platform/container.js';
import { ContextDocsService } from '../src/modules/context-docs/service.js';
import type { ReviewRepository, PullRow } from '../src/modules/reviews/repository.js';
import type { RunTrace } from '@devdigest/shared';
import * as schema from '../src/db/schema.js';

const WS_ID = '22222222-2222-2222-2222-222222222222';
const REPO_ID = '33333333-3333-3333-3333-333333333333';
const AGENT_ID = '44444444-4444-4444-4444-444444444444';
const SKILL_ID = '55555555-5555-5555-5555-555555555555';
const PR_ID = '66666666-6666-6666-6666-666666666666';
const RUN_ID = '77777777-7777-7777-7777-777777777777';

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
  createdAt: new Date('2026-01-01'),
  contextFolders: null,
} as unknown as typeof schema.repos.$inferSelect;

const PULL_ROW: PullRow = {
  id: PR_ID,
  workspaceId: WS_ID,
  repoId: REPO_ID,
  number: 42,
  title: 'Add rate limiting',
  author: 'marisa.koch',
  branch: 'feat/rate-limit',
  base: 'main',
  headSha: 'a1b2c3d4',
  lastReviewedSha: null,
  additions: 4,
  deletions: 0,
  filesCount: 1,
  status: 'needs_review',
  body: null,
  openedAt: null,
  updatedAt: null,
} as unknown as PullRow;

const AGENT_ROW = {
  id: AGENT_ID,
  workspaceId: WS_ID,
  name: 'Reviewer',
  description: '',
  provider: 'anthropic' as const,
  model: 'claude-sonnet',
  systemPrompt: 'You review PRs.',
  outputSchema: null,
  strategy: 'single-pass' as const,
  ciFailOn: 'critical' as const,
  repoIntel: false, // keep repo-intel enrichment off — irrelevant to this test, avoids extra mocking
  enabled: true,
  version: 1,
  createdBy: null,
  createdAt: new Date('2026-01-01'),
};

/** Minimal call-counted fake db satisfying ONLY ContextDocsRepository's queries
 *  (agent/skill attachments + repo context-folders lookup). */
function makeDb(opts: {
  agentDocs?: { path: string; order: number }[];
  skillDocs?: { path: string; order: number }[];
  contextFolders?: string[] | null;
}) {
  const agentDocs = opts.agentDocs ?? [];
  const skillDocs = opts.skillDocs ?? [];

  function tableNameOf(table: unknown): string {
    try {
      return getTableName(table as Parameters<typeof getTableName>[0]);
    } catch {
      return '';
    }
  }

  function makeChain(resolve: () => Record<string, unknown>[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      where: () => chain,
      orderBy: () => chain,
      limit: (_n: number) => Promise.resolve(resolve()),
      then: (
        onFulfilled?: (value: Record<string, unknown>[]) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
      catch: (onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve()).catch(onRejected),
    };
    return chain;
  }

  return {
    select: (columns?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        const tableName = tableNameOf(table);
        return makeChain(() => {
          if (columns && ('clonePath' in columns || 'contextFolders' in columns)) {
            return [
              {
                clonePath: REPO_ROW.clonePath,
                owner: REPO_ROW.owner,
                name: REPO_ROW.name,
                contextFolders: opts.contextFolders ?? null,
              },
            ];
          }
          if (tableName === 'agent_context_docs') return agentDocs;
          if (tableName === 'skill_context_docs') return skillDocs;
          return [];
        });
      },
    }),
  };
}

/** Minimal ReviewRepository stub — only the methods executeRuns/runOneAgent call. */
function makeReviewRepo(): ReviewRepository {
  const savedTraces: RunTrace[] = [];
  const completed: { status: string }[] = [];
  const repo = {
    getIntent: vi.fn().mockResolvedValue(undefined),
    upsertIntent: vi.fn().mockResolvedValue(undefined),
    getPrFiles: vi.fn().mockResolvedValue([]),
    insertReview: vi.fn().mockResolvedValue({
      id: 'review-1',
      workspaceId: WS_ID,
      prId: PR_ID,
      agentId: AGENT_ID,
      runId: RUN_ID,
      kind: 'review',
      verdict: 'comment',
      summary: 'ok',
      score: 95,
      model: AGENT_ROW.model,
      createdAt: new Date(),
    }),
    insertFindings: vi.fn().mockResolvedValue([]),
    markReviewed: vi.fn().mockResolvedValue(undefined),
    completeAgentRun: vi.fn().mockImplementation(async (_runId: string, values: { status: string }) => {
      completed.push(values);
    }),
    saveRunTrace: vi.fn().mockImplementation(async (_runId: string, trace: RunTrace) => {
      savedTraces.push(trace);
    }),
    upsertBrief: vi.fn().mockRejectedValue(new Error('brief composition not exercised in this test')),
    __savedTraces: savedTraces,
    __completed: completed,
  };
  return repo as unknown as ReviewRepository;
}

/** Container with MockLLMProvider (returns findings:[] / score:95) + MockGitClient
 *  (diff fixture matches PULL_ROW's file) + the ContextDocsRepository-only fake db. */
function makeContainer(opts: {
  agentDocs?: { path: string; order: number }[];
  skillDocs?: { path: string; order: number }[];
  gitFiles?: Record<string, string>;
}): { container: Container; readFile: ReturnType<typeof vi.fn> } {
  const gitClient = new MockGitClient({ files: opts.gitFiles });
  const readFile = vi.spyOn(gitClient, 'readFile');

  const llm = new MockLLMProvider('anthropic', {
    structured: { verdict: 'comment', summary: 'Looks fine.', score: 95, findings: [] },
  });

  const db = makeDb({
    agentDocs: opts.agentDocs,
    skillDocs: opts.skillDocs,
  });

  const container = {
    db,
    git: gitClient,
    tokenizer: { count: (text: string) => text.split(/\s+/).filter(Boolean).length },
    llm: async () => llm,
    runBus: new RunBus(),
    blast: { getBlast: vi.fn().mockRejectedValue(new Error('blast not exercised')) },
  } as unknown as Container;
  // `run-executor.ts` consumes `container.contextDocs` (Container's lazy
  // facade getter) instead of constructing `ContextDocsRepository` directly.
  // This test's `container` is a plain object fake (not a real `Container`
  // instance), so the getter doesn't exist — build the real service here,
  // backed by the same `db` fake, and attach it under the same property name.
  (container as unknown as { contextDocs: ContextDocsService }).contextDocs =
    new ContextDocsService(container);

  return { container, readFile };
}

function makeAgentsRepo(linkedSkills: { skill: { id: string; enabled: boolean; body: string }; order: number }[]) {
  return {
    linkedSkills: vi.fn().mockResolvedValue(linkedSkills),
  } as unknown as Container['agentsRepo'];
}

// ---------------------------------------------------------------------------
// (a) AC-14 — direct + skill-derived attachment of the SAME path dedupes once
// ---------------------------------------------------------------------------

describe('ReviewRunExecutor — context doc dedup (AC-14)', () => {
  it('injects a document attached both directly to the agent AND via a linked skill exactly once', async () => {
    const SHARED_PATH = 'specs/shared-invariant.md';
    const { container, readFile } = makeContainer({
      agentDocs: [{ path: SHARED_PATH, order: 0 }],
      skillDocs: [{ path: SHARED_PATH, order: 0 }],
      gitFiles: { [SHARED_PATH]: 'This invariant must always hold.' },
    });

    const agentsRepo = makeAgentsRepo([
      { skill: { id: SKILL_ID, enabled: true, body: '# Skill body' }, order: 0 },
    ]);
    const reviewRepo = makeReviewRepo();

    const executor = new ReviewRunExecutor(container, reviewRepo, agentsRepo);
    await executor.executeRuns(WS_ID, PULL_ROW, REPO_ROW, [{ agent: AGENT_ROW as never, runId: RUN_ID }]);

    // readFile must have been called exactly ONCE for the shared path (dedup
    // happens BEFORE the read loop — first occurrence wins).
    const callsForSharedPath = readFile.mock.calls.filter((c) => c[1] === SHARED_PATH);
    expect(callsForSharedPath).toHaveLength(1);

    // The persisted trace must show exactly one 'injected' entry for the path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const savedTraces = (reviewRepo as any).__savedTraces as RunTrace[];
    expect(savedTraces).toHaveLength(1);
    const trace = savedTraces[0]!;
    const injectedForPath = (trace.context_documents ?? []).filter(
      (d) => d.path === SHARED_PATH && d.status === 'injected',
    );
    expect(injectedForPath).toHaveLength(1);

    // And the prompt_assembly's specs section reflects exactly one occurrence
    // of the document's content (never duplicated).
    const specsText = trace.prompt_assembly.specs ?? '';
    const occurrences = specsText.split('This invariant must always hold.').length - 1;
    expect(occurrences).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (b) AC-12 — stale/deleted path → skipped trace entry, run still completes
// ---------------------------------------------------------------------------

describe('ReviewRunExecutor — stale/deleted attachment (AC-12)', () => {
  it('records a skipped trace entry for a since-deleted path and completes the run successfully', async () => {
    const STALE_PATH = 'specs/deleted.md';
    // No `gitFiles` entry for STALE_PATH → MockGitClient.readFile throws (opts.files?.[path] is undefined,
    // but MockGitClient's default readFile returns '' rather than throwing — override via spy below).
    const { container, readFile } = makeContainer({
      agentDocs: [{ path: STALE_PATH, order: 0 }],
    });
    readFile.mockImplementation(async () => {
      throw new Error('ENOENT: no such file');
    });

    const agentsRepo = makeAgentsRepo([]);
    const reviewRepo = makeReviewRepo();

    const executor = new ReviewRunExecutor(container, reviewRepo, agentsRepo);
    await executor.executeRuns(WS_ID, PULL_ROW, REPO_ROW, [{ agent: AGENT_ROW as never, runId: RUN_ID }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const completed = (reviewRepo as any).__completed as { status: string }[];
    expect(completed).toHaveLength(1);
    expect(completed[0]!.status).toBe('done');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const savedTraces = (reviewRepo as any).__savedTraces as RunTrace[];
    expect(savedTraces).toHaveLength(1);
    const entry = (savedTraces[0]!.context_documents ?? []).find((d) => d.path === STALE_PATH);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('skipped');
    expect(entry!.skip_reason).toBeTruthy();

    // Never appears in specs_read (only injected docs are listed there).
    expect(savedTraces[0]!.specs_read).not.toContain(STALE_PATH);
  });
});

// ---------------------------------------------------------------------------
// v2 (d) AC-25 — overlay content is preferred over the clone read at injection
// ---------------------------------------------------------------------------

describe('ReviewRunExecutor — overlay-preferred injection (AC-25)', () => {
  it('injects the overlay body and never reads the clone file for an overlaid path', async () => {
    const OVERLAY_PATH = 'specs/edited.md';
    const { container, readFile } = makeContainer({
      agentDocs: [{ path: OVERLAY_PATH, order: 0 }],
      gitFiles: { [OVERLAY_PATH]: 'the ORIGINAL clone content' },
    });
    vi.spyOn(ContextDocsService.prototype, 'getOverlayForInjection').mockResolvedValue({
      body: 'the EDITED overlay body',
    });

    const repo = makeReviewRepo();
    const executor = new ReviewRunExecutor(container, repo, makeAgentsRepo([]));
    await executor.executeRuns(WS_ID, PULL_ROW, REPO_ROW, [{ agent: AGENT_ROW as never, runId: RUN_ID }]);

    // Clone file never read for the overlaid path.
    expect(readFile.mock.calls.some((c) => c[1] === OVERLAY_PATH)).toBe(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const savedTraces = (repo as any).__savedTraces as RunTrace[];
    const entry = (savedTraces[0]!.context_documents ?? []).find((d) => d.path === OVERLAY_PATH);
    expect(entry!.status).toBe('injected');
    const specsText = savedTraces[0]!.prompt_assembly.specs ?? '';
    expect(specsText).toContain('the EDITED overlay body');
    expect(specsText).not.toContain('the ORIGINAL clone content');
  });
});

// ---------------------------------------------------------------------------
// v2 (e) AC-36 — no-clone repo: overlay path injects, non-overlay path skips
// ---------------------------------------------------------------------------

describe('ReviewRunExecutor — no-clone repo mixed injection (AC-36)', () => {
  it('injects an overlay-only path and skips a path with neither overlay nor clone, run completes', async () => {
    const OVERLAY_PATH = 'specs/uploaded.md';
    const MISSING_PATH = 'docs/missing.md';
    const { container, readFile } = makeContainer({
      agentDocs: [
        { path: OVERLAY_PATH, order: 0 },
        { path: MISSING_PATH, order: 1 },
      ],
    });
    // Simulate a repo with no readable clone — every clone read fails.
    readFile.mockImplementation(async () => {
      throw new Error('no clone available');
    });
    vi.spyOn(ContextDocsService.prototype, 'getOverlayForInjection').mockImplementation(
      async (_repoId: string, p: string) => (p === OVERLAY_PATH ? { body: 'uploaded overlay body' } : undefined),
    );

    const repo = makeReviewRepo();
    const executor = new ReviewRunExecutor(container, repo, makeAgentsRepo([]));
    await executor.executeRuns(WS_ID, PULL_ROW, REPO_ROW, [{ agent: AGENT_ROW as never, runId: RUN_ID }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const completed = (repo as any).__completed as { status: string }[];
    expect(completed[0]!.status).toBe('done');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const traces = (repo as any).__savedTraces as RunTrace[];
    const docs = traces[0]!.context_documents ?? [];
    const overlaid = docs.find((d) => d.path === OVERLAY_PATH)!;
    const missing = docs.find((d) => d.path === MISSING_PATH)!;
    expect(overlaid.status).toBe('injected');
    expect(missing.status).toBe('skipped');
    expect(missing.skip_reason).toMatch(/not found in clone/i);
    // The overlaid path's clone was never read.
    expect(readFile.mock.calls.some((c) => c[1] === OVERLAY_PATH)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (c) AC-13 — path-traversal stored path never reaches container.git.readFile
// ---------------------------------------------------------------------------

describe('ReviewRunExecutor — path-traversal confinement (AC-13)', () => {
  it('never calls container.git.readFile with a traversal-crafted stored path', async () => {
    const TRAVERSAL_PATH = '../../secret.md';
    const { container, readFile } = makeContainer({
      agentDocs: [{ path: TRAVERSAL_PATH, order: 0 }],
    });

    const agentsRepo = makeAgentsRepo([]);
    const reviewRepo = makeReviewRepo();

    const executor = new ReviewRunExecutor(container, reviewRepo, agentsRepo);
    await executor.executeRuns(WS_ID, PULL_ROW, REPO_ROW, [{ agent: AGENT_ROW as never, runId: RUN_ID }]);

    // readFile must NEVER have been called with the traversal path.
    const calledWithTraversal = readFile.mock.calls.some((c) => c[1] === TRAVERSAL_PATH);
    expect(calledWithTraversal).toBe(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const savedTraces = (reviewRepo as any).__savedTraces as RunTrace[];
    const entry = (savedTraces[0]!.context_documents ?? []).find((d) => d.path === TRAVERSAL_PATH);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('skipped');
    expect(entry!.skip_reason).toMatch(/outside/i);

    // The run still completes successfully despite the rejected attachment.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const completed = (reviewRepo as any).__completed as { status: string }[];
    expect(completed[0]!.status).toBe('done');
  });
});
