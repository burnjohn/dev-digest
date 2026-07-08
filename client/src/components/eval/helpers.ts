/* Shared display helpers for the eval-display components (EvalMetrics,
   TrendChart, BatchHistoryTable, BatchCompare, CompareModal) — promoted to
   `client/src/components/eval/` since both the per-agent Evals tab and the
   cross-agent Eval Dashboard consume them. Kept in one place to avoid the
   fingerprint/model unwrap logic and percentage formatting drifting between
   components (finding #11's dedupe note). */

import { formatCost } from "@/lib/format";

/** The `agent_snapshot` JSONB shape persisted server-side
    (`scoring.ts`'s `AgentSnapshot`): `{ fingerprint, display: { model, ... } }`
    with `fingerprint` at the TOP level, not nested under `display`. */
interface AgentSnapshotShape {
  fingerprint?: unknown;
  display?: { model?: unknown } & Record<string, unknown>;
}

function asSnapshot(snapshot: unknown): AgentSnapshotShape | null {
  if (snapshot && typeof snapshot === "object") return snapshot as AgentSnapshotShape;
  return null;
}

/** Human-readable model name from the agent snapshot, or "—" if absent. */
export function modelLabelFrom(snapshot: unknown): string {
  const snap = asSnapshot(snapshot);
  const model = snap?.display?.model;
  return typeof model === "string" ? model : "—";
}

/** Compact "model @ fingerprint-prefix" label for the Agent Snapshot column /
    tooltip (AC-17/AC-29) — reads the TOP-level `fingerprint`, not
    `display.fingerprint` (which is always undefined and previously made this
    column silently duplicate the Model column, finding #11). */
export function snapshotLabel(snapshot: unknown): string {
  const snap = asSnapshot(snapshot);
  const model = typeof snap?.display?.model === "string" ? (snap.display.model as string) : null;
  const fingerprint = typeof snap?.fingerprint === "string" ? snap.fingerprint : null;

  if (model && fingerprint) return `${model} @ ${fingerprint.slice(0, 12)}`;
  if (fingerprint) return fingerprint.slice(0, 12);
  if (model) return model;
  return "—";
}

/** Short "version"-style token for a batch's agent snapshot — the top-level
    fingerprint prefix (this codebase has no per-batch `vN` counter; the
    fingerprint is the stable identity of the exact config that ran). Falls
    back to the model name, then "—". Used as the compact "Version" column on
    the cross-agent recent-runs feed. */
export function fingerprintLabel(snapshot: unknown, len = 7): string {
  const snap = asSnapshot(snapshot);
  const fingerprint = typeof snap?.fingerprint === "string" ? snap.fingerprint : null;
  if (fingerprint) return fingerprint.slice(0, len);
  const model = typeof snap?.display?.model === "string" ? (snap.display.model as string) : null;
  return model ?? "—";
}

/** Minimal batch shape needed to derive a version ordinal. */
interface VersionableBatch {
  id: string;
  kind: "full" | "calibration";
  ran_at: string;
}

/** Minimal batch shape for prompt-version derivation (adds the snapshot text). */
interface PromptVersionableBatch extends VersionableBatch {
  system_prompt_snapshot: string | null;
}

/** Builds `batchId → prompt version` for an agent's FULL batches. The PROMPT
 *  version increments ONLY when the stored `system_prompt_snapshot` text
 *  actually changes from the previous recorded prompt (chronological). So
 *  repeated runs on an unchanged prompt all share the same `prompt vN` — the
 *  4th run on the original prompt is still `prompt v1`. Batches with no
 *  snapshot (predate tracking) are absent from the map (their prompt version
 *  is unknown, not 0) — the UI renders those as "—". This is the SINGLE
 *  version notion the dashboard uses; there is no separate run/attempt ordinal. */
export function promptVersionMap<T extends PromptVersionableBatch>(batches: T[]): Map<string, number> {
  const chronological = batches
    .filter((b) => b.kind === "full" && b.system_prompt_snapshot != null)
    .sort((a, b) => {
      const t = new Date(a.ran_at).getTime() - new Date(b.ran_at).getTime();
      return t !== 0 ? t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  const map = new Map<string, number>();
  let version = 0;
  let prev: string | null = null;
  for (const b of chronological) {
    const snap = b.system_prompt_snapshot as string;
    if (snap !== prev) version += 1;
    map.set(b.id, version);
    prev = snap;
  }
  return map;
}

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

/** Formats a signed USD cost delta (e.g. 0.01 → "+$0.0100", -0.01 →
 *  "-$0.0100") — same +/- sign convention as `fmtDelta`, but for a currency
 *  value via `formatCost` instead of a percentage. Used by the Compare
 *  modal's "Cost" row (`BatchCompare`'s `showCost` branch). */
export function fmtCostDelta(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${formatCost(v)}`;
}

/** Color for a signed metric delta — positive (improvement) green, negative
    (regression) red, zero neutral. Matches the `CaseRow` status-color
    convention (`var(--ok)` / `var(--crit)` / `var(--text-muted)`). */
export function deltaColor(v: number): string {
  if (v > 0) return "var(--ok)";
  if (v < 0) return "var(--crit)";
  return "var(--text-muted)";
}
