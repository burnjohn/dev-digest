/* helpers.ts — pure logic for EvalCaseEditor. No JSX, no hooks: every function
   here is a plain data transform so it can be asserted directly in
   helpers.test.ts without mounting a component. */
import type {
  EvalCaseDraft,
  EvalCaseRecord,
  EvalCaseRunResult,
  EvalCaseSource,
  EvalCaseWrite,
  EvalExpectationKind,
  EvalExpectedFinding,
  EvalForbiddenRegion,
  EvalOwnerKind,
  EvalSeededFrom,
} from "@devdigest/shared";
import { AGENT_INPUT_TABS, FINDING_SKELETON } from "./constants";
import type { InputTabConfig } from "./types";

/** Narrows the editor's `initialCase` union: a persisted record always
 * carries `id`; the "Turn into eval case" draft never does. */
export function isEvalCaseRecord(
  value: EvalCaseRecord | EvalCaseDraft | null | undefined,
): value is EvalCaseRecord {
  return !!value && "id" in value;
}

/**
 * REQ-43/44: `expectation_kind` is server-derived and never author-set (no
 * control anywhere may set it directly — see the red flags). The client-side
 * mirror of that derivation, driven by the RAW text so the badge flips the
 * instant the field stops being empty, before the JSON is even valid —
 * `[` alone already reads as `must_find`, which is the point: it tracks
 * intent-to-fill, not JSON validity.
 */
export function deriveExpectationKind(rawExpectedOutput: string): EvalExpectationKind {
  const trimmed = rawExpectedOutput.trim();
  return trimmed === "" || trimmed === "[]" ? "must_not_flag" : "must_find";
}

export type ParsedExpectedOutput =
  | { ok: true; value: EvalExpectedFinding[] }
  | { ok: false };

/** Parses the "Expected output" textarea's raw text into the array the write
 * payload needs. Deliberately loose about SHAPE validation (a finding
 * missing `end_line`, say, is still "valid JSON" for the badge and for
 * submission — the server is the source of truth for REQ-10's field-level
 * rejection) — this only guards against text that isn't even parseable JSON
 * or isn't an array. */
export function safeParseExpectedOutput(raw: string): ParsedExpectedOutput {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { ok: false };
    return { ok: true, value: parsed as EvalExpectedFinding[] };
  } catch {
    return { ok: false };
  }
}

/** `Finding skeleton`: appends one blank finding to whatever the textarea
 * currently holds. Falls back to a fresh one-element array when the current
 * text isn't parseable, so the action always leaves the field valid. */
export function appendFindingSkeleton(raw: string): string {
  const parsed = safeParseExpectedOutput(raw);
  const findings = parsed.ok ? parsed.value : [];
  return JSON.stringify([...findings, FINDING_SKELETON], null, 2);
}

/** The finding a POSITIVE banner's "MUST find "{title}" at {file}:{line}"
 * reads from — the first entry of `expected_output` (AC-48's copy names ONE
 * finding; a case seeded from "Turn into eval case" has exactly one). Returns
 * `undefined` while the textarea holds invalid JSON or an empty array — the
 * banner then falls back to blank interpolation values rather than stale data. */
export function positiveBannerFinding(raw: string): EvalExpectedFinding | undefined {
  const parsed = safeParseExpectedOutput(raw);
  return parsed.ok ? parsed.value[0] : undefined;
}

export interface BuildEvalCaseWriteInput {
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff: string;
  expectedOutput: EvalExpectedFinding[];
  forbiddenRegions: EvalForbiddenRegion[] | null;
  notes?: string | null;
  /** Provenance of a seeded case, carried through Save so a reopened case
   *  still labels its banner POSITIVE/NEGATIVE. Never read by the scorer. */
  seededFrom?: EvalSeededFrom | null;
  /** FIX-2/REQ-56/57/59: a skill-owned case's authored before/after source,
   * built by `skill-helpers.ts`'s `buildSkillInputFiles`. Left `undefined`
   * for an agent-owned save — the built payload then carries no
   * `input_files` key at all, byte-identical to before this fix. */
  inputFiles?: EvalCaseSource | null;
  /** The synthesized filename that goes with `inputFiles`. Same
   * undefined-means-omitted rule as `inputFiles`. */
  filename?: string | null;
}

/** Builds the create/update payload. `eval_cases.input_meta` is never
 * written from the client on either owner kind (it is not even a field of
 * `EvalCaseWrite`). `input_files`/`filename` are set ONLY when the caller
 * passes them (the skill arm) — omitting the keys entirely for the agent arm
 * keeps that payload unchanged from before FIX-2. */
export function buildEvalCaseWrite(input: BuildEvalCaseWriteInput): EvalCaseWrite {
  const payload: EvalCaseWrite = {
    owner_kind: input.ownerKind,
    owner_id: input.ownerId,
    name: input.name.trim(),
    input_diff: input.inputDiff,
    expected_output: input.expectedOutput,
    forbidden_regions: input.forbiddenRegions,
    notes: input.notes ?? null,
    seeded_from: input.seededFrom ?? null,
  };
  if (input.inputFiles !== undefined) payload.input_files = input.inputFiles;
  if (input.filename !== undefined) payload.filename = input.filename;
  return payload;
}

/** REQ-49: the latest run's `actual_output`, pretty-printed, or `null` to
 * mean "never run yet" — the caller renders `t("neverRunYet")` for `null`
 * rather than this module reaching for a translator. */
export function formatActualOutput(run: EvalCaseRunResult | null | undefined): string | null {
  if (!run) return null;
  return JSON.stringify(run.actual_output, null, 2);
}

/** Formats a nullable 0..1 metric as a whole-number percent string, or `"—"`
 * when the metric was never measured (AC-25's `null`, never `0`). */
export function formatMetricPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return String(Math.round(value * 100));
}

/** `duration_ms` → seconds with one decimal, for `resultSummary`'s `{duration}s`. */
export function formatDurationSeconds(durationMs: number | null | undefined): string {
  if (durationMs == null) return "—";
  return (durationMs / 1000).toFixed(1);
}

/** REQ-53/54: the Input tab set for a given owner kind — the ONE place this
 * is decided; `EvalCaseEditor.tsx` calls it once. This wave wires the agent
 * arm only. T20 (wave 5) adds a `skill` branch here (Code/Preview tabs)
 * without touching the render site or any other call site. */
export function getInputTabs(_ownerKind: EvalOwnerKind): InputTabConfig[] {
  return AGENT_INPUT_TABS;
}
