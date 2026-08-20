/* helpers.ts — pure helpers for the PR detail page. */

export const VALID_TABS = ["overview", "findings", "diff"] as const;
export type PrDetailTab = (typeof VALID_TABS)[number];

/** Whitelist the ?tab= query value; anything unknown falls back to overview
    (an unvalidated value used to render a blank content area). */
export function resolveTab(raw: string | null): PrDetailTab {
  return (VALID_TABS as readonly string[]).includes(raw ?? "") ? (raw as PrDetailTab) : "overview";
}

/**
 * True when a previously-live run left the active set — i.e. at least one run
 * settled (done/failed/cancelled). Keys are the primitive `runIds.join(",")`
 * form (same load-bearing shape useRunEvents depends on). This is the
 * server-sourced terminal signal for live runs: SSE transport errors no longer
 * end a run in the UI (EventSource auto-reconnects), so run completion is
 * detected here, from the active-runs poll.
 */
export function didRunsSettle(prevKey: string, nextKey: string): boolean {
  if (!prevKey) return false;
  const next = new Set(nextKey ? nextKey.split(",") : []);
  return prevKey.split(",").some((id) => !next.has(id));
}
