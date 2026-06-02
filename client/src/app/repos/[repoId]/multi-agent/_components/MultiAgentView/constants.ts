import type { IconName } from "@devdigest/ui";

/** Constants for the Multi-Agent Review view (A5). */

/** Per-column accent palette (the Agent contract has no color field). */
export const PALETTE = ["#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#10b981", "#ec4899", "#14b8a6"] as const;

/** Per-column header icons, indexed alongside PALETTE. */
export const COL_ICONS: IconName[] = ["Shield", "Zap", "Lightbulb", "Users", "Boxes", "Cpu", "Activity"];

/** Severity → token colour + icon for finding mini-cards. */
export const SEV: Record<string, { c: string; icon: IconName }> = {
  CRITICAL: { c: "var(--crit)", icon: "AlertOctagon" },
  WARNING: { c: "var(--warn)", icon: "AlertTriangle" },
  SUGGESTION: { c: "var(--accent)", icon: "Lightbulb" },
};

/** Tabs-view score thresholds → token colour. */
export const SCORE_GOOD = 70;
export const SCORE_OK = 50;

/** Columns-view grid sizing. */
export const MAX_INLINE_COLUMNS = 5;
