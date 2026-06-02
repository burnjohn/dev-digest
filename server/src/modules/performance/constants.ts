/** Constants for the agent-performance module. */

/** Number of most-recent runs included in the per-agent trend sparkline. */
export const TREND_WINDOW = 12;

/** Severity buckets reported per agent (display order). */
export const SEVERITY_KEYS = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;

/** Run status that counts toward cost/latency/findings aggregates. */
export const DONE_STATUS = 'done';
