import type { IconName } from "@devdigest/ui";
import type { Conflict } from "@devdigest/shared/contracts/observability";
import { COL_ICONS, PALETTE, SCORE_GOOD, SCORE_OK } from "./constants";

/** Per-column accent colour by index (wraps the palette). */
export function colorFor(i: number): string {
  return PALETTE[i % PALETTE.length]!;
}

/** Per-column header icon by index (wraps the icon list). */
export function iconFor(i: number): IconName {
  return COL_ICONS[i % COL_ICONS.length]!;
}

/** Map a 0–100 score to a token colour (tabs view tab badge). */
export function scoreColor(score: number): string {
  if (score >= SCORE_GOOD) return "var(--ok)";
  if (score >= SCORE_OK) return "var(--warn)";
  return "var(--crit)";
}

/** Format a duration (ms) as seconds, or an em-dash when missing. */
export function formatDuration(ms: number | null | undefined): string {
  return ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

/** Format a USD cost, or "n/a" when missing. */
export function formatCost(usd: number | null | undefined): string {
  return usd == null ? "n/a" : `$${usd.toFixed(2)}`;
}

/** How many inline columns to render for N agent columns. */
export function columnCount(n: number, maxInline: number): number {
  return n <= 2 ? Math.max(n, 1) : Math.min(n, maxInline);
}

/** A conflict take is "flagged" when its verdict is not "ignored". */
export function isFlagged(verdict: Conflict["takes"][number]["verdict"]): boolean {
  return verdict !== "ignored";
}
