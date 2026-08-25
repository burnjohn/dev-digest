/**
 * Every numeric threshold `shaping/**` uses lives HERE and nowhere else
 * (§5.6, T7's own acceptance box) — one constant, one file, so REQ-18's cap
 * is a single edit rather than a grep across the ring.
 */

/** REQ-18: findings are capped at 20 per response. */
export const MAX_FINDINGS = 20;

/** REQ-18: `get_blast_radius` symbols are capped at 20 per response, most-
 *  called first (`shaping/blast.ts`). */
export const MAX_BLAST_SYMBOLS = 20;

/** REQ-18: `get_blast_radius`'s flattened, deduplicated endpoint/cron chip
 *  list is capped at 20 per response (`shaping/blast.ts`). */
export const MAX_BLAST_CHIPS = 20;
