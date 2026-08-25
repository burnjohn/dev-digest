/**
 * repo-intel constants. Phase-tagged: [T1] used now; [T2]/[T3]
 * exported early so the pipeline lands against a single source of truth.
 */

// --- Job kinds (registered on JobRunner; enqueued from repos/service.ts) ----
export const INDEX_JOB_KIND = 'repo-intel-index';
export const REFRESH_JOB_KIND = 'repo-intel-refresh';
/** Manual "re-analyze": fetch latest from origin + incremental reindex. */
export const RESYNC_JOB_KIND = 'repo-intel-resync';

// --- Walk / parse scope -----------------------------------------------------
/** [T1] Files we parse (diff-scoped in T1; whole walk in T2). */
export const SUPPORTED_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** [T1] Directories never walked. `.gitignore` is layered on top in T2 walk. */
export const EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
] as const;

// --- Read-time limits -------------------------------------------------------
/**
 * [T1] Caller fan-out cap PER CHANGED SYMBOL — i.e. per (name, declaring
 * file), not per name alone (two changed symbols can share a name across
 * different files). `tryPersistentBlast` (repo-intel/service.ts) applies
 * this by grouping resolved callers on `(viaSymbol, declFile)` and slicing
 * each group, never by slicing the flattened cross-symbol list — the "20
 * caller rows for the whole PR" bug the doc comment here always described
 * but the code, until this fix, did not implement.
 */
export const MAX_CALLERS_PER_SYMBOL = 20;

/**
 * [T1] Global ceiling on TOTAL caller rows `tryPersistentBlast` returns
 * across every changed symbol, applied AFTER the per-symbol cap above via
 * round-robin (`capBlastCallers` in service.ts) so the ceiling can only ever
 * thin every symbol's list a little — never zero one out while another
 * keeps all of its rows, which would silently reproduce the exact bug
 * `MAX_CALLERS_PER_SYMBOL`'s per-group cap was just fixed to avoid, one
 * layer up. Set well above the per-symbol cap (25x) so it only engages for
 * pathological PRs touching dozens of hot symbols — the measured worst case
 * (366 changed symbols on one real PR) stays well under it even if every
 * symbol had callers.
 */
export const MAX_TOTAL_CALLER_ROWS = 500;

/**
 * [T1] Bumped whenever the AST extractor or symbol schema changes. A mismatch
 * with `repo_index_state.indexer_version` forces a full reindex.
 *
 * v2 (T3): graph + decl_file resolution + file_rank + repo-map landed, so every
 * T2 `partial` index must be rebuilt to gain the rank-driven data.
 */
export const INDEXER_VERSION = 2;

// --- [T2] Full-index limits (documented now, enforced in the pipeline) ------
export const MAX_INDEXED_FILES = 5000;
export const MAX_FILE_SIZE = 400 * 1024; // 400 KB
export const MAX_PARSE_MS_PER_FILE = 2000;
/** Soft self-watch budget (< JobRunner hard 120s) → finish as `partial`. */
export const INDEX_SOFT_BUDGET_MS = 110_000;

// --- [T3] Graph / hotness / repo-map ---------------------------------------
export const BFS_DEPTH = 2;
export const HOTNESS_WINDOW_DAYS = 180;
export const DEFAULT_REPO_MAP_TOKEN_BUDGET = 1500;
/** Signatures are trimmed to this many chars in the parse phase (cache stability). */
export const MAX_SIGNATURE_CHARS = 120;
