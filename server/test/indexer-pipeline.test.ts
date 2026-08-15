/**
 * T2.2 — full + incremental pipeline tests.
 *
 * No real DB. Uses a small in-memory `RepoIntelRepository` stub so the focus
 * stays on pipeline flow:
 *   - runFullIndex over a tmpdir clone → expected symbols/references persisted,
 *     repo_index_state stamped 'full' on a clean pass (T3: graph/rank/map ran
 *     via stubbed depgraph+tokenizer), unsupported / oversize files counted.
 *   - runIncremental flow branches:
 *       * indexer-version mismatch → delegates to full
 *       * sha unchanged             → touchIndexState, no file work
 *       * empty supported intersection → advanceSha
 *       * normal slice              → delete + reparse + upsert
 *       * over-threshold diff       → delegates to full
 *
 * Full-DB persistence is covered by integration.test.ts (Docker-gated).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runFullIndex } from '../src/modules/repo-intel/pipeline/full.js';
import { runIncremental } from '../src/modules/repo-intel/pipeline/incremental.js';
import type { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import type { Container } from '../src/platform/container.js';

// ---------------------------------------------------------------------------
// In-memory repository stub — matches RepoIntelRepository's surface.
// ---------------------------------------------------------------------------

interface RepoBasics {
  id: string;
  owner: string;
  name: string;
  clonePath: string | null;
}

function makeRepoStub(opts: {
  basics: RepoBasics | null;
  initialState?: IndexState | null;
}) {
  const symbols: unknown[] = [];
  const references: unknown[] = [];
  let state: IndexState | null = opts.initialState ?? null;

  const stub = {
    getRepoBasics: async () => opts.basics,
    tryGetIndexState: async () => state,
    deleteAllForRepo: async () => {
      symbols.length = 0;
      references.length = 0;
    },
    deleteForFiles: async (_repoId: string, paths: string[]) => {
      const set = new Set(paths);
      for (let i = symbols.length - 1; i >= 0; i--) {
        if (set.has((symbols[i] as { path: string }).path)) symbols.splice(i, 1);
      }
      for (let i = references.length - 1; i >= 0; i--) {
        if (set.has((references[i] as { fromPath: string }).fromPath)) {
          references.splice(i, 1);
        }
      }
    },
    insertSymbols: async (rows: unknown[]) => {
      symbols.push(...rows);
    },
    insertReferences: async (rows: unknown[]) => {
      references.push(...rows);
    },
    // The full-index persist path goes through this one method so the wipe and
    // the re-insert share a transaction (see repository.replaceAllForRepo). The
    // stub composes the same three primitives, which keeps the assertions below
    // reading real inserted rows.
    replaceAllForRepo: async (repoId: string, syms: unknown[], refs: unknown[]) => {
      await stub.deleteAllForRepo(repoId);
      await stub.insertSymbols(syms);
      await stub.insertReferences(refs);
    },
    upsertIndexState: async (s: {
      repoId: string;
      lastIndexedSha: string;
      indexerVersion: number;
      status: 'full' | 'partial' | 'degraded' | 'failed';
      filesIndexed: number;
      filesSkipped: number;
      stats: Record<string, unknown>;
    }) => {
      state = {
        repoId: s.repoId,
        status: s.status,
        filesIndexed: s.filesIndexed,
        filesSkipped: s.filesSkipped,
        durationMs:
          typeof s.stats.durationMs === 'number' ? (s.stats.durationMs as number) : 0,
        reason: typeof s.stats.reason === 'string' ? (s.stats.reason as string) : undefined,
        lastIndexedSha: s.lastIndexedSha,
        indexerVersion: s.indexerVersion,
        updatedAt: new Date(),
      };
    },
    touchIndexState: async () => {
      if (state) state = { ...state, updatedAt: new Date() };
    },
    advanceSha: async (_id: string, sha: string) => {
      if (state) state = { ...state, lastIndexedSha: sha, updatedAt: new Date() };
    },
    // T3 writes/reads — no-op/in-memory; persistence is covered by integration.
    replaceEdges: async () => {},
    replaceFileRank: async () => {},
    replaceFileFacts: async () => {},
    patchFileFacts: async () => {},
    resolveReferences: async () => {},
    getRepoMapCandidates: async () => [],
    deleteRepoMapCache: async () => {},
    putRepoMapCache: async () => {},
  };

  // The pipeline calls these via the typed repository; the stub satisfies the
  // structural shape. `unknown as` keeps the test isolated from the class's
  // private fields without leaking type-erased anys into the pipeline code.
  return {
    repo: stub as unknown as RepoIntelRepository,
    symbols,
    references,
    getState: () => state,
  };
}

// Minimal Container — only the fields the pipeline reads.
interface MiniGit {
  currentHead: () => Promise<string>;
  diffNameOnly: (
    ref: { owner: string; name: string },
    base: string,
    head: string,
  ) => Promise<string[]>;
}
function makeContainer(git: MiniGit): Container {
  return {
    git,
    // T3 adapters — stubbed: empty graph (rank degrades to flat) + char/4 tokens.
    depgraph: { buildEdges: async () => [] },
    tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
  } as unknown as Container;
}

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  // Use dirname rather than searching for '/': join() emits the platform
  // separator, so on Windows the path is backslash-delimited and a '/' scan
  // finds nothing — the parent directory was never created and every write of
  // a nested path (e.g. 'src/a.ts') failed with ENOENT.
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

// ---------------------------------------------------------------------------
// runFullIndex
// ---------------------------------------------------------------------------

describe('runFullIndex', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'repo-intel-full-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('walks, parses, persists, and stamps status="full" with INDEXER_VERSION', async () => {
    await writeFileAt(
      root,
      'src/util.ts',
      `export function alpha(x: number) { return x + 1; }\nexport function beta() { return alpha(2); }\n`,
    );
    await writeFileAt(
      root,
      'src/caller.ts',
      `import { alpha } from './util';\nexport function caller() { return alpha(10); }\n`,
    );
    // ignored extensions
    await writeFileAt(root, 'README.md', '# nope');

    const stub = makeRepoStub({
      basics: { id: 'r1', owner: 'acme', name: 'app', clonePath: root },
    });
    const container = makeContainer({
      currentHead: async () => 'sha-head',
      diffNameOnly: async () => [],
    });

    const result = await runFullIndex(container, stub.repo, { repoId: 'r1' });

    // Clean pass (no soft-budget / graph failure / parse errors) → 'full' (T3).
    expect(result.status).toBe('full');
    expect(result.filesIndexed).toBe(2);
    expect(result.filesSkipped).toBe(0);

    // Symbols include functions from both files.
    const symbolNames = stub.symbols.map((s) => (s as { name: string }).name).sort();
    expect(symbolNames).toContain('alpha');
    expect(symbolNames).toContain('beta');
    expect(symbolNames).toContain('caller');

    // References include `alpha` called from both files.
    const refNames = stub.references.map((r) => (r as { toSymbol: string }).toSymbol);
    expect(refNames).toContain('alpha');

    // Index state persisted with the expected shape.
    const state = stub.getState();
    expect(state).not.toBeNull();
    expect(state!.lastIndexedSha).toBe('sha-head');
    expect(state!.indexerVersion).toBe(INDEXER_VERSION);
    expect(state!.status).toBe('full');
    expect(state!.filesIndexed).toBe(2);
  });

  it('returns degraded when the repo has no clonePath (writes a degraded state row)', async () => {
    const stub = makeRepoStub({
      basics: { id: 'r2', owner: 'acme', name: 'app', clonePath: null },
    });
    const container = makeContainer({
      currentHead: async () => '',
      diffNameOnly: async () => [],
    });

    const result = await runFullIndex(container, stub.repo, { repoId: 'r2' });
    expect(result.status).toBe('degraded');
    expect(result.reason).toBe('no_clone');

    const state = stub.getState();
    expect(state).not.toBeNull();
    expect(state!.status).toBe('degraded');
  });

  it('returns degraded when the repo is missing (no row to write)', async () => {
    const stub = makeRepoStub({ basics: null });
    const container = makeContainer({
      currentHead: async () => '',
      diffNameOnly: async () => [],
    });

    const result = await runFullIndex(container, stub.repo, { repoId: 'missing' });
    expect(result.status).toBe('degraded');
    expect(result.reason).toBe('repo_not_found');
    expect(stub.getState()).toBeNull();
  });

  it('returns partial with filesIndexed=0 when the clone has no supported files', async () => {
    await writeFileAt(root, 'README.md', '# nothing to parse');

    const stub = makeRepoStub({
      basics: { id: 'r3', owner: 'acme', name: 'app', clonePath: root },
    });
    const container = makeContainer({
      currentHead: async () => 'sha-empty',
      diffNameOnly: async () => [],
    });

    const result = await runFullIndex(container, stub.repo, { repoId: 'r3' });
    expect(result.status).toBe('partial');
    expect(result.filesIndexed).toBe(0);
    expect(result.reason).toBe('no_files');
    expect(stub.getState()!.lastIndexedSha).toBe('sha-empty');
  });
});

// ---------------------------------------------------------------------------
// runIncremental
// ---------------------------------------------------------------------------

describe('runIncremental', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'repo-intel-inc-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function makeInitialState(overrides?: Partial<IndexState>): IndexState {
    return {
      repoId: 'r1',
      status: 'partial',
      filesIndexed: 5,
      filesSkipped: 0,
      durationMs: 100,
      lastIndexedSha: 'sha-old',
      indexerVersion: INDEXER_VERSION,
      updatedAt: new Date(0),
      ...overrides,
    };
  }

  it('no state row → delegates to runFullIndex', async () => {
    await writeFileAt(root, 'src/a.ts', 'export const a = 1;');

    const stub = makeRepoStub({
      basics: { id: 'r1', owner: 'acme', name: 'app', clonePath: root },
      initialState: null,
    });
    const container = makeContainer({
      currentHead: async () => 'sha-new',
      diffNameOnly: async () => [],
    });

    const result = await runIncremental(container, stub.repo, { repoId: 'r1' });
    // Full path on a clean tree → 'full' with the new sha persisted (T3).
    expect(result.status).toBe('full');
    expect(stub.getState()!.lastIndexedSha).toBe('sha-new');
  });

  it('indexer-version mismatch → delegates to runFullIndex', async () => {
    await writeFileAt(root, 'src/a.ts', 'export const a = 1;');

    const stub = makeRepoStub({
      basics: { id: 'r1', owner: 'acme', name: 'app', clonePath: root },
      initialState: makeInitialState({ indexerVersion: INDEXER_VERSION - 1 }),
    });
    const container = makeContainer({
      currentHead: async () => 'sha-new',
      diffNameOnly: async () => [],
    });

    await runIncremental(container, stub.repo, { repoId: 'r1' });
    expect(stub.getState()!.indexerVersion).toBe(INDEXER_VERSION);
    expect(stub.getState()!.lastIndexedSha).toBe('sha-new');
  });

  it('sha unchanged → touches updated_at, no parse work', async () => {
    const stub = makeRepoStub({
      basics: { id: 'r1', owner: 'acme', name: 'app', clonePath: root },
      initialState: makeInitialState({ lastIndexedSha: 'sha-same' }),
    });
    const container = makeContainer({
      currentHead: async () => 'sha-same',
      diffNameOnly: async () => {
        throw new Error('should not be called');
      },
    });

    const result = await runIncremental(container, stub.repo, { repoId: 'r1' });
    expect(result.reason).toBe('sha_unchanged');
    expect(stub.symbols.length).toBe(0);
    expect(stub.references.length).toBe(0);
    // updatedAt bumped, but sha+files counters preserved.
    expect(stub.getState()!.lastIndexedSha).toBe('sha-same');
    expect(stub.getState()!.filesIndexed).toBe(5);
  });

  it('changed files outside SUPPORTED_EXT → only advances sha', async () => {
    const stub = makeRepoStub({
      basics: { id: 'r1', owner: 'acme', name: 'app', clonePath: root },
      initialState: makeInitialState(),
    });
    const container = makeContainer({
      currentHead: async () => 'sha-new',
      diffNameOnly: async () => ['README.md', 'package.json'],
    });

    const result = await runIncremental(container, stub.repo, { repoId: 'r1' });
    expect(result.reason).toBe('no_supported_changes');
    expect(stub.symbols.length).toBe(0);
    expect(stub.getState()!.lastIndexedSha).toBe('sha-new');
  });

  it('reparses changed slice and bumps counters', async () => {
    await writeFileAt(
      root,
      'src/changed.ts',
      `export function fresh(x: number) { return x; }\n`,
    );

    const stub = makeRepoStub({
      basics: { id: 'r1', owner: 'acme', name: 'app', clonePath: root },
      initialState: makeInitialState(),
    });
    const container = makeContainer({
      currentHead: async () => 'sha-new',
      diffNameOnly: async () => ['src/changed.ts'],
    });

    const result = await runIncremental(container, stub.repo, { repoId: 'r1' });
    expect(result.status).toBe('partial');
    expect(result.filesIndexed).toBe(1);
    const names = stub.symbols.map((s) => (s as { name: string }).name);
    expect(names).toContain('fresh');
    // counter is prior (5) + this slice's filesIndexed (1).
    expect(stub.getState()!.filesIndexed).toBe(6);
    expect(stub.getState()!.lastIndexedSha).toBe('sha-new');
  });

  it('large diff (> threshold) → delegates to runFullIndex', async () => {
    await writeFileAt(root, 'src/a.ts', 'export const a = 1;');

    const stub = makeRepoStub({
      basics: { id: 'r1', owner: 'acme', name: 'app', clonePath: root },
      initialState: makeInitialState(),
    });
    // 301 changed files — over the 300 threshold.
    const changed = Array.from({ length: 301 }, (_, i) => `src/big-${i}.ts`);
    const container = makeContainer({
      currentHead: async () => 'sha-huge',
      diffNameOnly: async () => changed,
    });

    const result = await runIncremental(container, stub.repo, { repoId: 'r1' });
    // Full reindex ran — it walked the real tmpdir (just src/a.ts) and persisted.
    expect(result.status).toBe('full');
    expect(stub.getState()!.lastIndexedSha).toBe('sha-huge');
    const names = stub.symbols.map((s) => (s as { name: string }).name);
    // The 'a' const declarator has no function-like value → not emitted by parseSymbols.
    // Still: we asserted full-index path by checking the new sha was persisted.
    expect(Array.isArray(names)).toBe(true);
  });

  it('diff failure → falls back to full index', async () => {
    await writeFileAt(root, 'src/a.ts', 'export function go() {}\n');

    const stub = makeRepoStub({
      basics: { id: 'r1', owner: 'acme', name: 'app', clonePath: root },
      initialState: makeInitialState(),
    });
    const container = makeContainer({
      currentHead: async () => 'sha-new',
      diffNameOnly: async () => {
        throw new Error('shallow clone, base missing');
      },
    });

    const result = await runIncremental(container, stub.repo, { repoId: 'r1' });
    expect(result.status).toBe('full');
    expect(stub.getState()!.lastIndexedSha).toBe('sha-new');
  });
});
