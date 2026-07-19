import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type {
  BlastRadius,
  BlastCaller,
  BlastRelatedPr,
  ChangedSymbol,
  CodeReference,
  CodeSymbol,
  DownstreamImpact,
  RepoRef,
  Severity,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { clampIndexedName } from '../../db/schema/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { extractEndpoints, extractCrons } from '../../adapters/codeindex/extract.js';
import {
  CALLER_CAP,
  INSERT_CHUNK_SIZE,
  NO_FILES_SUMMARY,
  NOT_CLONED_SUMMARY,
  RELATED_PR_CAP,
} from './constants.js';
import { callerName, summarizeBlast } from './helpers.js';
import {
  analyzeCallSite,
  classifyCaller,
  enrichBlast,
  patchAddsThrow,
  patchChangesSignature,
} from './analyze.js';
import type { BlastResult, BlastCallerRow } from '../repo-intel/types.js';

/**
 * Blast-radius service (L04).
 *
 * Builds a `BlastRadius` for a PR by reading the ALREADY-BUILT repo-intel index
 * (built at clone time): changed files → symbols declared there → downstream
 * callers → reachable HTTP endpoints / crons. It makes NO LLM call and does NO
 * parsing during review — a deterministic, fast projection.
 *
 * On top of the raw map it layers reviewer-grade context, all deterministic and
 * model-free: caller roles (business/test/boilerplate), call-site risk (in a
 * loop → perf; unguarded → stability when the change can throw), cross-reference
 * with EXISTING agent findings, dead/unused changed symbols, and prior PRs that
 * touched the same files.
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

    const prFileRows = await db
      .select({ path: t.prFiles.path, patch: t.prFiles.patch })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    const changedFiles = prFileRows.map((r) => r.path);
    // A changed file "may throw" when its diff ADDS a `throw` (a new failure mode).
    const mayThrowByFile = new Map(prFileRows.map((r) => [r.path, patchAddsThrow(r.patch)]));
    // Keep the raw patch per file to detect per-symbol signature (interface) changes.
    const patchByFile = new Map(prFileRows.map((r) => [r.path, r.patch]));

    // Nothing to analyze if the repo isn't cloned or no files are recorded →
    // valid empty result with an explanatory summary (empty state, not blank).
    if (!repo.clonePath || changedFiles.length === 0) {
      return {
        changed_symbols: [],
        downstream: [],
        dead_symbols: [],
        related_prs: [],
        findings_available: false,
        summary: changedFiles.length === 0 ? NO_FILES_SUMMARY : NOT_CLONED_SUMMARY,
      };
    }

    // Facade-first: serve blast from the persistent index (symbols / resolved
    // refs / file_rank / file_facts) with ZERO clone parsing. The ripgrep path
    // is the degraded fallback (flag off, or index not ready yet).
    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    let blast: BlastRadius | null = null;
    if (this.container.config.repoIntelEnabled) {
      const fb = await this.container.repoIntel.getBlastRadius(repo.id, changedFiles);
      if (!fb.degraded) blast = mapFacadeBlast(fb);
    }
    if (!blast) blast = await this.degradedBlast(ref, repo.id, repo.clonePath, changedFiles);

    // --- deterministic reviewer enrichment (no model call) ---
    // (1) the changed code adds a `throw`, and did its signature/interface change?
    for (const d of blast.downstream) {
      d.may_throw = mayThrowByFile.get(d.file) ?? false;
      d.breaking = patchChangesSignature(patchByFile.get(d.file), d.symbol);
    }
    // (2) call-site risk: read each caller's source once and flag loop / unguarded.
    await this.annotateCallSites(blast, repo.clonePath);
    // (3) cross-reference existing agent findings + list prior PRs on these files.
    const { findings, hasReview } = await this.loadFindings(prId);
    const relatedPrs = await this.loadRelatedPrs(pull.repoId, prId, changedFiles);
    return enrichBlast(blast, { findings, hasReview, relatedPrs });
  }

  /** Ripgrep + code-index fallback when the persistent index isn't available. */
  private async degradedBlast(
    ref: RepoRef,
    repoId: string,
    clonePath: string,
    changedFiles: string[],
  ): Promise<BlastRadius> {
    const db = this.container.db;
    const changedSet = new Set(changedFiles);

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

    if (!this.container.config.repoIntelEnabled) await this.persistSymbols(repoId, allSymbols);

    const downstream: DownstreamImpact[] = [];
    for (const sym of changedSymbols) {
      const refs = await this.container.codeIndex.references(ref, sym.name);
      const external = refs.filter((r) => r.fromPath !== sym.file); // exclude the declaring file
      if (external.length === 0) continue;

      if (!this.container.config.repoIntelEnabled) await this.persistReferences(repoId, external);

      const endpoints = new Set<string>();
      const crons = new Set<string>();
      const fileFacts = new Map<string, { hasEndpointOrCron: boolean }>();
      for (const file of new Set(external.map((r) => r.fromPath))) {
        const content = await this.readClone(clonePath, file);
        if (!content) continue;
        const eps = extractEndpoints(content);
        const crs = extractCrons(content);
        for (const e of eps) endpoints.add(e);
        for (const c of crs) crons.add(c);
        fileFacts.set(file, { hasEndpointOrCron: eps.length > 0 || crs.length > 0 });
      }

      const callers: BlastCaller[] = external.slice(0, CALLER_CAP).map((r) => ({
        name: callerName(allSymbols, r),
        file: r.fromPath,
        line: r.line,
        role: classifyCaller(r.fromPath, {
          hasEndpointOrCron: fileFacts.get(r.fromPath)?.hasEndpointOrCron,
        }),
        in_loop: false,
        unguarded: false,
      }));

      downstream.push({
        symbol: sym.name,
        file: sym.file,
        callers,
        endpoints_affected: [...endpoints],
        crons_affected: [...crons],
        finding_severity: null,
        finding_count: 0,
        may_throw: false,
        breaking: false,
      });
    }

    return {
      changed_symbols: changedSymbols,
      downstream,
      dead_symbols: [],
      related_prs: [],
      findings_available: false,
      summary: summarizeBlast(changedSymbols, downstream),
    };
  }

  /** Read each caller's source (once per file) and flag in-loop / unguarded sites. */
  private async annotateCallSites(blast: BlastRadius, clonePath: string): Promise<void> {
    const cache = new Map<string, string[] | null>();
    const readLines = async (file: string): Promise<string[] | null> => {
      const cached = cache.get(file);
      if (cached !== undefined) return cached;
      const content = await this.readClone(clonePath, file);
      const lines = content ? content.split('\n') : null;
      cache.set(file, lines);
      return lines;
    };
    for (const d of blast.downstream) {
      for (const c of d.callers) {
        const lines = await readLines(c.file);
        if (!lines) continue;
        const { inLoop, guarded } = analyzeCallSite(lines, c.line);
        c.in_loop = inLoop;
        c.unguarded = !guarded;
      }
    }
  }

  /** Existing agent findings for a PR (file + severity), and whether any review ran. */
  private async loadFindings(
    prId: string,
  ): Promise<{ findings: { file: string; severity: Severity }[]; hasReview: boolean }> {
    const db = this.container.db;
    const reviewRows = await db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(eq(t.reviews.prId, prId));
    if (reviewRows.length === 0) return { findings: [], hasReview: false };
    const rows = await db
      .select({ file: t.findings.file, severity: t.findings.severity })
      .from(t.findings)
      .where(
        inArray(
          t.findings.reviewId,
          reviewRows.map((r) => r.id),
        ),
      );
    return {
      findings: rows.map((r) => ({ file: r.file, severity: r.severity as Severity })),
      hasReview: true,
    };
  }

  /** Prior PRs (this repo, excluding the current one) touching any changed file. */
  private async loadRelatedPrs(
    repoId: string,
    prId: string,
    changedFiles: string[],
  ): Promise<BlastRelatedPr[]> {
    const db = this.container.db;
    const rows = await db
      .selectDistinct({
        id: t.pullRequests.id,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
      })
      .from(t.prFiles)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.prFiles.prId))
      .where(
        and(
          inArray(t.prFiles.path, changedFiles),
          eq(t.pullRequests.repoId, repoId),
          ne(t.pullRequests.id, prId),
        ),
      )
      .orderBy(desc(t.pullRequests.number))
      .limit(RELATED_PR_CAP);
    return rows;
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
 *   - attribute endpoints/crons from each caller file's precomputed facts;
 *   - classify each caller (business/test/boilerplate) from its facts + rank.
 * Pure. The service adds call-site / findings / related-PR context afterwards.
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
      mapped.push({
        name: c.symbol,
        file: c.file,
        line: c.line,
        role: classifyCaller(c.file, {
          rank: c.rank,
          hasEndpointOrCron: !!f && (f.endpoints.length > 0 || f.crons.length > 0),
        }),
        in_loop: false,
        unguarded: false,
      });
    }
    if (mapped.length === 0) continue;
    downstream.push({
      symbol,
      file: declFile ?? '',
      callers: mapped,
      endpoints_affected: [...endpoints],
      crons_affected: [...crons],
      finding_severity: null,
      finding_count: 0,
      may_throw: false,
      breaking: false,
    });
  }

  return {
    changed_symbols,
    downstream,
    dead_symbols: [],
    related_prs: [],
    findings_available: false,
    summary: summarizeBlast(changed_symbols, downstream),
  };
}
