/* _lib/format.ts — pure formatting helpers for the Eval Dashboard route.
   No component here reads a metric/delta/timestamp off a server payload
   without going through one of these — REQ-32/REQ-71 need every `null` (no
   preceding batch, or a metric absent on either side) to render "—" and NEVER
   a signed zero, so the null check lives in exactly one place per shape
   rather than being re-derived at each call site. */
import { formatCost as formatUsd } from "@/lib/format";

/** `recall`/`precision`/`citation_accuracy` are fractions in [0, 1]
    (server: AC-21 `TP / (TP + FN)`) — never already a percentage. */
export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

/** A delta between two fractions, in signed percentage points. A real
    zero-point delta (both batches measured, no change) still renders "0%" —
    only a `null` input (no preceding batch, or either side unmeasured, AC-71)
    renders "—". */
export function formatSignedPercentDelta(value: number | null): string {
  if (value === null) return "—";
  const points = Math.round(value * 100);
  return points > 0 ? `+${points}%` : `${points}%`;
}

/**
 * Delegates to the client-wide `formatCost` rather than rounding to two
 * decimals of its own.
 *
 * An eval batch costs a fraction of a cent — a 5-case gold set on
 * `deepseek-v4-flash` lands around `$0.001` — so `toFixed(2)` rendered EVERY
 * run as `$0.00`, which reads as "free/unmeasured" and makes two runs an
 * order of magnitude apart look identical. The shared formatter keeps four
 * decimals, trims trailing zeros and holds a two-decimal floor, so
 * `0.00072 -> $0.0007` and `0.0036 -> $0.0036` while a real `0` still renders
 * `$0.00`. It is what the PR list, run timeline and trace drawer already use;
 * this route's own two-decimal version was the outlier, not the convention.
 */
export function formatCost(value: number | null): string {
  return formatUsd(value);
}

/** Same precision as `formatCost` above — a delta between two sub-cent batches
    is exactly where two decimals collapsed every change to `$0.00`. */
export function formatSignedCost(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatUsd(Math.abs(value))}`;
}

export function formatPassRatio(passed: number, total: number): string {
  return `${passed}/${total}`;
}

/** `YYYY-MM-DD HH:mm`, read off the timestamp's UTC components directly
    rather than `toLocaleString()` — deterministic across machines/timezones
    (and across SSR vs. CSR, unlike `client/INSIGHTS.md` 2026-08-17's
    mount-gated pattern, which this sidesteps rather than needing). */
export function formatBatchTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}
