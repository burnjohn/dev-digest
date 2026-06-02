/** Constants for the Eval Dashboard. */

/** Recent-runs table column template. */
export const RUNS_GRID_COLS = "160px 1fr 1fr 1fr 80px 80px";

/** Metric → token colour used across cards, trend lines and mini-bars. */
export const METRIC_COLORS = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
} as const;

/** Max recent runs surfaced in the table (mirrors the server slice). */
export const RECENT_RUNS_LIMIT = 10;
