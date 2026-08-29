/* skill-helpers.ts — pure logic for the SKILL (owner_kind === "skill") arm of
   EvalCaseEditor. Colocated separately from T14's helpers.ts (owned by T14 —
   this task's red flags forbid editing it, constants.ts, types.ts or
   styles.ts at the top level) so skill-mode logic never touches an
   agent-mode file. No JSX, no hooks: every function here is a plain data
   transform, testable directly (skill-helpers.test.ts). */
import type { EvalAblationOutput, EvalCaseRunResult, EvalCaseSource, EvalExpectedFinding } from "@devdigest/shared";
import type { CodeInputValue } from "./_components/CodeInput";
import { safeParseExpectedOutput } from "./helpers";

// ===========================================================================
// REQ-55 — the skill arm's own finding skeleton (no `file` key)
// ===========================================================================

/**
 * REQ-55: mirrors T14's `FINDING_SKELETON` (`constants.ts`) field-for-field,
 * minus `file` — a skill case has exactly ONE synthesized filename for the
 * whole case (`EvalCaseSource.filename`), not one per finding, and the
 * server fills `file` in from that on write (AC-55). Deliberately typed so
 * `file` cannot even be assigned `""` by accident — the omission is the
 * point, not an empty string.
 */
export const SKILL_FINDING_SKELETON: Omit<EvalExpectedFinding, "file"> = {
  severity: "WARNING",
  category: "bug",
  title: "",
  start_line: 1,
  end_line: 1,
};

/**
 * The skill-mode analogue of `appendFindingSkeleton` (`helpers.ts`) — reuses
 * `safeParseExpectedOutput` (import only, never edited) so both functions
 * agree on what "valid JSON" means, and appends `SKILL_FINDING_SKELETON`
 * instead of T14's `file`-carrying one.
 */
export function appendSkillFindingSkeleton(raw: string): string {
  const parsed = safeParseExpectedOutput(raw);
  const findings = parsed.ok ? parsed.value : [];
  return JSON.stringify([...findings, SKILL_FINDING_SKELETON], null, 2);
}

// ===========================================================================
// FIX-2 (REQ-56/57/59) — the skill arm's write payload, built from
// CodeInput's controlled state
// ===========================================================================

/**
 * Turns `CodeInput`'s controlled `value` (lifted into `EvalCaseEditor.tsx` by
 * FIX-2) into the `EvalCaseWrite.input_files` shape the server expects.
 * Mirrors `EvalCaseSource`'s discriminated union field-for-field — `before`
 * is only meaningful, and only sent, for `modified_file`.
 */
export function buildSkillInputFiles(value: CodeInputValue): EvalCaseSource {
  if (value.kind === "modified_file") {
    return { kind: "modified_file", filename: value.filename, before: value.before, after: value.after };
  }
  return { kind: "new_file", filename: value.filename, after: value.after };
}

// ===========================================================================
// REQ-67 — the with/without skill-lift for a case's ablation output
// ===========================================================================

/**
 * REQ-67: `recall(with) - recall(without)`, or `null` when either recall is
 * unmeasured or the without arm never ran / errored. Mirrors the server's
 * `EvalBatchCaseResult.skill_lift` derivation (`eval-batch.ts`) for a single
 * run's `ablation` object. Returning `null` (never `0`) in every unavailable
 * case is deliberate — a naive `(with ?? 0) - (without ?? 0)` would collapse
 * "no data" and "no difference" into the same misleading `0`.
 */
export function computeSkillLift(ablation: EvalAblationOutput | null | undefined): number | null {
  if (!ablation) return null;
  const withRecall = ablation.with.recall;
  if (withRecall == null) return null;
  const without = ablation.without;
  if ("unavailable" in without) return null;
  if (without.recall == null) return null;
  return withRecall - without.recall;
}

/**
 * Formats `computeSkillLift`'s result as a signed whole-number percent —
 * `"+12%"` / `"-8%"` / `"0%"` — or `"—"` (never `"0"`) when unavailable.
 */
export function formatSkillLift(ablation: EvalAblationOutput | null | undefined): string {
  const lift = computeSkillLift(ablation);
  if (lift == null) return "—";
  const pct = Math.round(lift * 100);
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

// ===========================================================================
// The editor's "Actual output" — ONE output block, both arms inside the JSON
// ===========================================================================

export interface ActualOutputView {
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  findingsCount: number;
  /** The whole output, pretty-printed. When the run has both arms this keeps
   * the `{"with": {…}, "without": {…}}` envelope intact — the two arms are
   * SECTIONS of one JSON block, not two panels. */
  json: string;
}

/** Is this the persisted `{with, without}` envelope (AC-64) rather than a
 * plain with-arm-only output? Checked structurally, since `actual_output` is
 * `z.unknown()` on the contract and a run can carry the envelope in that field
 * while `ablation` is null. */
function isAblationEnvelope(value: unknown): value is { with: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "with" in value;
}

/**
 * What the editor's "Actual output" panel renders: ONE output block.
 *
 * The panel used to be two labelled arm panels plus a signed lift row, which
 * made the comparison — not the findings — the first thing the author read.
 * That comparison belongs to the case LIST row and the eval dashboard. So the
 * arms stay in the JSON as `"with"` / `"without"` sections, exactly as the run
 * persisted them, and the panel above them carries ONE summary line, taken
 * from the with arm because that is the run the case actually describes.
 *
 * `json` prefers `actual_output` verbatim (already the envelope for an
 * ablation run, AC-64), falls back to the `ablation` object when the two
 * disagree, and is the plain output for a with-arm-only run (AC-50).
 */
export function actualOutputView(run: EvalCaseRunResult | null | undefined): ActualOutputView | null {
  if (!run) return null;

  const envelope = isAblationEnvelope(run.actual_output);
  // Metrics and the finding tally read the WITH arm — the run that happened.
  const arm: unknown = envelope
    ? (run.actual_output as { with: unknown }).with
    : (run.ablation?.with ?? run.actual_output);
  // The JSON keeps whatever the run carried, envelope and all.
  const whole: unknown = envelope ? run.actual_output : (run.ablation ?? run.actual_output);

  const armRecord = (typeof arm === "object" && arm !== null ? arm : {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const findings = Array.isArray(arm) ? arm : Array.isArray(armRecord.findings) ? armRecord.findings : [];

  return {
    recall: num(armRecord.recall) ?? run.recall,
    precision: num(armRecord.precision) ?? run.precision,
    citationAccuracy: num(armRecord.citation_accuracy) ?? run.citation_accuracy,
    findingsCount: findings.length,
    json: JSON.stringify(whole, null, 2),
  };
}
