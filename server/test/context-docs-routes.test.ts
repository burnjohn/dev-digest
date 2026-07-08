/**
 * Route tests for the context-docs module's repo-scoped endpoints
 * (GET/PUT /repos/:id/context-folders, GET /repos/:id/context-docs) and the
 * agent/skill attachment routes added in Step 5
 * (GET/POST /agents/:id/context-docs, GET/POST /skills/:id/context-docs).
 *
 * Hermetic: no Postgres, no Docker. Mirrors `blast-routes.test.ts`'s pattern:
 * MockAuthProvider (known workspaceId) + a call-counted fake `db` patched onto
 * `app.container` before each request. `usedByCounts` uses Drizzle's real
 * `union()` builder internally (not fakeable via a plain chain mock — see
 * `context-docs-service.test.ts`), so it is stubbed via
 * `vi.spyOn(ContextDocsRepository.prototype, 'usedByCounts')`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import { ContextDocsRepository } from '../src/modules/context-docs/repository.js';
import type { FastifyInstance } from 'fastify';

const WS_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_WS_ID = '99999999-9999-9999-9999-999999999999';
const REPO_ID = '33333333-3333-3333-3333-333333333333';
const AGENT_ID = '44444444-4444-4444-4444-444444444444';
const SKILL_ID = '55555555-5555-5555-5555-555555555555';
const INVALID_ID = 'not-a-uuid';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const REPO_ROW = {
  id: REPO_ID,
  workspaceId: WS_ID,
  owner: 'acme',
  name: 'api',
  fullName: 'acme/api',
  defaultBranch: 'main',
  clonePath: null,
  contextFolders: null,
};

const AGENT_ROW = {
  id: AGENT_ID,
  workspaceId: WS_ID,
  name: 'Reviewer',
  description: '',
  provider: 'anthropic',
  model: 'claude-sonnet',
  systemPrompt: 'You review PRs.',
  outputSchema: null,
  strategy: 'single-pass',
  ciFailOn: 'critical',
  repoIntel: true,
  enabled: true,
  version: 1,
  createdBy: null,
  createdAt: new Date('2026-01-01'),
};

const SKILL_ROW = {
  id: SKILL_ID,
  workspaceId: WS_ID,
  name: 'Security checklist',
  description: '',
  type: 'security',
  source: 'manual',
  body: '# Security',
  enabled: true,
  version: 1,
  evidenceFiles: null,
};

// ---------------------------------------------------------------------------
// Fake DB
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/**
 * Fake db that answers by sniffing the target table (via which columns are
 * requested / which row shape is stored) rather than call-ordering — safer
 * here since multiple modules' repositories may run in a single request
 * (agents/skills route guard -> ContextDocsRepository).
 */
function makeDb(opts: {
  repoRow?: Row | null;
  agentRow?: Row | null;
  skillRow?: Row | null;
  agentContextDocRows?: { path: string; order: number }[];
  skillContextDocRows?: { path: string; order: number }[];
  /** listOverlays fixture. */
  overlays?: { path: string; body: string }[];
  /** getOverlay fixture. */
  overlay?: { body: string; version: number };
  /** countWorkspaceAgents fixture. */
  agentCount?: number;
  /** deleteOverlay result — non-empty ⇒ a row was deleted. */
  overlayDeleteResult?: { id: string }[];
}) {
  let agentDocs = opts.agentContextDocRows ?? [];
  let skillDocs = opts.skillContextDocRows ?? [];
  const insertCalls: { table: string; values: unknown }[] = [];
  const deleteCalls: string[] = [];

  function makeSelectChain(resolve: () => Row[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      from: (table: unknown) => {
        (chain as { __table?: unknown }).__table = table;
        return chain;
      },
      where: () => chain,
      orderBy: () => chain,
      limit: (_n: number) => Promise.resolve(resolve()),
      then: (
        onFulfilled?: (value: Row[]) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
      catch: (onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve()).catch(onRejected),
    };
    return chain;
  }

  /** Best-effort Drizzle table name lookup (falls back to '' for non-table args). */
  function tableNameOf(table: unknown): string {
    try {
      return getTableName(table as Parameters<typeof getTableName>[0]);
    } catch {
      return '';
    }
  }

  return {
    select: (columns?: Record<string, unknown>) => {
      // Full-row select (agents.getById / skills.getById use bare `.select()`).
      if (!columns) {
        return {
          from: (table: unknown) => {
            const tableName = tableNameOf(table);
            return makeSelectChain(() => {
              if (tableName === 'agents') {
                const row = 'agentRow' in opts ? opts.agentRow : AGENT_ROW;
                return row ? [row] : [];
              }
              if (tableName === 'skills') {
                const row = 'skillRow' in opts ? opts.skillRow : SKILL_ROW;
                return row ? [row] : [];
              }
              return [];
            });
          },
        };
      }

      // Narrow (column-subset) selects — sniff by which keys were requested.
      if ('clonePath' in columns || 'contextFolders' in columns) {
        return {
          from: () =>
            makeSelectChain(() => {
              const row = 'repoRow' in opts ? opts.repoRow : REPO_ROW;
              return row ? [row] : [];
            }),
        };
      }
      if ('path' in columns && 'order' in columns) {
        // agentAttachments / skillAttachments — disambiguate by which link
        // table is being queried via the .from() call captured below.
        return {
          from: (table: unknown) => {
            const tableName = tableNameOf(table);
            return makeSelectChain(() => {
              if (tableName === 'agent_context_docs') return agentDocs;
              if (tableName === 'skill_context_docs') return skillDocs;
              return [];
            });
          },
        };
      }
      // countWorkspaceAgents — select({ count }).
      if ('count' in columns) {
        return { from: () => makeSelectChain(() => [{ count: opts.agentCount ?? 0 }]) };
      }
      // getOverlay — select({ body, version }); listOverlays — select({ path, body }).
      if ('body' in columns && 'version' in columns) {
        return { from: () => makeSelectChain(() => (opts.overlay ? [opts.overlay] : [])) };
      }
      if ('body' in columns && 'path' in columns) {
        return { from: () => makeSelectChain(() => opts.overlays ?? []) };
      }
      return { from: () => makeSelectChain(() => []) };
    },
    insert: (table: unknown) => {
      const tableName = tableNameOf(table);
      return {
        values: (values: { path: string; order: number }[]) => {
          insertCalls.push({ table: tableName, values });
          if (tableName === 'agent_context_docs') agentDocs = values;
          if (tableName === 'skill_context_docs') skillDocs = values;
          // doc_overrides upsert: .values().onConflictDoUpdate().returning()
          const thenable = Promise.resolve() as unknown as Record<string, unknown>;
          thenable.onConflictDoUpdate = () => ({ returning: async () => [{ version: 1 }] });
          return thenable;
        },
      };
    },
    delete: (table: unknown) => {
      const tableName = tableNameOf(table);
      deleteCalls.push(tableName);
      return {
        where: () => {
          if (tableName === 'agent_context_docs') agentDocs = [];
          if (tableName === 'skill_context_docs') skillDocs = [];
          // doc_overrides delete: .where().returning()
          const thenable = Promise.resolve() as unknown as Record<string, unknown>;
          thenable.returning = async () => opts.overlayDeleteResult ?? [];
          return thenable;
        },
      };
    },
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            const row = 'repoRow' in opts ? opts.repoRow : REPO_ROW;
            return row ? [{ id: REPO_ID }] : [];
          },
        }),
      }),
    }),
    __insertCalls: insertCalls,
    __deleteCalls: deleteCalls,
  };
}

async function buildTestApp(opts: Parameters<typeof makeDb>[0] = {}): Promise<FastifyInstance> {
  const mockAuth = new MockAuthProvider(
    { id: 'u1', email: 'you@local', name: 'You' },
    { id: WS_ID, name: 'default' },
  );
  // IMPORTANT: unlike `blast-routes.test.ts` (whose BlastService lazily
  // constructs its repository from `container.db` on first call, so patching
  // `app.container.db` AFTER buildApp works), `AgentsService`/`SkillsService`
  // construct their repositories EAGERLY at plugin-registration time
  // (`new AgentsRepository(container.db)` inside the constructor) — so the
  // mock db MUST be supplied via `buildApp({ db })` BEFORE modules register,
  // not patched onto `app.container` afterward.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = makeDb(opts) as any;
  const app = await buildApp({ config, db, overrides: { auth: mockAuth } });
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// GET/PUT /repos/:id/context-folders
// ---------------------------------------------------------------------------

describe('GET /repos/:id/context-folders', () => {
  it('returns the default folder set when the repo has none configured', async () => {
    const app = await buildTestApp({ repoRow: { ...REPO_ROW, contextFolders: null } });
    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/context-folders` });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ folders: ['specs', 'docs', 'insights'] });
  });

  it('returns 404 for a repo in a different workspace (cross-workspace scoping)', async () => {
    const app = await buildTestApp({ repoRow: null });
    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/context-folders` });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it('returns 422 for a non-UUID repo id', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${INVALID_ID}/context-folders` });
    await app.close();
    expect(res.statusCode).toBe(422);
  });
});

describe('PUT /repos/:id/context-folders', () => {
  it('sets a custom folder set and echoes it back', async () => {
    const app = await buildTestApp({ repoRow: REPO_ROW });
    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${REPO_ID}/context-folders`,
      payload: { folders: ['guides'] },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ folders: ['guides'] });
  });

  it('returns 404 when the repo does not exist in the workspace', async () => {
    const app = await buildTestApp({ repoRow: null });
    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${REPO_ID}/context-folders`,
      payload: { folders: ['guides'] },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  // BUG 1 regression: a folder name that escapes the clone root (path
  // traversal) must be rejected with a ValidationError, not persisted.
  it('rejects a folder name containing ".." (path traversal) with 422', async () => {
    const app = await buildTestApp({ repoRow: REPO_ROW });
    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${REPO_ID}/context-folders`,
      payload: { folders: ['../../../..'] },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it('rejects a folder name containing a path separator with 422', async () => {
    const app = await buildTestApp({ repoRow: REPO_ROW });
    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${REPO_ID}/context-folders`,
      payload: { folders: ['specs/../etc'] },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it('accepts a valid single-segment folder set', async () => {
    const app = await buildTestApp({ repoRow: REPO_ROW });
    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${REPO_ID}/context-folders`,
      payload: { folders: ['my-docs'] },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ folders: ['my-docs'] });
  });
});

// ---------------------------------------------------------------------------
// GET /repos/:id/context-docs
// ---------------------------------------------------------------------------

describe('GET /repos/:id/context-docs', () => {
  it('returns [] when the repo has no clone_path (empty state, never an error)', async () => {
    vi.spyOn(ContextDocsRepository.prototype, 'usedByCounts').mockResolvedValue(new Map());
    const app = await buildTestApp({ repoRow: { ...REPO_ROW, clonePath: null } });
    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/context-docs` });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns 404 when the repo belongs to a different workspace', async () => {
    vi.spyOn(ContextDocsRepository.prototype, 'usedByCounts').mockResolvedValue(new Map());
    const app = await buildTestApp({ repoRow: null });
    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/context-docs` });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// v2 — GET /repos/:id/context-docs/content, PUT, DELETE (AC-23/24/27/34)
// ---------------------------------------------------------------------------

describe('GET /repos/:id/context-docs/content', () => {
  it('returns overlay content with source "overlay-only" for a no-clone repo', async () => {
    const app = await buildTestApp({
      repoRow: { ...REPO_ROW, clonePath: null },
      overlay: { body: '# uploaded', version: 1 },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/context-docs/content?path=docs/x.md`,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ path: 'docs/x.md', content: '# uploaded', source: 'overlay-only' });
  });

  it('404s a confinement-invalid path', async () => {
    const app = await buildTestApp({ repoRow: { ...REPO_ROW, clonePath: null } });
    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/context-docs/content?path=${encodeURIComponent('../../etc/passwd')}`,
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it('404s cross-workspace', async () => {
    const app = await buildTestApp({ repoRow: null });
    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/context-docs/content?path=docs/x.md`,
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /repos/:id/context-docs', () => {
  it('creates an overlay-only document and returns its DTO', async () => {
    vi.spyOn(ContextDocsRepository.prototype, 'usedByCounts').mockResolvedValue(new Map());
    const app = await buildTestApp({ repoRow: { ...REPO_ROW, clonePath: null }, agentCount: 0 });
    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${REPO_ID}/context-docs`,
      payload: { path: 'docs/new.md', body: '# hi there' },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.path).toBe('docs/new.md');
    expect(body.source).toBe('overlay-only');
    expect(body.coverage).toBe(0);
  });

  it('422s a non-.md path', async () => {
    const app = await buildTestApp({ repoRow: { ...REPO_ROW, clonePath: null } });
    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${REPO_ID}/context-docs`,
      payload: { path: 'docs/notes.txt', body: 'x' },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it('404s cross-workspace', async () => {
    const app = await buildTestApp({ repoRow: null });
    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${REPO_ID}/context-docs`,
      payload: { path: 'docs/new.md', body: 'x' },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /repos/:id/context-docs', () => {
  it('deletes an overlay-only doc and reports reverted:false', async () => {
    const app = await buildTestApp({
      repoRow: { ...REPO_ROW, clonePath: null },
      overlayDeleteResult: [{ id: 'ov-1' }],
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/repos/${REPO_ID}/context-docs`,
      payload: { path: 'docs/uploaded.md' },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reverted: false });
  });

  it('404s when there is no overlay to delete', async () => {
    const app = await buildTestApp({
      repoRow: { ...REPO_ROW, clonePath: null },
      overlayDeleteResult: [],
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/repos/${REPO_ID}/context-docs`,
      payload: { path: 'docs/nope.md' },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET/POST /agents/:id/context-docs
// ---------------------------------------------------------------------------

describe('GET /agents/:id/context-docs', () => {
  it('returns the attached documents ordered', async () => {
    const app = await buildTestApp({
      agentRow: AGENT_ROW,
      agentContextDocRows: [
        { path: 'specs/a.md', order: 0 },
        { path: 'specs/b.md', order: 1 },
      ],
    });
    const res = await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/context-docs` });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { owner_id: AGENT_ID, path: 'specs/a.md', order: 0 },
      { owner_id: AGENT_ID, path: 'specs/b.md', order: 1 },
    ]);
  });

  it('returns 404 when the agent does not exist in the workspace', async () => {
    const app = await buildTestApp({ agentRow: null });
    const res = await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/context-docs` });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /agents/:id/context-docs', () => {
  it('sets/reorders attached documents and returns the resulting ordered links', async () => {
    const app = await buildTestApp({ agentRow: AGENT_ROW, agentContextDocRows: [] });
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/context-docs`,
      payload: { document_paths: ['specs/a.md', 'docs/b.md'] },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { owner_id: AGENT_ID, path: 'specs/a.md', order: 0 },
      { owner_id: AGENT_ID, path: 'docs/b.md', order: 1 },
    ]);
  });

  it('returns 404 when the agent does not exist in the workspace', async () => {
    const app = await buildTestApp({ agentRow: null });
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/context-docs`,
      payload: { document_paths: ['specs/a.md'] },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  // BUG 2 regression: a duplicate path used to violate the (agent_id, path)
  // composite PK on insert AFTER the prior delete already committed, wiping
  // the agent's attachments and 500ing. Must now dedup instead.
  it('dedupes duplicate paths instead of wiping attachments or throwing', async () => {
    const app = await buildTestApp({ agentRow: AGENT_ROW, agentContextDocRows: [] });
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/context-docs`,
      payload: { document_paths: ['specs/a.md', 'docs/b.md', 'specs/a.md'] },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { owner_id: AGENT_ID, path: 'specs/a.md', order: 0 },
      { owner_id: AGENT_ID, path: 'docs/b.md', order: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// GET/POST /skills/:id/context-docs
// ---------------------------------------------------------------------------

describe('GET /skills/:id/context-docs', () => {
  it('returns the attached documents ordered', async () => {
    const app = await buildTestApp({
      skillRow: SKILL_ROW,
      skillContextDocRows: [{ path: 'insights/gotcha.md', order: 0 }],
    });
    const res = await app.inject({ method: 'GET', url: `/skills/${SKILL_ID}/context-docs` });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ owner_id: SKILL_ID, path: 'insights/gotcha.md', order: 0 }]);
  });

  it('returns 404 when the skill does not exist in the workspace', async () => {
    const app = await buildTestApp({ skillRow: null });
    const res = await app.inject({ method: 'GET', url: `/skills/${SKILL_ID}/context-docs` });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /skills/:id/context-docs', () => {
  it('sets/reorders attached documents and returns the resulting ordered links', async () => {
    const app = await buildTestApp({ skillRow: SKILL_ROW, skillContextDocRows: [] });
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${SKILL_ID}/context-docs`,
      payload: { document_paths: ['docs/one.md'] },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ owner_id: SKILL_ID, path: 'docs/one.md', order: 0 }]);
  });

  it('returns 404 when the skill does not exist in the workspace', async () => {
    const app = await buildTestApp({ skillRow: null });
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${SKILL_ID}/context-docs`,
      payload: { document_paths: ['docs/one.md'] },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  // BUG 2 regression (skill side) — same PK-conflict/wipe scenario as agents.
  it('dedupes duplicate paths instead of wiping attachments or throwing', async () => {
    const app = await buildTestApp({ skillRow: SKILL_ROW, skillContextDocRows: [] });
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${SKILL_ID}/context-docs`,
      payload: { document_paths: ['docs/one.md', 'docs/one.md', 'specs/two.md'] },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { owner_id: SKILL_ID, path: 'docs/one.md', order: 0 },
      { owner_id: SKILL_ID, path: 'specs/two.md', order: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Workspace-scoping sanity (cross-workspace repo id → 404), explicit per plan.
// ---------------------------------------------------------------------------

describe('workspace scoping — cross-workspace repo id', () => {
  it('GET /repos/:id/context-docs 404s when the repo belongs to another workspace', async () => {
    vi.spyOn(ContextDocsRepository.prototype, 'usedByCounts').mockResolvedValue(new Map());
    // Simulate: MockAuthProvider resolves WS_ID, but the repo row belongs to
    // OTHER_WS_ID — the workspace-scoped query returns undefined (mirrors the
    // real Drizzle `and(eq(id), eq(workspaceId))` filtering it out).
    void OTHER_WS_ID;
    const app = await buildTestApp({ repoRow: null });
    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/context-docs` });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});
