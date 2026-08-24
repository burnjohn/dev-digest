/* Pure helpers for BlastCard. Nothing here talks to the network or holds
   state, so the component can recompute on every render (see
   client/INSIGHTS.md 2026-08-09 seed). */
import type { BlastChip, BlastRadiusResponse } from "@devdigest/shared";

/**
 * The Tree body renders only the first `SYMBOL_PAGE` rows of `symbols[]` by
 * default — the array itself is uncapped and server-ordered by usefulness
 * (`caller_count` desc -> `chips.length` desc -> `name` asc; see
 * `server/src/modules/blast/helpers.ts`), so bounding it here is purely a
 * render-size decision, never a re-sort. A "Show all N symbols" expander
 * (`BlastCard.tsx`) reveals the rest on demand.
 */
export const SYMBOL_PAGE = 25;

/**
 * Split a symbol's chips into endpoint vs cron groups — the mockup renders
 * endpoint chips first, the cron chip in a visually distinct row below.
 */
export function splitChips(chips: BlastChip[]): { endpoints: BlastChip[]; crons: BlastChip[] } {
  return {
    endpoints: chips.filter((c) => c.kind === "endpoint"),
    crons: chips.filter((c) => c.kind === "cron"),
  };
}

/** A non-`ok` status must show its `status_reason` (REQ-16). */
export function isNonOk(status: BlastRadiusResponse["status"]): boolean {
  return status !== "ok";
}

/**
 * REQ-7/REQ-16, client side: when a coverage flag is `false`, the count strip
 * must show that the figure is unknown rather than render the raw number —
 * an unavailable fact must never look like a real zero.
 */
export function displayCount(available: boolean, value: number): string {
  return available ? String(value) : "—";
}
