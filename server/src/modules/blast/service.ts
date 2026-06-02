import { and, eq } from 'drizzle-orm';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type {
  BlastRadius,
  BlastCaller,
  ChangedSymbol,
  CodeReference,
  CodeSymbol,
  DownstreamImpact,
  RepoRef,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { NotFoundError } from '../../platform/errors.js';
import { extractEndpoints, extractCrons } from '../../adapters/codeindex/extract.js';
import { INSERT_CHUNK_SIZE, NO_FILES_SUMMARY, NOT_CLONED_SUMMARY } from './constants.js';
import { callerName, summarizeBlast } from './helpers.js';

/**
 * A3 — Blast-radius service (L04, §7.x).
 *
 * Builds a `BlastRadius` for a PR by:
 *   1. resolving the set of files changed in the PR (from `pr_files`);
 *   2. listing all symbols in the clone via `container.codeIndex.symbols()`
 *      and keeping the ones DECLARED in changed files = `changed_symbols`;
 *   3. for each changed symbol, finding downstream callers via
 *      `container.codeIndex.references()` (excluding self-file declarations),
 *      and detecting HTTP endpoints / cron jobs reachable from the caller
 *      files (so reviewers see the API/cron surface a change can break);
 *   4. caching symbols/references into the `symbols`/`references` tables;
 *   5. composing a one-line `summary`.
 *
 * Degrades gracefully: with no clone path, returns an empty-but-valid
 * BlastRadius. All file I/O / index work goes through the CodeIndex + Git
 * adapters so it is fully mockable in tests.
 */
export class BlastService {
  constructor(private container: Container) {}

  async forPull(workspaceId: string, prId: string): Promise<BlastRadius> {
    const db = this.container.db;
    const [pull] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pull) throw new NotFoundError('Pull request not found');

    const [repo] = await db.select().from(t.repos).where(eq(t.repos.id, pull.repoId));
    if (!repo) throw new NotFoundError('Repo not found');

    const changedFiles = (
      await db.select({ path: t.prFiles.path }).from(t.prFiles).where(eq(t.prFiles.prId, prId))
    ).map((r) => r.path);

    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    // Nothing to analyze if the repo isn't cloned or no files are recorded.
    if (!repo.clonePath || changedFiles.length === 0) {
      return {
        changed_symbols: [],
        downstream: [],
        summary: changedFiles.length === 0 ? NO_FILES_SUMMARY : NOT_CLONED_SUMMARY,
      };
    }

    const changedSet = new Set(changedFiles);

    // (2) all symbols → those declared in changed files.
    const allSymbols = await this.container.codeIndex.symbols(ref);
    const changedSymbols: ChangedSymbol[] = [];
    const seen = new Set<string>();
    for (const s of allSymbols) {
      if (!changedSet.has(s.path)) continue;
      // collapse Class.method duplicates: keep the most specific record per name+file
      const key = `${s.name}:${s.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      changedSymbols.push({ name: s.name, file: s.path, kind: s.kind });
    }

    // Persist symbols cache for the repo (idempotent: clear + reinsert changed-file symbols).
    await this.persistSymbols(repo.id, allSymbols);

    // (3) downstream callers per changed symbol.
    const downstream: DownstreamImpact[] = [];
    for (const sym of changedSymbols) {
      // skip pure type/interface symbols for caller search — they have no call sites
      const lookupName = sym.name;
      const refs = await this.container.codeIndex.references(ref, lookupName);
      const callers: BlastCaller[] = [];
      const callerFiles = new Set<string>();
      for (const r of refs) {
        if (r.fromPath === sym.file) continue; // ignore same-file (likely the decl/neighbours)
        callers.push({ name: callerName(allSymbols, r), file: r.fromPath, line: r.line });
        callerFiles.add(r.fromPath);
      }
      if (callers.length === 0) continue;

      await this.persistReferences(repo.id, refs.filter((r) => r.fromPath !== sym.file));

      const endpoints = new Set<string>();
      const crons = new Set<string>();
      for (const file of callerFiles) {
        const content = await this.readClone(repo.clonePath, file);
        if (!content) continue;
        for (const e of extractEndpoints(content)) endpoints.add(e);
        for (const c of extractCrons(content)) crons.add(c);
      }

      downstream.push({
        symbol: sym.name,
        callers,
        endpoints_affected: [...endpoints],
        crons_affected: [...crons],
      });
    }

    return {
      changed_symbols: changedSymbols,
      downstream,
      summary: summarizeBlast(changedSymbols, downstream),
    };
  }

  private async readClone(clonePath: string, file: string): Promise<string | null> {
    return readFile(join(clonePath, file), 'utf8').catch(() => null);
  }

  private async persistSymbols(repoId: string, symbols: CodeSymbol[]): Promise<void> {
    const db = this.container.db;
    await db.delete(t.symbols).where(eq(t.symbols.repoId, repoId));
    if (symbols.length === 0) return;
    // chunk inserts to stay well under parameter limits
    const rows = symbols.map((s) => ({
      repoId,
      path: s.path,
      name: s.name,
      kind: s.kind,
      line: s.line,
    }));
    for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
      await db.insert(t.symbols).values(rows.slice(i, i + INSERT_CHUNK_SIZE));
    }
  }

  private async persistReferences(repoId: string, refs: CodeReference[]): Promise<void> {
    if (refs.length === 0) return;
    const db = this.container.db;
    const rows = refs.map((r) => ({
      repoId,
      fromPath: r.fromPath,
      toSymbol: r.toSymbol,
      line: r.line,
    }));
    for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
      await db.insert(t.references).values(rows.slice(i, i + INSERT_CHUNK_SIZE));
    }
  }
}
