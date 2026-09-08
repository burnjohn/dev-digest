import type { EvalCase, EvalCaseEffect, EvalCaseOutcome } from "@devdigest/shared/contracts/knowledge";
import type { EvalLift } from "@devdigest/shared/contracts/eval-ci";

/** AC-35 — a case's origin badge: `source_finding_id` set means it was
 *  derived from a triaged finding; `null` means hand-authored (AC-8). */
export function originByCaseId(cases: EvalCase[] | undefined): Map<string, "finding" | "hand"> {
  const map = new Map<string, "finding" | "hand">();
  for (const c of cases ?? []) map.set(c.id, c.source_finding_id ? "finding" : "hand");
  return map;
}

/** The latest completed run's WITH-arm `per_case` outcomes, keyed by case id
 *  — same shape as the agent tab's `mapOutcomes` (AC-46 held by construction:
 *  a skill run's base fields hold the with-arm's values). */
export function outcomesByCaseId(
  run: { metrics: { per_case: EvalCaseOutcome[] } | null } | null,
): Map<string, EvalCaseOutcome> {
  const map = new Map<string, EvalCaseOutcome>();
  for (const outcome of run?.metrics?.per_case ?? []) map.set(outcome.case_id, outcome);
  return map;
}

/** D5/AC-20/AC-35 — the latest completed run's per-case effect
 *  classification, keyed by case id. Absent entirely for a case this run
 *  never covered (errored-out-of-both-arms, or not part of `case_ids`). */
export function effectByCaseId(
  run: { effects: Array<{ case_id: string; effect: EvalCaseEffect }> } | null,
): Map<string, EvalCaseEffect> {
  const map = new Map<string, EvalCaseEffect>();
  for (const e of run?.effects ?? []) map.set(e.case_id, e.effect);
  return map;
}

/** AC-41 — true only when every metric's lift is present AND exactly zero
 *  (never when a metric's lift is `null`/not-applicable — that is AC-22's
 *  case, not AC-41's). */
export function isAllZeroLift(lift: EvalLift | null | undefined): boolean {
  if (!lift) return false;
  return lift.recall === 0 && lift.precision === 0 && lift.citation_accuracy === 0;
}
