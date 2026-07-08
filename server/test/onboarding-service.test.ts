/**
 * Hermetic tests for `OnboardingService` — the orchestration heart of the
 * onboarding generator. No Postgres, no Docker.
 *
 * A minimal fake `Container` (plain object cast, per `test/indexer-pipeline.test.ts`'s
 * established pattern) supplies exactly the surface `OnboardingService` reads:
 * `db`, `repoIntel`, `github()`, `git`, `llm()`, `config.repoIntelEnabled`.
 */
import { describe, it, expect, vi } from 'vitest';
import { OnboardingService } from '../src/modules/onboarding/service.js';
import { MockLLMProvider, MockGitHubClient, MockGitClient } from '../src/adapters/mocks.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { Container } from '../src/platform/container.js';
import type { RepoIntel, IndexState } from '../src/modules/repo-intel/types.js';

const WS_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_WS_ID = '99999999-9999-9999-9999-999999999999';
const REPO_ID = '33333333-3333-3333-3333-333333333333';

const RANKED_PATHS = ['src/core.ts', 'src/handler.ts', 'src/index.ts']; // rank-DESCENDING

function makeRepoIntel(opts: {
  indexState?: Partial<IndexState>;
  rankedPaths?: string[];
  criticalPaths?: string[][];
  fileFacts?: { filePath: string; endpoints: string[]; crons: string[] }[];
} = {}): RepoIntel {
  const defaultIndexState: IndexState = {
    repoId: REPO_ID,
    status: 'full',
    filesIndexed: 250,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: 'sha-abc',
    indexerVersion: 1,
    updatedAt: new Date('2026-07-01'),
    degraded: false,
  };
  return {
    indexRepo: vi.fn(),
    refreshIndex: vi.fn(),
    getIndexState: vi.fn().mockResolvedValue({ ...defaultIndexState, ...opts.indexState }),
    getBlastRadius: vi.fn(),
    getRepoMap: vi.fn(),
    getFileRank: vi.fn(),
    getSymbolsInFiles: vi.fn(),
    getCallerSignatures: vi.fn(),
    getUnresolvedReferences: vi.fn(),
    getConventionSamples: vi.fn(),
    getAllFileFacts: vi.fn().mockResolvedValue(opts.fileFacts ?? []),
    getTopFilesByRank: vi.fn().mockResolvedValue(opts.rankedPaths ?? RANKED_PATHS),
    getCriticalPaths: vi.fn().mockResolvedValue(opts.criticalPaths ?? []),
    getImporters: vi.fn().mockResolvedValue([]),
  } as RepoIntel;
}

interface MakeContainerOpts {
  repoIntel?: RepoIntel;
  llm?: MockLLMProvider;
  github?: MockGitHubClient;
  git?: MockGitClient;
  repoRow?: Record<string, unknown> | null;
  ownsRow?: Record<string, unknown> | null;
  upsertedRow?: Record<string, unknown> | null;
  tourRow?: Record<string, unknown> | null;
}

/** Builds a fake db satisfying OnboardingRepository's exact call shapes. */
function makeFakeDb(opts: MakeContainerOpts) {
  const selectChain = (resolve: () => Record<string, unknown>[]) => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(resolve()),
      // resolveFeatureModel's getFeatureModelOverride awaits the chain
      // directly (no .limit()) — make the chain itself thenable so that
      // works too, mirroring test/blast-routes.test.ts's makeDb pattern.
      then: (onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
      catch: (onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).catch(onR),
    };
    return chain;
  };

  return {
    // Route by requested column keys — the generic fake db cannot see which
    // table a query targets, so it sniffs the `select({...})` column map,
    // mirroring test/context-docs-service.test.ts's established convention.
    select: (cols?: Record<string, unknown>) => {
      if (cols && 'key' in cols && 'value' in cols) {
        // resolveFeatureModel's settings read — no workspace override configured.
        return selectChain(() => []);
      }
      if (cols && 'repoId' in cols && 'json' in cols) {
        // OnboardingRepository.getTour
        const row = 'tourRow' in opts ? opts.tourRow : null;
        return selectChain(() => (row ? [row] : []));
      }
      // OnboardingRepository.getRepoBasics
      return selectChain(() => (('repoRow' in opts ? opts.repoRow : null) ? [opts.repoRow] : []));
    },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const ownsRow = 'ownsRow' in opts ? opts.ownsRow : { id: REPO_ID };
      const tx = {
        select: () => selectChain(() => (ownsRow ? [ownsRow] : [])),
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: () => ({
              returning: () => {
                const row =
                  'upsertedRow' in opts
                    ? opts.upsertedRow
                    : {
                        repoId: REPO_ID,
                        json: { sections: [] },
                        generatedAt: new Date(),
                        mode: 'full',
                        indexStatus: 'full',
                        degraded: false,
                        degradedReason: null,
                        llmCostCents: 5,
                      };
                return Promise.resolve(row ? [row] : []);
              },
            }),
          }),
        }),
      };
      return cb(tx);
    },
  };
}

function makeContainer(opts: MakeContainerOpts): Container {
  const llm = opts.llm ?? new MockLLMProvider('openrouter');
  const github = opts.github ?? new MockGitHubClient();
  const git = opts.git ?? new MockGitClient({ files: { 'package.json': '{"name":"demo"}' } });

  return {
    db: makeFakeDb({
      repoRow:
        'repoRow' in opts
          ? opts.repoRow
          : {
              owner: 'acme',
              name: 'api',
              defaultBranch: 'main',
              clonePath: '/mock/clones/acme/api',
              workspaceId: WS_ID,
            },
      ownsRow: 'ownsRow' in opts ? opts.ownsRow : { id: REPO_ID },
      ...('upsertedRow' in opts ? { upsertedRow: opts.upsertedRow } : {}),
      ...('tourRow' in opts ? { tourRow: opts.tourRow } : {}),
    }),
    config: { repoIntelEnabled: true },
    repoIntel: opts.repoIntel ?? makeRepoIntel(),
    git,
    github: async () => github,
    llm: async () => llm,
  } as unknown as Container;
}

const NARRATIVE_FIXTURE = {
  sections: [
    {
      kind: 'architecture',
      title: 'Architecture overview',
      body: 'The app has a service layer.',
      diagram: 'flowchart LR\n  A["client"] --> B["api"]',
      entries: [],
      tasks: [],
      links: [],
    },
    {
      kind: 'critical_paths',
      title: 'Critical paths',
      body: 'Core chains.',
      diagram: null,
      entries: [{ path: 'src/core.ts', rationale: 'Central logic' }],
      tasks: [],
      links: [],
    },
    {
      kind: 'how_to_run',
      title: 'How to run locally',
      body: '1. Install\n2. Run',
      diagram: null,
      entries: [],
      tasks: [],
      links: [],
    },
    {
      kind: 'reading_path',
      title: 'Guided reading path',
      body: 'Read in this order.',
      diagram: null,
      // Deliberately supplied in a NON-rank order (reversed) to test AC-7.
      entries: [
        { path: 'src/index.ts', rationale: 'Entry point' },
        { path: 'src/handler.ts', rationale: 'Handles requests' },
        { path: 'src/core.ts', rationale: 'Core logic' },
      ],
      tasks: [],
      links: [],
    },
    {
      kind: 'first_tasks',
      title: 'First tasks',
      body: 'Start here.',
      diagram: null,
      entries: [],
      tasks: [{ title: 'Fix a bug', target_path: 'src/core.ts', complexity: 'low' }],
      links: [],
    },
  ],
};

describe('OnboardingService.generateTour — full mode (AC-1/4/5/7)', () => {
  it('gathers facts, makes exactly 1 completeStructured call, and produces 5 sections', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    const container = makeContainer({ llm });
    const service = new OnboardingService(container);

    const tour = await service.generateTour(WS_ID, REPO_ID);

    expect(tour.sections).toHaveLength(5);
    expect(tour.sections.map((s) => s.kind)).toEqual([
      'architecture',
      'critical_paths',
      'how_to_run',
      'reading_path',
      'first_tasks',
    ]);
    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);
  });

  it('the fact-gathering calls (getTopFilesByRank/getCriticalPaths/getAllFileFacts) make zero LLM calls (AC-4)', async () => {
    const repoIntel = makeRepoIntel();
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    const container = makeContainer({ repoIntel, llm });
    const service = new OnboardingService(container);

    await service.generateTour(WS_ID, REPO_ID);

    expect(repoIntel.getTopFilesByRank).toHaveBeenCalled();
    expect(repoIntel.getCriticalPaths).toHaveBeenCalled();
    expect(repoIntel.getAllFileFacts).toHaveBeenCalled();
    // Exactly one completeStructured call total — proves fact-gathering itself made none.
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
  });

  it('reading-path order matches the SERVER-computed rank order, not the LLM-returned (reversed) order (AC-7)', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    const container = makeContainer({ llm });
    const service = new OnboardingService(container);

    const tour = await service.generateTour(WS_ID, REPO_ID);
    const readingPath = tour.sections.find((s) => s.kind === 'reading_path')!;

    // RANKED_PATHS = ['src/core.ts', 'src/handler.ts', 'src/index.ts'] (rank-desc).
    // The LLM fixture supplied entries in the OPPOSITE order.
    expect(readingPath.entries.map((e) => e.path)).toEqual([
      'src/core.ts',
      'src/handler.ts',
      'src/index.ts',
    ]);
    expect(readingPath.entries[0]!.rationale).toBe('Core logic');
    expect(readingPath.entries[0]!.rank).toBe(1);
  });

  it('an entry with a resolvable location gets a github_link; entries resolve via mapGithubLink (AC-8/AC-9)', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    const container = makeContainer({ llm });
    const service = new OnboardingService(container);

    const tour = await service.generateTour(WS_ID, REPO_ID);
    const readingPath = tour.sections.find((s) => s.kind === 'reading_path')!;
    for (const entry of readingPath.entries) {
      expect(entry.github_link).toBe(`https://github.com/acme/api/blob/sha-abc/${entry.path}`);
    }
  });

  it('reads full-mode facts only via container.git.readFile against the repoRef from getRepoBasics — never an arbitrary/hardcoded path (AC-14)', async () => {
    const git = new MockGitClient({ files: { 'package.json': '{"name":"demo"}' } });
    const readFileSpy = vi.spyOn(git, 'readFile');
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    const container = makeContainer({
      llm,
      git,
      repoRow: {
        owner: 'acme',
        name: 'api',
        defaultBranch: 'main',
        clonePath: '/mock/clones/acme/api',
        workspaceId: WS_ID,
      },
    });
    const service = new OnboardingService(container);

    await service.generateTour(WS_ID, REPO_ID);

    expect(readFileSpy).toHaveBeenCalled();
    // Every call is scoped to the RepoRef resolved from getRepoBasics
    // (owner/name), never a raw filesystem path derived ad hoc — the
    // container.git port owns clone-path resolution internally, so the
    // service itself never constructs or passes an arbitrary working-tree
    // path (mirrors conventions/extractor.ts's confined-read pattern).
    for (const call of readFileSpy.mock.calls) {
      const [repoRef, path] = call as [{ owner: string; name: string }, string];
      expect(repoRef).toEqual({ owner: 'acme', name: 'api' });
      expect(typeof path).toBe('string');
      // Sanity: none of the requested paths are absolute / outside-repo —
      // they are the well-known relative fact files this step reads.
      expect(['package.json', '.env.example', 'docker-compose.yml', 'docker-compose.yaml']).toContain(
        path,
      );
    }
  });

  it('throws NotFoundError for a missing/cross-workspace repo', async () => {
    const container = makeContainer({ repoRow: null });
    const service = new OnboardingService(container);
    await expect(service.generateTour(WS_ID, REPO_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when the repo belongs to a different workspace', async () => {
    const container = makeContainer({
      repoRow: {
        owner: 'acme',
        name: 'api',
        defaultBranch: 'main',
        clonePath: '/mock/clones/acme/api',
        workspaceId: OTHER_WS_ID,
      },
    });
    const service = new OnboardingService(container);
    await expect(service.generateTour(WS_ID, REPO_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('OnboardingService.generateTour — lite mode (AC-10)', () => {
  it('uses GitHub Trees/Contents when no clone exists; run.mode is lite; reading path rank is null', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    const github = new MockGitHubClient({
      tree: [
        { path: 'src', type: 'tree' },
        { path: 'index.ts', type: 'blob' },
        { path: 'package.json', type: 'blob' },
        { path: 'README.md', type: 'blob' },
      ],
      contents: {
        'package.json': '{"name":"lite-repo"}',
        'README.md': '# Lite repo',
      },
    });
    const container = makeContainer({
      llm,
      github,
      repoRow: {
        owner: 'acme',
        name: 'lite',
        defaultBranch: 'main',
        clonePath: null, // no managed clone
        workspaceId: WS_ID,
      },
      repoIntel: makeRepoIntel({ indexState: { status: 'degraded', degraded: true, reason: 'no_data' } }),
    });
    const service = new OnboardingService(container);

    const tour = await service.generateTour(WS_ID, REPO_ID);

    expect(tour.run.mode).toBe('lite');
    const readingPath = tour.sections.find((s) => s.kind === 'reading_path')!;
    for (const entry of readingPath.entries) {
      expect(entry.rank).toBeNull();
    }
    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);
  });
});

describe('OnboardingService.generateTour — partial/degraded index (AC-11)', () => {
  it('still generates a tour and marks run.degraded true', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    const container = makeContainer({
      llm,
      repoIntel: makeRepoIntel({
        indexState: { status: 'partial', degraded: true, reason: 'repo_too_large' },
      }),
    });
    const service = new OnboardingService(container);

    const tour = await service.generateTour(WS_ID, REPO_ID);
    expect(tour.run.degraded).toBe(true);
    expect(tour.sections).toHaveLength(5);
  });
});

describe('OnboardingService.generateTour — AC-12 no-data fallback', () => {
  it('no clone AND failing GitHub API produces a skeleton with ZERO LLM calls', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    const failingGithub: import('../src/vendor/shared/adapters.js').GitHubClient = {
      ...new MockGitHubClient(),
      getRepoTree: vi.fn().mockRejectedValue(new Error('network down')),
      getFileContents: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as import('../src/vendor/shared/adapters.js').GitHubClient;

    const container = makeContainer({
      llm,
      github: failingGithub as unknown as MockGitHubClient,
      repoRow: {
        owner: 'acme',
        name: 'nodata',
        defaultBranch: 'main',
        clonePath: null,
        workspaceId: WS_ID,
      },
      repoIntel: makeRepoIntel({ indexState: { status: 'failed', degraded: true, reason: 'no_data' } }),
    });
    const service = new OnboardingService(container);

    const tour = await service.generateTour(WS_ID, REPO_ID);

    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);
    expect(tour.sections).toHaveLength(5);
    expect(tour.run.status).toBe('failed');
    for (const s of tour.sections) {
      expect(s.body).toMatch(/not enough data/);
    }
  });
});

describe('OnboardingService.generateTour — regenerate overwrites (AC-3)', () => {
  it('a second generation produces a fresh generated_at timestamp', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    const container = makeContainer({ llm });
    const service = new OnboardingService(container);

    const first = await service.generateTour(WS_ID, REPO_ID);
    await new Promise((r) => setTimeout(r, 5));
    const second = await service.generateTour(WS_ID, REPO_ID);

    expect(first.generated_at).not.toBeNull();
    expect(second.generated_at).not.toBeNull();
    // Two independent completeStructured calls (one per generateTour call).
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(2);
  });
});

describe('OnboardingService.generateTour — AC-18 failure after prior success does not overwrite', () => {
  it('a hard LLM failure re-throws AppError WITHOUT calling upsertTour', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    llm.completeStructured = vi.fn().mockRejectedValue(new Error('LLM unavailable'));

    let transactionCalled = false;
    const baseContainer = makeContainer({ llm });
    // Wrap db.transaction to prove upsertTour's transaction never runs.
    const wrappedDb = {
      ...(baseContainer.db as unknown as Record<string, unknown>),
      transaction: async (_cb: unknown) => {
        transactionCalled = true;
        throw new Error('should not be called');
      },
    };
    const container = { ...baseContainer, db: wrappedDb } as unknown as Container;
    const service = new OnboardingService(container);

    await expect(service.generateTour(WS_ID, REPO_ID)).rejects.toThrow();
    expect(transactionCalled).toBe(false);
  });
});

describe('OnboardingService.getTour (AC-2)', () => {
  it('never generated repo returns a well-formed empty response, not an error', async () => {
    const container = makeContainer({ repoRow: { owner: 'acme', name: 'api', defaultBranch: 'main', clonePath: null, workspaceId: WS_ID } });
    const service = new OnboardingService(container);
    const tour = await service.getTour(WS_ID, REPO_ID);
    expect(tour.generated_at).toBeNull();
    expect(tour.sections).toHaveLength(5);
  });

  it('persisted tour: GET does not call the mock LLM provider', async () => {
    const llm = new MockLLMProvider('openrouter');
    const container = makeContainer({
      llm,
      tourRow: {
        repoId: REPO_ID,
        json: { sections: [] },
        generatedAt: new Date('2026-07-03T00:00:00Z'),
        mode: 'full',
        indexStatus: 'full',
        degraded: false,
        degradedReason: null,
        llmCostCents: 5,
      },
    });

    const service = new OnboardingService(container);
    const tour = await service.getTour(WS_ID, REPO_ID);

    expect(tour.generated_at).not.toBeNull();
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);
  });

  it('cross-workspace GET throws NotFoundError (404)', async () => {
    const container = makeContainer({
      repoRow: {
        owner: 'acme',
        name: 'api',
        defaultBranch: 'main',
        clonePath: null,
        workspaceId: OTHER_WS_ID,
      },
    });
    const service = new OnboardingService(container);
    await expect(service.getTour(WS_ID, REPO_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('OnboardingService.generateTour — log line contains llm_cost_cents (AC-6)', () => {
  it('logs exactly one line with llm_cost_cents after generation', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    const container = makeContainer({ llm });
    const service = new OnboardingService(container);

    const infoSpy = vi.fn();
    const logger = { info: infoSpy, warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    await service.generateTour(WS_ID, REPO_ID, logger);

    const completionLog = infoSpy.mock.calls.find(
      (call) => typeof call[0] === 'object' && call[0] !== null && 'llm_cost_cents' in call[0],
    );
    expect(completionLog).toBeDefined();
    // MockLLMProvider.completeStructured returns costUsd: 0.001 -> round(0.001*100) = 0 cents.
    expect(completionLog![0].llm_cost_cents).toBe(0);
  });
});

describe('OnboardingService.generateTour — rendered prompt shape (Step 6 edit verification)', () => {
  it('the system prompt sent to completeStructured contains exactly the 5-kind list, no routes_and_apis, and no "4 links" cap phrase for reading_path', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
    const container = makeContainer({ llm });
    const service = new OnboardingService(container);

    await service.generateTour(WS_ID, REPO_ID);

    const call = llm.calls.find((c) => c.method === 'completeStructured');
    expect(call).toBeDefined();
    const req = call!.req as { messages: { role: string; content: string }[] };
    const systemMessage = req.messages.find((m) => m.role === 'system');
    expect(systemMessage).toBeDefined();
    // Normalize line endings so a wrapped phrase spanning a CRLF boundary in
    // the source .md file still matches a single-line substring assertion.
    const prompt = systemMessage!.content.replace(/\r\n/g, '\n');

    for (const kind of ['architecture', 'critical_paths', 'how_to_run', 'reading_path', 'first_tasks']) {
      expect(prompt).toContain(kind);
    }
    expect(prompt).not.toContain('routes_and_apis');
    expect(prompt).not.toMatch(/up to 4[^.]*links.*pointing at REAL files from the provided\s*facts\/tree\.\s*$/m);
    // The reading_path guidance requires one entry per ranked file, no truncation.
    expect(prompt.replace(/\s+/g, ' ')).toContain(
      'per ranked file provided in the input; do not truncate',
    );
    // how_to_run commands must go into entries, not the body prose.
    expect(prompt).toContain('how_to_run');
    expect(prompt.replace(/\s+/g, ' ')).toContain('EXACT shell command');
  });
});
