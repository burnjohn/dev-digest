/** Constants for the Per-agent Stats tab (A5). */

/** Accept-rate threshold for the "healthy" headline colour. */
export const ACCEPT_GOOD = 0.6;

/** How many trailing trend points are needed to draw a sparkline. */
export const MIN_TREND_POINTS = 1;

/** Outcome rows (label key + token colour). */
export const OUTCOMES = [
  { key: "accepted", color: "var(--ok)" },
  { key: "dismissed", color: "var(--crit)" },
  { key: "pending", color: "var(--text-muted)" },
] as const;

/** Severity bar rows (label key + token colour). */
export const SEVERITY_ROWS = [
  { key: "CRITICAL", labelKey: "severity.critical", color: "var(--crit)" },
  { key: "WARNING", labelKey: "severity.warning", color: "var(--warn)" },
  { key: "SUGGESTION", labelKey: "severity.suggestion", color: "var(--accent)" },
] as const;
