import type { AgentPerfRow } from "@devdigest/shared";
import { ACCEPT_GOOD, ACCEPT_OK, type SortKey } from "./constants";

/** Sort agent rows by the active key (accept-rate / runs / cost), nulls last. */
export function sortAgents(rows: AgentPerfRow[], sort: SortKey): AgentPerfRow[] {
  const list = [...rows];
  if (sort === "runs") list.sort((a, b) => b.runs - a.runs);
  else if (sort === "cost") list.sort((a, b) => (b.total_cost_usd ?? 0) - (a.total_cost_usd ?? 0));
  else list.sort((a, b) => (b.accept_rate ?? -1) - (a.accept_rate ?? -1));
  return list;
}

/** Map an accept-rate to a severity-style token colour. */
export function acceptRateColor(rate: number): string {
  if (rate >= ACCEPT_GOOD) return "var(--ok)";
  if (rate >= ACCEPT_OK) return "var(--warn)";
  return "var(--crit)";
}
