/** Minimum decided findings (accepted + dismissed) an agent needs before it
 *  participates in the accept-rate sort — owner decision (Development Plan
 *  `agent-performance-dashboard.md`, "Confirmed decisions" #2). Agents below
 *  this get a "small sample" badge instead of an arbitrary sort position. */
export const MIN_DECIDED_FOR_ACCEPT_SORT = 5;

export type Period = "1d" | "30d" | "custom";

/** Palette reused for both cost donuts — same family already used by
 *  `StatsTab`'s findings-by-category donut (`var(--crit|warn|accent|ok|
 *  text-muted)`), so this dashboard reads as one system with the per-agent
 *  Stats tab rather than inventing new chart colors. */
export const DONUT_PALETTE = [
  "var(--crit)",
  "var(--warn)",
  "var(--accent)",
  "var(--ok)",
  "var(--text-muted)",
] as const;

export type SortKey = "agent" | "runs" | "avgCost" | "avgDuration" | "acceptRate" | "lastRun";
export type SortDir = "asc" | "desc";
