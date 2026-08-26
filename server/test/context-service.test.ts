import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { ContextService, computeUsageCounts } from '../src/modules/context/service.js';
import { ValidationError } from '../src/platform/errors.js';

/**
 * T7 (SPEC-01 project context) — `context/service.ts`, hermetic lane. Repository-
 * heavy behaviour (the replace-set write, REQ-18's DB-backed traversal, REQ-7's
 * usage counts pulled from real rows) is covered against real Postgres in
 * `context-api.it.test.ts`; this file covers the service's PURE combine step
 * (`computeUsageCounts`) and its filesystem-only behaviour (preview / upload
 * path safety), following `onion-architecture` §5 Tests — `Deps` supplied as an
 * object literal, no `as never`, no private-field write.
 */

type Row = Record<string, unknown>;

/** Same shape as `test/blast.test.ts`'s `fakeDb` — `where` ignores its condition and just returns the seeded rows for that table. */
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

describe('computeUsageCounts (REQ-7, pure)', () => {
  it('counts an agent once whether it reaches a path directly, via an enabled skill, or both', () => {
    const counts = computeUsageCounts(
      [{ path: 'specs/a.md', agentId: 'agent-1' }],
      [
        { path: 'specs/a.md', agentId: 'agent-1', skillEnabled: true },
        { path: 'specs/a.md', agentId: 'agent-2', skillEnabled: true },
      ],
    );
    expect(counts.get('specs/a.md')).toEqual({ usedByAgents: 2, usedByDisabledSkillOnly: 0 });
  });

  it('reports an agent reached ONLY through a disabled skill as a breakdown of N, never added to it', () => {
    const counts = computeUsageCounts(
      [],
      [
        { path: 'specs/a.md', agentId: 'agent-1', skillEnabled: false },
        { path: 'specs/a.md', agentId: 'agent-2', skillEnabled: true },
      ],
    );
    expect(counts.get('specs/a.md')).toEqual({ usedByAgents: 2, usedByDisabledSkillOnly: 1 });
  });

  it('a DIRECT attachment always counts as live, even alongside a disabled-skill path for the same agent', () => {
    const counts = computeUsageCounts(
      [{ path: 'specs/a.md', agentId: 'agent-1' }],
      [{ path: 'specs/a.md', agentId: 'agent-1', skillEnabled: false }],
    );
    expect(counts.get('specs/a.md')).toEqual({ usedByAgents: 1, usedByDisabledSkillOnly: 0 });
  });

  it('an unattached path is simply absent from the map', () => {
    const counts = computeUsageCounts([], []);
    expect(counts.size).toBe(0);
  });
});

describe('ContextService — preview / upload (fs-only, fake Db for the repo lookup)', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function freshDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  function buildService(cloneDir: string, uploadDir: string): ContextService {
    const rowsByTable = new Map<unknown, Row[]>([
      [t.repos, [{ id: 'repo-1', owner: 'acme', name: 'demo' }]],
    ]);
    return new ContextService({
      db: fakeDb(rowsByTable),
      config: { contextSearchRoots: ['.'], contextUploadDir: uploadDir },
      git: { clonePathFor: () => cloneDir },
    });
  }

  it('REQ-3 — preview returns the current text and touches neither the bytes nor the mtime on disk', async () => {
    const cloneDir = await freshDir('context-svc-clone-');
    const uploadDir = await freshDir('context-svc-upload-');
    await mkdir(join(cloneDir, 'specs'), { recursive: true });
    await writeFile(join(cloneDir, 'specs', 'a.md'), 'hello world');

    const before = await stat(join(cloneDir, 'specs', 'a.md'));
    const beforeBytes = await readFile(join(cloneDir, 'specs', 'a.md'));

    const service = buildService(cloneDir, uploadDir);
    const outcome = await service.previewDocument('ws-1', 'repo-1', 'specs/a.md');

    expect(outcome).toEqual({
      ok: true,
      doc: expect.objectContaining({ path: 'specs/a.md', content: 'hello world' }),
    });

    const after = await stat(join(cloneDir, 'specs', 'a.md'));
    const afterBytes = await readFile(join(cloneDir, 'specs', 'a.md'));
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(afterBytes.equals(beforeBytes)).toBe(true);
  });

  it('REQ-30 — a path escaping both the clone dir and the upload dir is refused, not opened', async () => {
    const cloneDir = await freshDir('context-svc-clone-');
    const uploadDir = await freshDir('context-svc-upload-');
    const service = buildService(cloneDir, uploadDir);

    const outcome = await service.previewDocument('ws-1', 'repo-1', '../../etc/passwd');
    expect(outcome).toEqual({ ok: false, reason: 'escaped' });
  });

  it('a path contained but not on disk previews as not_found, distinct from escaped', async () => {
    const cloneDir = await freshDir('context-svc-clone-');
    const uploadDir = await freshDir('context-svc-upload-');
    const service = buildService(cloneDir, uploadDir);

    const outcome = await service.previewDocument('ws-1', 'repo-1', 'specs/missing.md');
    expect(outcome).toEqual({ ok: false, reason: 'not_found' });
  });

  it('REQ-4/REQ-31 — uploads land under <contextUploadDir>/<workspaceId>/<repoId>/ using path.basename', async () => {
    const cloneDir = await freshDir('context-svc-clone-');
    const uploadDir = await freshDir('context-svc-upload-');
    const service = buildService(cloneDir, uploadDir);

    const doc = await service.uploadDocument('ws-1', 'repo-1', '../../evil/notes.md', '# hi');

    expect(doc.path).toBe('notes.md');
    expect(doc.source).toBe('upload');
    const written = await readFile(join(uploadDir, 'ws-1', 'repo-1', 'notes.md'), 'utf8');
    expect(written).toBe('# hi');
  });

  it('REQ-31 — rejects a non-.md filename', async () => {
    const cloneDir = await freshDir('context-svc-clone-');
    const uploadDir = await freshDir('context-svc-upload-');
    const service = buildService(cloneDir, uploadDir);

    await expect(service.uploadDocument('ws-1', 'repo-1', 'notes.txt', 'x')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('REQ-8/REQ-31 — rejects a body over the 400 KB bound', async () => {
    const cloneDir = await freshDir('context-svc-clone-');
    const uploadDir = await freshDir('context-svc-upload-');
    const service = buildService(cloneDir, uploadDir);

    const big = 'x'.repeat(400 * 1024 + 1);
    await expect(service.uploadDocument('ws-1', 'repo-1', 'big.md', big)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('REQ-25 — no LLM or embedding call is reachable from this module', () => {
  it('grep over the three new module files finds no call into an LLM/embedding capability', () => {
    const files = [
      '../src/modules/context/service.ts',
      '../src/modules/context/repository.ts',
      '../src/modules/context/routes.ts',
    ];
    const forbidden = /container\.llm|container\.embedder|\.embed\(|completeStructured|\.complete\(/;
    for (const rel of files) {
      const path = new URL(rel, import.meta.url);
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(forbidden);
    }
  });
});
