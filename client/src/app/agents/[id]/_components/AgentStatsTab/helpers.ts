import { ACCEPT_GOOD } from "./constants";

/** Format a 0–1 rate as a whole-percent string, or an em-dash when null. */
export function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** Headline accept-rate colour: ok above the threshold, warn otherwise. */
export function acceptRateColor(rate: number | null): string {
  return rate != null && rate >= ACCEPT_GOOD ? "var(--ok)" : "var(--warn)";
}

/** USD cost to N decimals, or "n/a" placeholder key handled by caller. */
export function formatCost(usd: number | null, digits = 2): string | null {
  return usd == null ? null : `$${usd.toFixed(digits)}`;
}

/** Average latency (ms) as seconds, or null when missing. */
export function formatLatency(ms: number | null): string | null {
  return ms == null ? null : `${(ms / 1000).toFixed(1)}s`;
}

/** Share of a value within a total, as a whole percent. */
export function share(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}
