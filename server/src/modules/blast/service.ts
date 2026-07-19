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
import { clampIndexedName } from '../../db/schema/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { extractEndpoints, extractCrons } from '../../adapters/codeindex/extract.js';
import { CALLER_CAP, INSERT_CHUNK_SIZE, NO_FILES_SUMMARY, NOT_CLONED_SUMMARY } from './constants.js';
import { callerName, summarizeBlast } from './helpers.js';
import type { BlastResult, BlastCallerRow } from '../repo-intel/types.js';

/**
 * Blast-radius service (L04).
 *
 * Builds a `BlastRadius` for a PR by reading the ALREADY-BUILT repo-intel index
 * (built at clone time): changed files → symbols declared there → downstream
 * callers → reachable HTTP endpoints / crons. It makes NO LLM call and does NO
 * parsing during review — a deterministic, fast projection. All I/O goes through
 * adapters (repoIntel / codeIndex / git) so it is fully mockable.
 *
 * Degrades honestly: no clone / no files / degraded index → a valid empty-but-
 * explained result (never a blank screen, never a throw).
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

    // Nothing to analyze if the repo isn't cloned or no files are recorded →
    // valid empty result with an explanatory summary (empty state, not blank).
    if (!repo.clonePath || changedFiles.length === 0) {
      return {
        changed_symbols: [],
        downstream: [],
        summary: changedFiles.length === 0 ? NO_FILES_SUMMARY : NOT_CLONED_SUMMARY,
      };
    }

    // Facade-first: when repo-intel is enabled AND the persistent index is built,
    // serve blast from the cache (symbols / resolved refs / file_rank /
    // file_facts) with ZERO clone parsing. The ripgrep path below is the degraded
    // fallback (flag off, or index not ready yet).
    if (this.container.config.repoIntelEnabled) {
      const fb = await this.container.repoIntel.getBlastRadius(repo.id, changedFiles);
      if (!fb.degraded) return mapFacadeBlast(fb);
    }

    const changedSet = new Set(changedFiles);

    // (2) all symbols → those declared in changed files.
    const allSymbols = await this.container.codeIndex.symbols(ref);
    const changedSymbols: ChangedSymbol[] = [];
    const seen = new Set<string>();
    for (const s of allSymbols) {
      if (!changedSet.has(s.path)) continue;
      const key = `${s.name}:${s.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      changedSymbols.push({ name: s.name, file: s.path, kind: s.kind });
    }

    if (!this.container.config.repoIntelEnabled) {
      await this.persistSymbols(repo.id, allSymbols);
    }

    // (3) downstream callers per changed symbol (cap + sort + exclude decl-file).
    const downstream: DownstreamImpact[] = [];
    for (const sym of changedSymbols) {
      const refs = await this.container.codeIndex.references(ref, sym.name);
      const callerRows = refs
        .filter((r) => r.fromPath !== sym.file) // exclude the declaring file
        .map((r) => ({ name: callerName(allSymbols, r), file: r.fromPath, line: r.line, rank: 0 }));
      if (callerRows.length === 0) continue;

      if (!this.container.config.repoIntelEnabled) {
        await this.persistReferences(repo.id, refs.filter((r) => r.fromPath !== sym.file));
      }

      const callers: BlastCaller[] = callerRows.slice(0, CALLER_CAP).map((c) => ({
        name: c.name,
        file: c.file,
        line: c.line,
      }));

      const endpoints = new Set<string>();
      const crons = new Set<string>();
      for (const file of new Set(callers.map((c) => c.file))) {
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
    const rows = symbols.map((s) => ({
      repoId,
      path: s.path,
      name: clampIndexedName(s.name),
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
      toSymbol: clampIndexedName(r.toSymbol),
      line: r.line,
    }));
    for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
      await db.insert(t.references).values(rows.slice(i, i + INSERT_CHUNK_SIZE));
    }
  }
}

/**
 * Map the repo-intel facade's `BlastResult` into the public `BlastRadius`:
 *   - group callers by the changed symbol they reach (`viaSymbol`);
 *   - EXCLUDE the declaring file; SORT by file rank (desc); CAP at 20 per symbol
 *     — the invariants are enforced HERE, not trusted to the facade;
 *   - attribute endpoints/crons from each caller file's precomputed facts.
 */
export function mapFacadeBlast(fb: BlastResult): BlastRadius {
  const changed_symbols: ChangedSymbol[] = fb.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));
  const declFileByName = new Map(fb.changedSymbols.map((s) => [s.name, s.file]));

  const byVia = new Map<string, BlastCallerRow[]>();
  for (const c of fb.callers) {
    const arr = byVia.get(c.viaSymbol);
    if (arr) arr.push(c);
    else byVia.set(c.viaSymbol, [c]);
  }

  const facts = fb.factsByFile ?? {};
  const downstream: DownstreamImpact[] = [];
  for (const [symbol, rows] of byVia) {
    const declFile = declFileByName.get(symbol);
    const ranked = rows
      .filter((c) => c.file !== declFile) // exclude declaring file
      .sort((a, b) => b.rank - a.rank) // highest file-rank first
      .slice(0, CALLER_CAP); // cap 20

    const endpoints = new Set<string>();
    const crons = new Set<string>();
    const mapped: BlastCaller[] = [];
    const seen = new Set<string>();
    for (const c of ranked) {
      const f = facts[c.file];
      if (f) {
        for (const e of f.endpoints) endpoints.add(e);
        for (const x of f.crons) crons.add(x);
      }
      const k = `${c.file}|${c.symbol}|${c.line}`;
      if (seen.has(k)) continue;
      seen.add(k);
      mapped.push({ name: c.symbol, file: c.file, line: c.line });
    }
    if (mapped.length === 0) continue;
    downstream.push({
      symbol,
      callers: mapped,
      endpoints_affected: [...endpoints],
      crons_affected: [...crons],
    });
  }

  return {
    changed_symbols,
    downstream,
    summary: summarizeBlast(changed_symbols, downstream),
  };
}
