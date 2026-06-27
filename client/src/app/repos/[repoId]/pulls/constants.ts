import type { PrMeta } from "../../../../lib/types";

/** Constants for the PR list page (/repos/:repoId/pulls). */

/**
 * Review status → colour token + i18n label key (under `list.status`). Open PRs
 * carry a derived review status (needs_review / reviewed / stale); merged/closed
 * keep their GitHub merge state.
 */
export const STATUS_META: Record<string, { c: string; labelKey: string }> = {
  needs_review: { c: "var(--warn)", labelKey: "needs_review" },
  reviewed: { c: "var(--ok)", labelKey: "reviewed" },
  stale: { c: "var(--stale)", labelKey: "stale" },
  open: { c: "var(--warn)", labelKey: "open" },
  merged: { c: "var(--ok)", labelKey: "merged" },
  closed: { c: "var(--stale)", labelKey: "closed" },
};

/** Size bucket → colour token. */
export const SIZE_COLOR: Record<string, string> = {
  S: "var(--ok)",
  M: "var(--warn)",
  L: "var(--crit)",
};

/** Grid template for both the header row and PR rows. */
export const GRID = "1fr 132px 92px 60px 120px 118px 80px 78px";

/** Line-count thresholds for the S/M/L size bucket. */
export const SIZE_SMALL_MAX = 100;
export const SIZE_MEDIUM_MAX = 400;

/** Filter chips: status key + i18n label key (under `list.filter`). */
export const STATUS_FILTERS: { key: string; labelKey: string }[] = [
  { key: "all", labelKey: "all" },
  { key: "needs_review", labelKey: "needs_review" },
  { key: "reviewed", labelKey: "reviewed" },
  { key: "stale", labelKey: "stale" },
];

/** Column header i18n keys (under `list.columns`), in display order. */
export const COLUMN_KEYS: string[] = [
  "pullRequest",
  "author",
  "size",
  "score",
  "findings",
  "status",
  "cost",
  "updated",
];

/** Number of skeleton rows shown while loading. */
export const SKELETON_ROWS = 4;

export type PrSize = "S" | "M" | "L";
export type SizeInfo = { size: PrSize; lines: number };

/** Re-exported for helpers that consume PrMeta. */
export type { PrMeta };
