import type {
  BlastRadiusResponse,
  BlastSymbolImpact,
  BlastCallerRef,
  BlastChip,
  BlastCoverage,
  BlastStatus,
  BlastTotals,
  BlastFileImpact,
  BlastPriorPr,
} from '@devdigest/shared';
import type { BlastResult, IndexState } from '../repo-intel/types.js';
import { MAX_CALLERS_PER_SYMBOL, MAX_PRIOR_PRS } from './constants.js';
import type {
  ChangedFileFactsRow,
  OtherPrMetaRow,
  PrFileOverlapRow,
  ReverseEdgeRow,
} from './types.js';

/**
 * `blast` pure helpers. Row/facade-result -> DTO mapping only — no I/O, no
 * container (`onion-architecture` §5 Drizzle, rule 3; mirrors
 * `modules/repos/helpers.ts` / `modules/lookup/helpers.ts`).
 *
 * Type-only imports from `repo-intel/types.js` are the sanctioned exception:
 * that file is the facade's public port (`platform/container.ts`'s
 * `repoIntel` getter), the seam `docs/plans/06-blast-radius.md` §5 names as
 * the legal cross-module boundary — precedent already set by
 * `modules/conventions/service.ts`. `repo-intel/constants.ts` and
 * `repo-intel/repository.ts` stay off-limits (V6 / D4).
 */

export interface DeriveStatusResult {
  status: BlastStatus;
  statusReason: string;
}

/**
 * REQ-6/REQ-7 status derivation (plan §7 T2 table), driven ONLY by
 * `indexState.status` and `BlastResult.degraded`:
 *
 *   full    + !degraded -> ok
 *   partial + !degraded -> partial
 *   anything else       -> degraded
 *
 * gap G2: `repo-intel`'s ripgrep fallback never computes crons
 * (`extractCrons` is not called on that path), so the degraded branch's
 * reason spells that out — the caller must NOT report `crons: []` as if it
 * were a genuine empty result.
 */
export function deriveStatus(indexState: IndexState, blast: BlastResult): DeriveStatusResult {
  if (indexState.status === 'full' && !blast.degraded) {
    return { status: 'ok', statusReason: '' };
  }
  if (indexState.status === 'partial' && !blast.degraded) {
    return {
      status: 'partial',
      statusReason:
        'The repository index is partial, so some callers or endpoint/cron facts may be incomplete.',
    };
  }
  return {
    status: 'degraded',
    statusReason:
      'The repository index is unavailable, so cron and scheduled-job impact could not be determined; endpoint and caller data shown here is best-effort.',
  };
}

/** Chips from a `file_facts` row declared directly for one file (REQ-5 / gap G1). */
function chipsFromFacts(facts: ChangedFileFactsRow | undefined): BlastChip[] {
  if (!facts) return [];
  const chips: BlastChip[] = [];
  for (const label of facts.endpoints) chips.push({ label, kind: 'endpoint', file: facts.filePath });
  for (const label of facts.crons) chips.push({ label, kind: 'cron', file: facts.filePath });
  return chips;
}

/** Chips attributed to a caller file via `BlastResult.factsByFile` (persistent path only). */
function chipsFromFactsByFile(file: string, factsByFile: BlastResult['factsByFile']): BlastChip[] {
  const f = factsByFile?.[file];
  if (!f) return [];
  const chips: BlastChip[] = [];
  for (const label of f.endpoints) chips.push({ label, kind: 'endpoint', file });
  for (const label of f.crons) chips.push({ label, kind: 'cron', file });
  return chips;
}

function dedupChips(chips: BlastChip[]): BlastChip[] {
  const seen = new Set<string>();
  const out: BlastChip[] = [];
  for (const c of chips) {
    const key = `${c.kind}|${c.label}|${c.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * ONE level of the reverse-import walk, deduped and excluding `exclude`
 * (REQ-9). Pure — `service.ts` calls this between its two sequential
 * `repository.ts::getReverseEdges` calls so the second call's frontier is
 * already deduped/excluded, and `blast-graph.test.ts` drives it directly
 * with fake edge rows, no DB.
 */
export function distinctReverseFiles(edges: ReverseEdgeRow[], exclude: Set<string>): string[] {
  const seen = new Set<string>();
  for (const e of edges) {
    if (!exclude.has(e.fromFile)) seen.add(e.fromFile);
  }
  return [...seen];
}

/**
 * Combines the two already-deduped/excluded walk levels into `file_impact`'s
 * per-file shape (REQ-9/A1) — `depth` is attached here, and each file's
 * `file_facts` chips are attached via `chipsFromFacts`, the SAME merge used
 * for the changed files themselves (REQ-5). Per A1, no `viaSymbol` field is
 * added — `file_impact[]` is per FILE, never per (file, symbol).
 */
export function buildFileImpact(
  level1Files: string[],
  level2Files: string[],
  factsByFile: Map<string, ChangedFileFactsRow>,
): BlastFileImpact[] {
  const toEntry = (file: string, depth: 1 | 2): BlastFileImpact => ({
    file,
    depth,
    chips: chipsFromFacts(factsByFile.get(file)),
  });
  return [...level1Files.map((f) => toEntry(f, 1)), ...level2Files.map((f) => toEntry(f, 2))];
}

/**
 * Groups `pr_files` overlap rows by PR, joins them with the other PRs'
 * metadata, and returns REQ-10's wire shape. `overlap_count` is derived from
 * the grouped path set's size — never a separate `count()` aggregate — so it
 * can never disagree with `overlapping_files`, the list it counts. A PR with
 * no overlapping paths is dropped (this is the "join", done in JS rather than
 * SQL — see `repository.ts`'s header comment for why). Ordered
 * `updated_at DESC, number DESC`: `updated_at` alone cannot break a tie
 * between rows written in the same transaction (`server/INSIGHTS.md`
 * 2026-08-17), and a PR's `number` is its own unique, immutable,
 * monotonically-assigned key, so it is the correct last tiebreaker. Capped at
 * `MAX_PRIOR_PRS`. Pure — `blast-graph.test.ts` drives this directly with
 * fake rows, no DB.
 */
export function buildPriorPrs(
  otherPrs: OtherPrMetaRow[],
  overlapRows: PrFileOverlapRow[],
): BlastPriorPr[] {
  const filesByPr = new Map<string, Set<string>>();
  for (const r of overlapRows) {
    const set = filesByPr.get(r.prId) ?? new Set<string>();
    set.add(r.path);
    filesByPr.set(r.prId, set);
  }

  const rows: BlastPriorPr[] = [];
  for (const pr of otherPrs) {
    const files = filesByPr.get(pr.id);
    if (!files || files.size === 0) continue; // no overlap => not a "prior PR" for this diff
    rows.push({
      number: pr.number,
      title: pr.title,
      status: pr.status,
      overlap_count: files.size,
      overlapping_files: [...files],
      updated_at: pr.updatedAt,
    });
  }

  rows.sort((a, b) => {
    const at = a.updated_at ? Date.parse(a.updated_at) : -Infinity;
    const bt = b.updated_at ? Date.parse(b.updated_at) : -Infinity;
    if (bt !== at) return bt - at;
    return b.number - a.number;
  });
  return rows.slice(0, MAX_PRIOR_PRS);
}

export interface BuildBlastResponseArgs {
  blastResult: BlastResult;
  indexState: IndexState;
  changedFiles: string[];
  /** `file_facts` for the changed files themselves (REQ-5 / gap G1). */
  changedFileFacts: ChangedFileFactsRow[];
  /** REQ-9 — files reached by the bounded reverse-import walk, with their own chips. Defaults to `[]`. */
  fileImpact?: BlastFileImpact[];
  /** REQ-9 — `false` when the repo has no `file_edges` rows at all. Defaults to `false`. */
  importsAvailable?: boolean;
  /** REQ-10 — prior PRs overlapping the changed files. Defaults to `[]`. */
  priorPrs?: BlastPriorPr[];
  /** REQ-10 — `false` when no other PR of the repo has cached `pr_files`. Defaults to `false`. */
  priorPrsAvailable?: boolean;
}

/**
 * Map `repoIntel.getBlastRadius` + `getIndexState` + this module's own
 * changed-file `file_facts` read, plus T5's `file_impact` walk and
 * `prior_prs` join, into the wire contract. `file_impact` / `prior_prs`
 * default to `[]` and their `coverage.*_available` default to `false` when
 * the caller omits them, which keeps this function's own hermetic tests
 * (T2's, pre-T5) valid unchanged. `narrative` is always `null` here (REQ-20 —
 * no LLM is resolved in this module).
 */
export function buildBlastResponse(args: BuildBlastResponseArgs): BlastRadiusResponse {
  const {
    blastResult,
    indexState,
    changedFiles,
    changedFileFacts,
    fileImpact = [],
    importsAvailable = false,
    priorPrs = [],
    priorPrsAvailable = false,
  } = args;
  const { status, statusReason } = deriveStatus(indexState, blastResult);

  const factsByChangedFile = new Map(changedFileFacts.map((f) => [f.filePath, f]));

  const symbols: BlastSymbolImpact[] = blastResult.changedSymbols.map((sym) => {
    // REQ-3: callers of THIS symbol, excluding its own declaring file. Belt
    // and suspenders — BOTH repoIntel data paths (the persistent SQL query
    // and the ripgrep fallback) already exclude a reference in the symbol's
    // own declaring file when building caller rows, but the contract's
    // guarantee is per-symbol, so it is re-asserted here rather than trusted
    // blindly.
    //
    // `c.declFile === sym.file` (not `c.viaSymbol === sym.name` alone) is
    // the attribution fix for D2: two changed symbols can share a `name`
    // across different declaring files, and matching by name only attributed
    // EVERY caller of that name to EVERY same-named symbol, regardless of
    // which one it actually called. `declFile` is optional on
    // `BlastCallerRow` for backward compatibility with hand-built test
    // fixtures written before this field existed — when absent, this falls
    // back to the pre-fix (name-only) match rather than silently dropping
    // every caller for those fixtures.
    const symbolCallers = blastResult.callers.filter(
      (c) =>
        c.viaSymbol === sym.name &&
        c.file !== sym.file &&
        (c.declFile === undefined || c.declFile === sym.file),
    );
    const callerCount = symbolCallers.length; // pre-cap, so the badge stays honest
    const sorted = [...symbolCallers].sort((a, b) => b.rank - a.rank);
    const callers: BlastCallerRef[] = sorted.slice(0, MAX_CALLERS_PER_SYMBOL).map((c) => ({
      file: c.file,
      symbol: c.symbol,
      line: c.line,
      rank: c.rank,
    }));

    const callerFiles = [...new Set(symbolCallers.map((c) => c.file))];
    const chips = dedupChips([
      ...chipsFromFacts(factsByChangedFile.get(sym.file)),
      ...callerFiles.flatMap((f) => chipsFromFactsByFile(f, blastResult.factsByFile)),
    ]);

    return {
      name: sym.name,
      file: sym.file,
      kind: sym.kind,
      callers,
      caller_count: callerCount,
      chips,
    };
  });

  // REQ-2 keeps `symbols[]` uncapped ("every symbol declared in the PR's
  // changed files") but never specified an order, so on a real PR with
  // hundreds of symbols the first useful row could sit anywhere. Sort once,
  // here, by usefulness: most-called symbols first, then symbols with the
  // most chips, then name as a stable tiebreak — mirrors the reasoning
  // already applied to `getAllSymbolNames` in repo-intel/repository.ts ("a
  // truncated read must be a stable prefix rather than an arbitrary slice"),
  // just for a read the CLIENT truncates instead of the server. Sorting here
  // (rather than leaving it to the client) is safe: everything below this
  // point — `totals`, the union-chip dedup — is order-independent over
  // `symbols`.
  symbols.sort((a, b) => {
    if (b.caller_count !== a.caller_count) return b.caller_count - a.caller_count;
    if (b.chips.length !== a.chips.length) return b.chips.length - a.chips.length;
    return a.name.localeCompare(b.name);
  });

  // `totals.endpoints`/`totals.crons` count the UNION of per-symbol chips and
  // `file_impact` chips, de-duplicated by (kind, label) — this is exactly
  // what lets the Tree stay `file_impact`-free (A1) while the count strip
  // still reflects everything the walk found. Per-symbol chips are already
  // deduped by (kind, label, file) above; this union dedup is coarser on
  // purpose, since the same endpoint/cron reached via two different files is
  // still one fact for the count strip.
  const unionChips = [...symbols.flatMap((s) => s.chips), ...fileImpact.flatMap((f) => f.chips)];
  const seenUnionKeys = new Set<string>();
  const dedupedUnionChips = unionChips.filter((c) => {
    const key = `${c.kind}|${c.label}`;
    if (seenUnionKeys.has(key)) return false;
    seenUnionKeys.add(key);
    return true;
  });
  const totals: BlastTotals = {
    symbols: symbols.length,
    callers: symbols.reduce((sum, s) => sum + s.caller_count, 0),
    endpoints: dedupedUnionChips.filter((c) => c.kind === 'endpoint').length,
    crons: dedupedUnionChips.filter((c) => c.kind === 'cron').length,
  };

  // callers/endpoints availability CANNOT be derived from `reason` alone.
  // `repo-intel/service.ts` emits `reason: 'no_data'` from FOUR sites, and
  // only three of them are early exits that attempted nothing: no repo row,
  // no clonePath/no changed files, and `codeIndex.symbols()` throwing — each
  // returns the same empty `BlastResult`. The FOURTH site is the ripgrep
  // fallback's own SUCCESS return (`getBlastRadius`'s final `return { ... }`):
  // it walks `codeIndex.references(...)` for every changed symbol and runs
  // `extractEndpoints` over every caller file, then reports `reason: 'no_data'`
  // regardless of whether that walk found anything — so a response carrying
  // real `changedSymbols`/`callers`/`impactedEndpoints` can arrive with the
  // exact same `reason` as a response that attempted nothing at all.
  //
  // The signal this module can trust is therefore evidence, not the code: an
  // attempt happened whenever `reason !== 'no_data'` (the persistent path, or
  // a fallback that degraded for a DIFFERENT named reason), OR when
  // `reason === 'no_data'` but the result is non-empty — proof the fallback
  // ran and found something. Only `reason === 'no_data'` WITH an empty result
  // means genuinely nothing was attempted; that is the one case allowed to
  // report `false` next to `callers: []` (REQ-8 — never claim a measured zero
  // you cannot back). The ripgrep fallback's `crons` gap (gap G2) is a
  // separate, always-true dimension and stays governed by `status !==
  // 'degraded'` below, independent of this signal (D1).
  const hasBlastData =
    blastResult.changedSymbols.length > 0 ||
    blastResult.callers.length > 0 ||
    blastResult.impactedEndpoints.length > 0;
  const attempted = blastResult.reason !== 'no_data' || hasBlastData;
  const coverage: BlastCoverage = {
    callers_available: attempted,
    endpoints_available: attempted,
    crons_available: status !== 'degraded',
    imports_available: importsAvailable,
    prior_prs_available: priorPrsAvailable,
    files_indexed: indexState.filesIndexed,
    files_skipped: indexState.filesSkipped,
    // No local truncation signal without importing repo-intel's
    // MAX_INDEXED_FILES (onion V6 forbids importing another module's
    // constants.ts) — false is the honest default until a shared signal
    // exists; never claims truncation it cannot prove. Not T5's task to fix.
    index_truncated: false,
  };

  return {
    status,
    status_reason: statusReason,
    coverage,
    changed_file_count: changedFiles.length,
    totals,
    symbols,
    file_impact: fileImpact,
    prior_prs: priorPrs,
    narrative: null,
  };
}
