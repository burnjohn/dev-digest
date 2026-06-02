import { VIEWS, type ViewMode } from "./constants";

/** Coerce a raw `?view=` value to a valid ViewMode (defaults to "columns"). */
export function parseView(raw: string | null): ViewMode {
  return raw === "tabs" ? "tabs" : VIEWS[0];
}

/** Parse a 0-based agent index from `?agent=` (defaults to 0). */
export function parseAgentIndex(raw: string | null): number {
  return Number.parseInt(raw ?? "0", 10) || 0;
}

/** Format a USD cost, or "n/a" when missing. */
export function formatCost(usd: number | null | undefined): string {
  return usd == null ? "n/a" : `$${usd.toFixed(2)}`;
}

/** Seconds-formatted duration. */
export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}
