/** A4 eval module constants. */

/** Max recent runs returned by the dashboard. */
export const RECENT_RUNS_LIMIT = 10;

/** Regression alert threshold: a metric must drop by more than this (absolute,
 *  0..1) on the latest run before an alert is surfaced. */
export const REGRESSION_THRESHOLD = -0.01;

/** Rounding precision (decimal places) for persisted metric values. */
export const METRIC_ROUND_DP = 3;
