/** Constants for the Agent Performance view. */

/** Donut/segment colour palette (cost breakdown charts). */
export const PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#64748b",
] as const;

export type SortKey = "accept" | "runs" | "cost";

export const SORT_KEYS: readonly SortKey[] = ["accept", "runs", "cost"];

/** accept-rate thresholds → badge colour. */
export const ACCEPT_GOOD = 0.6;
export const ACCEPT_OK = 0.3;
