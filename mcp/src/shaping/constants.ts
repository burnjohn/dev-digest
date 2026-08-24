/**
 * Every numeric threshold `shaping/**` uses lives HERE and nowhere else
 * (§5.6, T7's own acceptance box) — one constant, one file, so REQ-18's cap
 * is a single edit rather than a grep across the ring.
 */

/** REQ-18: findings are capped at 20 per response. */
export const MAX_FINDINGS = 20;
