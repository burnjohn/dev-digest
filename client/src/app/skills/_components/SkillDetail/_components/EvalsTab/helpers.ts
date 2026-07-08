/* Shared display helpers for the skill EvalsTab and its sub-components
   (SkillEvalMetrics, SkillEvalBatchHistory, SkillTrendChart, SkillBatchCompare,
   SkillKpiDeltaStrip). Mirrors the agent-eval EvalsTab's `helpers.ts`
   convention — kept in one place so percentage formatting doesn't drift
   between components. */

/** Formats a 0..1 ratio as a rounded percentage string, or "—" when null. */
export function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** Formats a signed delta (e.g. -0.2 → "-20%", 0.1 → "+10%"). */
export function fmtDelta(v: number): string {
  const pctVal = Math.round(v * 100);
  const sign = pctVal > 0 ? "+" : "";
  return `${sign}${pctVal}%`;
}

/** Color for a signed metric delta — positive (improvement) green, negative
    (regression) red, zero neutral. */
export function deltaColor(v: number): string {
  if (v > 0) return "var(--ok)";
  if (v < 0) return "var(--crit)";
  return "var(--text-muted)";
}

/** The `snapshot_identity` JSONB shape persisted server-side
    (`eval-orchestrator.ts`'s `SnapshotIdentity`): `{ skillBody, skillVersion,
    hostAgentModel, hostAgentId }` — used by the trend-chart tooltip (AC-17). */
interface SkillSnapshotShape {
  hostAgentModel?: unknown;
  skillVersion?: unknown;
}

function asSkillSnapshot(snapshot: unknown): SkillSnapshotShape | null {
  if (snapshot && typeof snapshot === "object") return snapshot as SkillSnapshotShape;
  return null;
}

/** Host agent's model at run time, or "—" if absent. */
export function hostAgentModelFromSnapshot(snapshot: unknown): string {
  const snap = asSkillSnapshot(snapshot);
  return typeof snap?.hostAgentModel === "string" ? snap.hostAgentModel : "—";
}

/** Skill version at run time (e.g. "v2"), or "—" if absent. */
export function skillVersionFromSnapshot(snapshot: unknown): string {
  const snap = asSkillSnapshot(snapshot);
  return typeof snap?.skillVersion === "number" ? `v${snap.skillVersion}` : "—";
}
