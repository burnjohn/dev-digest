/**
 * `blast` module constants (docs/plans/06-blast-radius.md).
 */

/**
 * Caller fan-out cap per symbol shown in the Tree (REQ-3). Declared LOCALLY
 * rather than imported from `repo-intel/constants.ts` — `onion-architecture`
 * V6 forbids a module importing another module's `constants.ts` (a
 * cross-module constant becomes a shared kernel constant, not this). The
 * value happens to match repo-intel's own internal
 * `MAX_CALLERS_PER_SYMBOL` (also a display/query cap, coincidentally equal)
 * but the two are independent knobs.
 */
export const MAX_CALLERS_PER_SYMBOL = 20;

/**
 * Reverse-import walk depth bound (REQ-9) — a hard requirement, never widened.
 * Declared LOCALLY rather than imported from `repo-intel/constants.ts`'s
 * `BFS_DEPTH` (also 2, coincidentally) — same V6 reasoning as above; the two
 * are independent knobs. `service.ts` enforces this by construction: it
 * issues exactly two sequential `repository.ts::getReverseEdges` calls and
 * never a third.
 */
export const REVERSE_WALK_MAX_DEPTH = 2;

/**
 * Caps the SQL `IN (...)` list size at EACH level of the reverse-import walk
 * (REQ-9). Without this, a file with a very wide fan-in (many importers)
 * turns `getReverseEdges`'s `inArray` into an effectively-unbounded scan —
 * this is what keeps the query O(bounded degree) rather than O(repo size).
 * Enforced inside `repository.ts::getReverseEdges` itself, not by callers.
 */
export const MAX_REVERSE_WALK_FRONTIER = 200;

/** Cap on `prior_prs[]` (REQ-10) — the mockup's accordion is not a full list view. */
export const MAX_PRIOR_PRS = 10;

/**
 * Caps how many `symbols[]` entries `blast/explain.ts` puts in the narration
 * prompt (T9, D3). `symbols[]` itself carries no cap — a large PR can declare
 * many symbols — so without this the narration call could grow unboundedly
 * and stop being the "one small input-only call" the feature borrows
 * `review_intent`'s cost profile for. NOT a provider/model literal — purely a
 * prompt-size bound, independent of which model `resolveFeatureModel` picks.
 */
export const MAX_NARRATION_SYMBOLS = 15;
