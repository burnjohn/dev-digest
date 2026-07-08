/**
 * Unit tests for ContextDocsService — discovery, token counts, used-by
 * attribution, and the in-process discovery cache.
 *
 * Hermetic: no Postgres, no Docker. `container.db` is a hand-rolled
 * Drizzle-compatible mock (mirrors `blast-routes.test.ts`'s call-counted
 * pattern) for the plain select/update queries; `usedByCounts` uses Drizzle's
 * real `union()` query builder internally (needs real PgSelect objects, not
 * fakeable via a plain chain mock), so it is stubbed via
 * `vi.spyOn(ContextDocsRepository.prototype, 'usedByCounts')` instead —
 * `container.git`/`container.tokenizer` are mocked per `src/adapters/mocks.ts`
 * conventions. Discovery reads REAL files from a temp directory on disk
 * (mirrors `indexer-walk.test.ts` — no DB/Docker/network involved, so this
 * stays hermetic).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile as fsReadFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextDocsService } from '../src/modules/context-docs/service.js';
import { ContextDocsRepository } from '../src/modules/context-docs/repository.js';
import type { Container } from '../src/platform/container.js';

const WS_ID = '22222222-2222-2222-2222-222222222222';
const REPO_ID = '33333333-3333-3333-3333-333333333333';

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (dir && dir !== root) await mkdir(dir, { recursive: true });
  await writeFile(full, contents);
}

interface DbOpts {
  repoRow?: Record<string, unknown> | null;
  /** listOverlays(repoId) fixture — all overlay rows for the repo. */
  overlays?: { path: string; body: string }[];
  /** getOverlay(repoId, path) fixture — the single overlay row, if any. */
  overlay?: { body: string; version: number };
  /** countWorkspaceAgents(workspaceId) fixture (coverage denominator). */
  agentCount?: number;
  /** deleteOverlay(repoId, path) result — non-empty ⇒ a row was deleted. */
  deleteResult?: { id: string }[];
}

/** Minimal Drizzle-compatible mock db. Routes each `select(columns)` by the
 *  column keys so the different repository queries (repo lookup, listOverlays,
 *  getOverlay, countWorkspaceAgents) get distinct fixtures. `usedByCounts`'s
 *  `union()` query is stubbed separately via `vi.spyOn`. */
function makeDb(opts: DbOpts) {
  const resolveFor = (columns?: Record<string, unknown>): Record<string, unknown>[] => {
    const keys = columns ? Object.keys(columns) : [];
    if (keys.includes('count')) return [{ count: opts.agentCount ?? 0 }];
    // getOverlay selects {body, version}; listOverlays selects {path, body}.
    if (keys.includes('version') && keys.includes('body')) return opts.overlay ? [opts.overlay] : [];
    if (keys.includes('body') && keys.includes('path')) return opts.overlays ?? [];
    const row = 'repoRow' in opts ? opts.repoRow : {
      clonePath: '/mock/clone', owner: 'acme', name: 'api', contextFolders: null,
    };
    return row ? [row] : [];
  };

  function makeChain(resolve: () => Record<string, unknown>[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      limit: (_n: number) => Promise.resolve(resolve()),
      returning: (_n: unknown) => Promise.resolve(resolve()),
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
    select: (columns?: Record<string, unknown>) => makeChain(() => resolveFor(columns)),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [{ id: REPO_ID }],
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => [{ version: (opts.overlay?.version ?? 0) + 1 }],
        }),
        returning: async () => [{ version: 1 }],
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () => opts.deleteResult ?? [],
      }),
    }),
  };
}

/** Stub ContextDocsRepository.prototype.usedByCounts for the duration of a test
 *  (restored via vi.restoreAllMocks in afterEach). */
function stubUsedByCounts(map: Map<string, number>): void {
  vi.spyOn(ContextDocsRepository.prototype, 'usedByCounts').mockResolvedValue(map);
}

function buildContainer(opts: {
  root: string;
  repoRow?: Record<string, unknown> | null;
  head?: string;
  overlays?: { path: string; body: string }[];
  overlay?: { body: string; version: number };
  agentCount?: number;
  deleteResult?: { id: string }[];
}): { container: Container; readFile: ReturnType<typeof vi.fn> } {
  const readFile = vi.fn(async (_repo: unknown, relPath: string) => {
    return fsReadFile(join(opts.root, relPath), 'utf8');
  });

  const db = makeDb({
    repoRow: opts.repoRow,
    overlays: opts.overlays,
    overlay: opts.overlay,
    agentCount: opts.agentCount,
    deleteResult: opts.deleteResult,
  });

  const container = {
    db,
    git: {
      clonePathFor: () => opts.root,
      currentHead: vi.fn(async () => opts.head ?? 'sha-1'),
      readFile,
    },
    tokenizer: {
      count: (text: string) => text.split(/\s+/).filter(Boolean).length,
    },
  } as unknown as Container;

  return { container, readFile };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// listDocuments — no clone path (empty, not error)
// ---------------------------------------------------------------------------

describe('ContextDocsService.listDocuments — no clone path', () => {
  it('returns [] when the repo has no clone_path (never throws)', async () => {
    stubUsedByCounts(new Map());
    const { container } = buildContainer({
      root: '/unused',
      repoRow: { clonePath: null, owner: 'acme', name: 'api', contextFolders: null },
    });
    const service = new ContextDocsService(container);
    const result = await service.listDocuments(WS_ID, REPO_ID);
    expect(result).toEqual([]);
  });

  it('throws NotFoundError when the repo does not exist / cross-workspace', async () => {
    stubUsedByCounts(new Map());
    const { container } = buildContainer({ root: '/unused', repoRow: null });
    const service = new ContextDocsService(container);
    await expect(service.listDocuments(WS_ID, REPO_ID)).rejects.toThrow('Repo not found');
  });
});

// ---------------------------------------------------------------------------
// listDocuments — discovered files: token_count / category / used_by_agents
// ---------------------------------------------------------------------------

describe('ContextDocsService.listDocuments — discovery walks real files on disk', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'context-docs-service-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns correct token_count and category for discovered .md files, and merges used_by_agents', async () => {
    await writeFileAt(root, 'specs/foo.md', 'one two three four');
    await writeFileAt(root, 'docs/bar.md', 'one two');

    stubUsedByCounts(new Map([['specs/foo.md', 2]]));

    const { container } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
    });
    const service = new ContextDocsService(container);
    const result = await service.listDocuments(WS_ID, REPO_ID);

    const foo = result.find((d) => d.path === 'specs/foo.md');
    const bar = result.find((d) => d.path === 'docs/bar.md');

    expect(foo).toBeDefined();
    expect(foo!.category).toBe('specs');
    expect(foo!.token_count).toBe(4);
    expect(foo!.used_by_agents).toBe(2);

    expect(bar).toBeDefined();
    expect(bar!.category).toBe('docs');
    expect(bar!.token_count).toBe(2);
    expect(bar!.used_by_agents).toBe(0);
  });

  it('returns [] when no .md files exist under the configured folders (empty state, AC-18)', async () => {
    await mkdir(join(root, 'specs'), { recursive: true });
    stubUsedByCounts(new Map());

    const { container } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
    });
    const service = new ContextDocsService(container);
    const result = await service.listDocuments(WS_ID, REPO_ID);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Discovery cache — hit skips re-read; folder/head change forces re-read
// ---------------------------------------------------------------------------

describe('ContextDocsService — discovery cache', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'context-docs-cache-'));
    await writeFileAt(root, 'specs/foo.md', 'hello world');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('does not re-invoke readFile on a second listDocuments call at the same HEAD + folders', async () => {
    stubUsedByCounts(new Map());
    const repoRow = { clonePath: root, owner: 'acme', name: 'api', contextFolders: null };
    const { container, readFile } = buildContainer({ root, repoRow, head: 'sha-1' });
    const service = new ContextDocsService(container);

    await service.listDocuments(WS_ID, REPO_ID);
    const callCountAfterFirst = readFile.mock.calls.length;
    expect(callCountAfterFirst).toBeGreaterThan(0);

    await service.listDocuments(WS_ID, REPO_ID);
    expect(readFile.mock.calls.length).toBe(callCountAfterFirst);
  });

  it('re-reads when the clone HEAD sha changes between calls', async () => {
    stubUsedByCounts(new Map());
    const repoRow = { clonePath: root, owner: 'acme', name: 'api', contextFolders: null };

    let head = 'sha-1';
    const readFile = vi.fn(async (_repo: unknown, relPath: string) => fsReadFile(join(root, relPath), 'utf8'));
    const db = makeDb({ repoRow });
    const container = {
      db,
      git: {
        clonePathFor: () => root,
        currentHead: vi.fn(async () => head),
        readFile,
      },
      tokenizer: { count: (text: string) => text.split(/\s+/).filter(Boolean).length },
    } as unknown as Container;
    const service = new ContextDocsService(container);

    await service.listDocuments(WS_ID, REPO_ID);
    const afterFirst = readFile.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Same head — cache hit, no new reads.
    await service.listDocuments(WS_ID, REPO_ID);
    expect(readFile.mock.calls.length).toBe(afterFirst);

    // HEAD advances — cache invalidated, re-reads.
    head = 'sha-2';
    await service.listDocuments(WS_ID, REPO_ID);
    expect(readFile.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('re-reads after setContextFolders changes the configured folder set', async () => {
    await writeFileAt(root, 'docs/bar.md', 'another doc here');
    stubUsedByCounts(new Map());

    const repoRow = { clonePath: root, owner: 'acme', name: 'api', contextFolders: null };
    const { container, readFile } = buildContainer({ root, repoRow, head: 'sha-1' });
    const service = new ContextDocsService(container);

    await service.listDocuments(WS_ID, REPO_ID);
    const afterFirst = readFile.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Same folders — cache hit.
    await service.listDocuments(WS_ID, REPO_ID);
    expect(readFile.mock.calls.length).toBe(afterFirst);

    // Change the folder set — must invalidate and re-read.
    await service.setContextFolders(WS_ID, REPO_ID, ['docs']);
    await service.listDocuments(WS_ID, REPO_ID);
    expect(readFile.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});

// ---------------------------------------------------------------------------
// usedByCounts attribution — direct + skill-derived (repository unit test,
// exercising the REAL ContextDocsRepository.usedByCounts against a mock db
// that answers the union()'d sub-selects individually)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// setContextFolders — folder-name path-traversal validation (BUG 1 regression)
// ---------------------------------------------------------------------------

describe('ContextDocsService.setContextFolders — folder-name validation', () => {
  it('rejects a folder name containing ".." with a ValidationError', async () => {
    const { container } = buildContainer({
      root: '/unused',
      repoRow: { clonePath: '/mock/clone', owner: 'acme', name: 'api', contextFolders: null },
    });
    const service = new ContextDocsService(container);
    await expect(service.setContextFolders(WS_ID, REPO_ID, ['../../../..'])).rejects.toThrow(
      /path segment/,
    );
  });

  it('rejects a folder name containing a path separator with a ValidationError', async () => {
    const { container } = buildContainer({
      root: '/unused',
      repoRow: { clonePath: '/mock/clone', owner: 'acme', name: 'api', contextFolders: null },
    });
    const service = new ContextDocsService(container);
    await expect(service.setContextFolders(WS_ID, REPO_ID, ['specs/../../etc'])).rejects.toThrow(
      /path segment/,
    );
    await expect(service.setContextFolders(WS_ID, REPO_ID, ['a\\b'])).rejects.toThrow(
      /path segment/,
    );
  });

  it('rejects a folder name equal to "." or ".."', async () => {
    const { container } = buildContainer({
      root: '/unused',
      repoRow: { clonePath: '/mock/clone', owner: 'acme', name: 'api', contextFolders: null },
    });
    const service = new ContextDocsService(container);
    await expect(service.setContextFolders(WS_ID, REPO_ID, ['.'])).rejects.toThrow(/path segment/);
    await expect(service.setContextFolders(WS_ID, REPO_ID, ['..'])).rejects.toThrow(
      /path segment/,
    );
  });

  it('accepts a valid single-segment folder set', async () => {
    const { container } = buildContainer({
      root: '/unused',
      repoRow: { clonePath: '/mock/clone', owner: 'acme', name: 'api', contextFolders: null },
    });
    const service = new ContextDocsService(container);
    await expect(
      service.setContextFolders(WS_ID, REPO_ID, ['specs', 'my-docs']),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// walkAndTokenize — defensive skip of an already-persisted unsafe folder
// (BUG 1 regression, second layer of defense)
// ---------------------------------------------------------------------------

describe('ContextDocsService.listDocuments — defensive skip of an unsafe persisted folder', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'context-docs-traversal-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('never readdirs an out-of-clone path for a bad persisted folder, and does not throw', async () => {
    stubUsedByCounts(new Map());
    // Simulate a value that bypassed validation (e.g. persisted before the
    // guard existed) by configuring `contextFolders` directly on the repo row.
    const { container } = buildContainer({
      root,
      repoRow: {
        clonePath: root,
        owner: 'acme',
        name: 'api',
        contextFolders: ['../../../..'],
      },
    });
    const service = new ContextDocsService(container);
    const result = await service.listDocuments(WS_ID, REPO_ID);
    expect(result).toEqual([]);
  });
});

describe('ContextDocsRepository.usedByCounts — direct + skill-derived attribution', () => {
  it('counts a path used directly by one agent and via a skill by another agent as 2 distinct agents', async () => {
    // Simulate the repository's final grouped result directly at the service
    // boundary: this is the CONTRACT `listDocuments` relies on (a map of path
    // -> distinct agent count merged onto discovery), verified independently of
    // Drizzle's union() internals (covered by the SQL itself, not unit-testable
    // without a real Postgres per `server/AGENTS.md`'s testing split).
    stubUsedByCounts(
      new Map([
        ['specs/shared.md', 2], // one agent direct + one agent via a linked skill
      ]),
    );

    const root = await mkdtemp(join(tmpdir(), 'context-docs-usedby-'));
    try {
      await writeFileAt(root, 'specs/shared.md', 'shared doc content');
      const { container } = buildContainer({
        root,
        repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
      });
      const service = new ContextDocsService(container);
      const result = await service.listDocuments(WS_ID, REPO_ID);

      const shared = result.find((d) => d.path === 'specs/shared.md');
      expect(shared).toBeDefined();
      expect(shared!.used_by_agents).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// v2 — overlay-preferring reads, coverage, source (AC-25/AC-27/AC-28/AC-29)
// ---------------------------------------------------------------------------

describe('ContextDocsService.listDocuments — overlay/clone/overlay-only source + coverage', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'context-docs-overlay-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('marks source and recomputes token_count from the overlay body for overlaid paths', async () => {
    await writeFileAt(root, 'specs/foo.md', 'clone one two'); // clone: 3 tokens
    stubUsedByCounts(new Map([['specs/foo.md', 1]]));
    const tokenSpy = vi.fn((text: string) => text.split(/\s+/).filter(Boolean).length);

    const { container } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
      overlays: [
        { path: 'specs/foo.md', body: 'overlay body with five words here' }, // 6 tokens
        { path: 'docs/uploaded.md', body: 'brand new' }, // overlay-only, 2 tokens
      ],
      agentCount: 4,
    });
    (container.tokenizer as unknown as { count: typeof tokenSpy }).count = tokenSpy;

    const service = new ContextDocsService(container);
    const result = await service.listDocuments(WS_ID, REPO_ID);

    const foo = result.find((d) => d.path === 'specs/foo.md')!;
    expect(foo.source).toBe('overlay');
    expect(foo.token_count).toBe(6); // from overlay body, not the 3-token clone
    expect(foo.coverage).toBe(25); // used_by 1 / 4 agents

    const uploaded = result.find((d) => d.path === 'docs/uploaded.md')!;
    expect(uploaded.source).toBe('overlay-only');
    expect(uploaded.token_count).toBe(2);
    // overlay body was the tokenized input, never the clone content
    expect(tokenSpy).toHaveBeenCalledWith('overlay body with five words here');
  });

  it('marks a pure clone file source "clone" and computes coverage 0 when the workspace has no agents', async () => {
    await writeFileAt(root, 'specs/foo.md', 'clone content');
    stubUsedByCounts(new Map([['specs/foo.md', 0]]));
    const { container } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
      overlays: [],
      agentCount: 0,
    });
    const service = new ContextDocsService(container);
    const result = await service.listDocuments(WS_ID, REPO_ID);
    const foo = result.find((d) => d.path === 'specs/foo.md')!;
    expect(foo.source).toBe('clone');
    expect(foo.coverage).toBe(0); // no NaN despite 0 agents
  });
});

// ---------------------------------------------------------------------------
// v2 — getDocumentContent (overlay-aware read, AC-23/AC-25)
// ---------------------------------------------------------------------------

describe('ContextDocsService.getDocumentContent', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'context-docs-content-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('prefers overlay content over the clone file (source "overlay")', async () => {
    await writeFileAt(root, 'specs/foo.md', 'the clone version');
    const { container } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
      overlay: { body: 'the edited overlay', version: 2 },
    });
    const service = new ContextDocsService(container);
    const result = await service.getDocumentContent(WS_ID, REPO_ID, 'specs/foo.md');
    expect(result).toEqual({ path: 'specs/foo.md', content: 'the edited overlay', source: 'overlay' });
  });

  it('returns the clone file with source "clone" when no overlay exists', async () => {
    await writeFileAt(root, 'specs/foo.md', 'clone only');
    const { container } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
      overlay: undefined,
    });
    const service = new ContextDocsService(container);
    const result = await service.getDocumentContent(WS_ID, REPO_ID, 'specs/foo.md');
    expect(result).toEqual({ path: 'specs/foo.md', content: 'clone only', source: 'clone' });
  });

  it('returns undefined for a confinement-invalid path (never reads a file)', async () => {
    const { container, readFile } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
    });
    const service = new ContextDocsService(container);
    const result = await service.getDocumentContent(WS_ID, REPO_ID, '../../etc/passwd');
    expect(result).toBeUndefined();
    expect(readFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// v2 — saveDocument / deleteDocument (AC-24/AC-27/AC-34)
// ---------------------------------------------------------------------------

describe('ContextDocsService.saveDocument', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'context-docs-save-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates an overlay-only document (source "overlay-only") when no clone file exists', async () => {
    stubUsedByCounts(new Map());
    const { container } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
      agentCount: 0,
    });
    const service = new ContextDocsService(container);
    const dto = await service.saveDocument(WS_ID, REPO_ID, 'docs/new.md', 'hello world');
    expect(dto.path).toBe('docs/new.md');
    expect(dto.source).toBe('overlay-only');
    expect(dto.token_count).toBe(2);
  });

  it('marks source "overlay" when a clone file already exists at the path', async () => {
    await writeFileAt(root, 'specs/foo.md', 'clone');
    stubUsedByCounts(new Map());
    const { container } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
    });
    const service = new ContextDocsService(container);
    const dto = await service.saveDocument(WS_ID, REPO_ID, 'specs/foo.md', 'edited body');
    expect(dto.source).toBe('overlay');
  });

  it('rejects a non-.md path with ValidationError', async () => {
    const { container } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
    });
    const service = new ContextDocsService(container);
    await expect(service.saveDocument(WS_ID, REPO_ID, 'docs/notes.txt', 'x')).rejects.toThrow();
  });

  it('rejects a path outside the configured folders with ValidationError', async () => {
    const { container } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
    });
    const service = new ContextDocsService(container);
    await expect(service.saveDocument(WS_ID, REPO_ID, '../evil.md', 'x')).rejects.toThrow();
  });
});

describe('ContextDocsService.deleteDocument', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'context-docs-delete-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports reverted:true when a clone file exists at the deleted overlay path', async () => {
    await writeFileAt(root, 'specs/foo.md', 'clone still here');
    stubUsedByCounts(new Map());
    const { container } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
      deleteResult: [{ id: 'overlay-id' }],
    });
    const service = new ContextDocsService(container);
    const result = await service.deleteDocument(WS_ID, REPO_ID, 'specs/foo.md');
    expect(result).toEqual({ reverted: true });
  });

  it('reports reverted:false for an overlay-only document (no clone file)', async () => {
    stubUsedByCounts(new Map());
    const { container } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
      deleteResult: [{ id: 'overlay-id' }],
    });
    const service = new ContextDocsService(container);
    const result = await service.deleteDocument(WS_ID, REPO_ID, 'docs/uploaded.md');
    expect(result).toEqual({ reverted: false });
  });

  it('throws NotFoundError when there is no overlay to delete', async () => {
    const { container } = buildContainer({
      root,
      repoRow: { clonePath: root, owner: 'acme', name: 'api', contextFolders: null },
      deleteResult: [],
    });
    const service = new ContextDocsService(container);
    await expect(service.deleteDocument(WS_ID, REPO_ID, 'docs/x.md')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// v2 — AC-36: no-clone repo still surfaces overlay documents
// ---------------------------------------------------------------------------

describe('ContextDocsService.listDocuments — no-clone repo (AC-36)', () => {
  it('lists overlay documents even when clonePath is null (never returns [] solely for a missing clone)', async () => {
    stubUsedByCounts(new Map([['docs/uploaded.md', 1]]));
    const { container, readFile } = buildContainer({
      root: '/unused',
      repoRow: { clonePath: null, owner: 'acme', name: 'api', contextFolders: null },
      overlays: [{ path: 'docs/uploaded.md', body: 'overlay only doc' }],
      agentCount: 2,
    });
    const service = new ContextDocsService(container);
    const result = await service.listDocuments(WS_ID, REPO_ID);

    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('docs/uploaded.md');
    expect(result[0]!.source).toBe('overlay-only');
    expect(result[0]!.coverage).toBe(50);
    expect(readFile).not.toHaveBeenCalled(); // no clone to read
  });

  it('still surfaces overlays when the clone HEAD lookup throws (unreachable clone)', async () => {
    stubUsedByCounts(new Map());
    const readFile = vi.fn();
    const db = makeDb({
      repoRow: { clonePath: '/stale/clone', owner: 'acme', name: 'api', contextFolders: null },
      overlays: [{ path: 'specs/x.md', body: 'body' }],
      agentCount: 0,
    });
    const container = {
      db,
      git: {
        clonePathFor: () => '/stale/clone',
        currentHead: vi.fn(async () => {
          throw new Error('not a git repo');
        }),
        readFile,
      },
      tokenizer: { count: (text: string) => text.split(/\s+/).filter(Boolean).length },
    } as unknown as Container;
    const service = new ContextDocsService(container);
    const result = await service.listDocuments(WS_ID, REPO_ID);
    expect(result.map((d) => d.path)).toEqual(['specs/x.md']);
    expect(result[0]!.source).toBe('overlay-only');
  });
});
