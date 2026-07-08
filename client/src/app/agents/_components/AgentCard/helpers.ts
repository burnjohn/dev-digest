import { MODEL_COLOR, ACCEPT_OK_THRESHOLD } from "./constants";

/** Resolve the chip colour for an agent's model (unknown → secondary token). */
export function modelColor(model: string): string {
  return MODEL_COLOR[model] ?? "var(--text-secondary)";
}

/** Accept-rate colour: green at/above the healthy threshold, amber below. */
export function acceptColor(pct: number): string {
  return pct >= ACCEPT_OK_THRESHOLD ? "var(--ok)" : "var(--warn)";
}

/** Format a USD cost as `$0.04` (2 dp). */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
