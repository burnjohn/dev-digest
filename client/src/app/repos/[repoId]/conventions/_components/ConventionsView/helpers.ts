import type { ConventionCandidate } from "@devdigest/shared";

/**
 * Rank candidates by confidence, strongest first.
 *
 * This replaces the old fixed-order category grouping, which buried the ranking:
 * ordering was only ever correct *within* a section, so a 30%-confidence `naming`
 * rule still rendered above a 90%-confidence `typing` one. The category is now a
 * chip on the card instead, so nothing is lost.
 *
 * The sort is stable (`Array.prototype.sort` is, per spec), so the server's
 * tie-break between equally-confident rules survives. That tie-break is `id`, not
 * `createdAt` — a whole scan is inserted in one transaction and shares a single
 * `now()`, so `createdAt` separates nothing and the list used to reshuffle every
 * time a row was accepted. Sorting here rather than trusting the response keeps the
 * page correct if the list is ever served from a cache that doesn't guarantee order.
 */
export function sortByConfidence(candidates: ConventionCandidate[]): ConventionCandidate[] {
  return [...candidates].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

/** Rules the user has accepted — the set the merged skill would be built from. */
export function acceptedOf(candidates: ConventionCandidate[]): ConventionCandidate[] {
  return candidates.filter((c) => c.status === "accepted");
}

/**
 * The denominator of "N of M accepted".
 *
 * Rejected rows are excluded: they stay in the response (they are the dedup
 * memory a re-scan needs) but counting them would make the ratio drift down every
 * time the user rejects something, which reads as progress being lost.
 */
export function triageTotal(candidates: ConventionCandidate[]): number {
  return candidates.filter((c) => c.status !== "rejected").length;
}
