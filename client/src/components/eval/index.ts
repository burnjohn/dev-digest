/* components/eval — shared eval-display components used by BOTH the
   per-agent Evals tab (`app/agents/[id]/.../EvalsTab/`) and the cross-agent
   Eval Dashboard (`app/evals/`). Promoted here (neutral location, owned by
   neither page tree) to break the two-way coupling that previously existed
   between those trees — see `docs/plans/2026-07-07-agent-eval-dashboard.md`
   and the follow-up architecture-finding refactor.

   Public surface: components + the shared display helpers/style tokens they
   (and their consumers) depend on. */
export { EvalMetrics } from "./EvalMetrics/EvalMetrics";
export { TrendChart } from "./TrendChart/TrendChart";
export { BatchHistoryTable } from "./BatchHistoryTable/BatchHistoryTable";
export { BatchCompare } from "./BatchCompare/BatchCompare";
export { CompareModal } from "./CompareModal/CompareModal";
export { diffWords } from "./CompareModal/diffWords";
export type { DiffToken, DiffTokenType } from "./CompareModal/diffWords";
export { pct, fmtDelta, fmtCostDelta, deltaColor, modelLabelFrom, snapshotLabel, fingerprintLabel, promptVersionMap } from "./helpers";
export { s as evalStyles, TABLE_ROW_HEIGHT_PX } from "./styles";
