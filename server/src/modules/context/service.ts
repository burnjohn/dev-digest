import { and, eq } from 'drizzle-orm';
import { join } from 'node:path';
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IndexStatus, SpecFile } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { NotFoundError } from '../../platform/errors.js';
import {
  EMBEDDING_BASE_PCT,
  EMBEDDING_SPAN_PCT,
  PARSING_BASE_PCT,
  PARSING_SPAN_PCT,
  PCT_READING,
  SPEC_INDEX_JOB,
  SPECS_SUBDIR,
} from './constants.js';
import { assertSafeSpecPath, chunk } from './helpers.js';

/**
 * A3 — Project Context indexer (deepened from F1 scaffolding, L05, §7.8).
 *
 * Indexes `.devdigest/specs/*.md` into `code_chunks(source='spec')` and exposes
 * a **percentage progress** lifecycle (parsing → embedding → done) driven by the
 * JobRunner. Specs indexed here are picked up by the reviewer/brief prompts
 * (both call `collectSpecs` over `code_chunks` where source='spec').
 *
 * Progress is tracked in-memory per repo (the `jobs` table has no progress
 * column and we MUST NOT alter the schema), and surfaced via
 * `GET /repos/:id/context/status` for the progress-bar UI.
 */

// Re-export the job name so existing importers keep the same public surface.
export { SPEC_INDEX_JOB } from './constants.js';

interface ProgressEntry extends IndexStatus {
  updatedAt: number;
}

/** Module-level registry so progress survives across requests within a process. */
const progress = new Map<string, ProgressEntry>();

function setProgress(repoId: string, status: IndexStatus): void {
  progress.set(repoId, { ...status, updatedAt: Date.now() });
}

export interface SpecIndexPayload {
  workspaceId: string;
  repoId: string;
}

export class ContextService {
  constructor(private container: Container) {}

  /** Idempotent JobRunner registration; safe to call once at module load. */
  static registerJob(container: Container): void {
    const runner = container.jobs;
    // Guard against double-registration across hot-reload / multiple modules.
    if ((runner as unknown as { _specIndexRegistered?: boolean })._specIndexRegistered) return;
    (runner as unknown as { _specIndexRegistered?: boolean })._specIndexRegistered = true;
    runner.register(SPEC_INDEX_JOB, async (payload) => {
      const { workspaceId, repoId } = payload as SpecIndexPayload;
      await new ContextService(container).runIndex(workspaceId, repoId);
    });
  }

  async loadRepo(workspaceId: string, id: string) {
    const [repo] = await this.container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)));
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  async listSpecs(clonePath: string | null): Promise<SpecFile[]> {
    if (!clonePath) return [];
    const dir = join(clonePath, SPECS_SUBDIR);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: SpecFile[] = [];
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.md')) {
        const full = join(dir, e.name);
        const s = await stat(full).catch(() => null);
        out.push({
          path: join(SPECS_SUBDIR, e.name),
          size: s?.size ?? null,
          updated_at: s?.mtime.toISOString() ?? null,
        });
      }
    }
    return out;
  }

  /** Current live status for the progress bar / coverage indicator. */
  async status(workspaceId: string, repoId: string): Promise<IndexStatus> {
    const repo = await this.loadRepo(workspaceId, repoId);
    const live = progress.get(repoId);
    if (live) {
      const { updatedAt: _u, ...rest } = live;
      return rest;
    }
    // No in-flight/recent run → derive an idle status + coverage from the DB.
    const specs = await this.listSpecs(repo.clonePath);
    const indexed = await this.countSpecChunks(repoId);
    const coveredFiles = await this.countCoveredSpecFiles(repoId);
    const coverage = specs.length === 0 ? 0 : Math.round((coveredFiles / specs.length) * 100);
    return {
      status: indexed > 0 ? 'done' : 'idle',
      pct: indexed > 0 ? 100 : 0,
      message:
        specs.length === 0
          ? 'No specs found under .devdigest/specs/'
          : `${coverage}% coverage · ${coveredFiles}/${specs.length} spec file(s) indexed`,
      chunks_indexed: indexed,
    };
  }

  /**
   * Enqueue a reindex job and return the initial status. The actual chunk+embed
   * work runs on the JobRunner (`runIndex`), publishing percentage progress that
   * the UI polls via `status()`.
   */
  async reindex(workspaceId: string, repoId: string): Promise<IndexStatus> {
    const repo = await this.loadRepo(workspaceId, repoId);
    if (!repo.clonePath) {
      const status: IndexStatus = { status: 'error', pct: 0, message: 'Repo is not cloned yet' };
      setProgress(repoId, status);
      return status;
    }
    const specs = await this.listSpecs(repo.clonePath);
    if (specs.length === 0) {
      const status: IndexStatus = {
        status: 'done',
        pct: 100,
        message: 'No specs found under .devdigest/specs/',
        chunks_indexed: 0,
      };
      setProgress(repoId, status);
      return status;
    }
    const initial: IndexStatus = {
      status: 'parsing',
      pct: 0,
      message: `Indexing ${specs.length} spec file(s)…`,
      chunks_indexed: 0,
    };
    setProgress(repoId, initial);
    await this.container.jobs.enqueue(workspaceId, SPEC_INDEX_JOB, { workspaceId, repoId });
    return initial;
  }

  /** The job body: chunk + (best-effort) embed each spec, updating % progress. */
  async runIndex(workspaceId: string, repoId: string): Promise<IndexStatus> {
    const repo = await this.loadRepo(workspaceId, repoId);
    const specs = await this.listSpecs(repo.clonePath);
    setProgress(repoId, { status: 'parsing', pct: PCT_READING, message: 'Reading specs…', chunks_indexed: 0 });

    // clear previous spec chunks for this repo
    await this.container.db
      .delete(t.codeChunks)
      .where(and(eq(t.codeChunks.repoId, repoId), eq(t.codeChunks.source, 'spec')));

    let embedder: Awaited<ReturnType<typeof this.container.embedder>> | null = null;
    try {
      embedder = await this.container.embedder();
    } catch {
      embedder = null;
    }

    let indexed = 0;
    for (let si = 0; si < specs.length; si++) {
      const spec = specs[si]!;
      const content = await readFile(join(repo.clonePath!, spec.path), 'utf8').catch(() => '');
      const chunks = chunk(content);
      const phasePct = PARSING_BASE_PCT + Math.round((si / specs.length) * PARSING_SPAN_PCT); // 10→50 parsing
      setProgress(repoId, {
        status: 'parsing',
        pct: phasePct,
        message: `Chunking ${spec.path}…`,
        chunks_indexed: indexed,
      });

      const embeddings = embedder ? await embedder.embed(chunks).catch(() => null) : null;
      const embPct = EMBEDDING_BASE_PCT + Math.round(((si + 1) / specs.length) * EMBEDDING_SPAN_PCT); // 50→95 embedding
      setProgress(repoId, {
        status: 'embedding',
        pct: embPct,
        message: embedder ? `Embedding ${spec.path}…` : `Storing ${spec.path} (no embeddings)…`,
        chunks_indexed: indexed,
      });

      for (let i = 0; i < chunks.length; i++) {
        await this.container.db.insert(t.codeChunks).values({
          workspaceId,
          repoId,
          path: spec.path,
          content: chunks[i]!,
          embedding: embeddings?.[i] ?? null,
          source: 'spec',
        });
        indexed++;
      }
    }

    const done: IndexStatus = {
      status: 'done',
      pct: 100,
      message: embedder
        ? `Indexed ${indexed} chunk(s) with embeddings · ${specs.length} spec file(s)`
        : `Indexed ${indexed} chunk(s) (no embeddings — set OPENAI_API_KEY) · ${specs.length} spec file(s)`,
      chunks_indexed: indexed,
    };
    setProgress(repoId, done);
    return done;
  }

  /** Read a single spec file's content (for preview/edit). */
  async readSpec(workspaceId: string, repoId: string, specPath: string): Promise<SpecFile> {
    const repo = await this.loadRepo(workspaceId, repoId);
    assertSafeSpecPath(specPath);
    if (!repo.clonePath) throw new NotFoundError('Repo is not cloned');
    const full = join(repo.clonePath, specPath);
    const content = await readFile(full, 'utf8').catch(() => {
      throw new NotFoundError('Spec file not found');
    });
    const s = await stat(full).catch(() => null);
    return { path: specPath, content, size: s?.size ?? null, updated_at: s?.mtime.toISOString() ?? null };
  }

  /** Write a single spec file's content (PUT /context/:path). */
  async writeSpec(
    workspaceId: string,
    repoId: string,
    specPath: string,
    content: string,
  ): Promise<SpecFile> {
    const repo = await this.loadRepo(workspaceId, repoId);
    assertSafeSpecPath(specPath);
    if (!repo.clonePath) throw new NotFoundError('Repo is not cloned');
    const full = join(repo.clonePath, specPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
    const s = await stat(full).catch(() => null);
    return { path: specPath, content, size: s?.size ?? null, updated_at: s?.mtime.toISOString() ?? null };
  }

  private async countSpecChunks(repoId: string): Promise<number> {
    const rows = await this.container.db
      .select({ id: t.codeChunks.id })
      .from(t.codeChunks)
      .where(and(eq(t.codeChunks.repoId, repoId), eq(t.codeChunks.source, 'spec')));
    return rows.length;
  }

  private async countCoveredSpecFiles(repoId: string): Promise<number> {
    const rows = await this.container.db
      .select({ path: t.codeChunks.path })
      .from(t.codeChunks)
      .where(and(eq(t.codeChunks.repoId, repoId), eq(t.codeChunks.source, 'spec')));
    return new Set(rows.map((r) => r.path)).size;
  }
}
