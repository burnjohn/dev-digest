/**
 * eval/scoring.ts — deterministic, zero-I/O, zero-LLM-call scoring for eval
 * batches (L06).
 *
 * HARD RULE (AC-23): this file must never import `container`, `db`, any
 * adapter, or `LLMProvider`. Every export here is a pure function: same
 * input always produces the same output, no side effects, no network.
 *
 * Severity/kind fields on `Expectation` are display metadata ONLY (AC-24) —
 * they are never read anywhere in the matching/scoring logic below.
 */
import { createHash } from 'node:crypto';
import type { Expectation } from '@devdigest/shared';

/** Minimal shape of a finding this module needs to score against expectations. */
export interface FindingLike {
  file: string;
  startLine: number;
  endLine: number;
}

/** Per-case scoring result — the raw counts a batch aggregates over. */
export interface CaseScoreResult {
  mustFindMatched: number;
  mustFindTotal: number;
  mustNotFlagViolations: number;
  findingsCount: number;
}

/**
 * True when `finding` satisfies `expectation`: same file AND overlapping
 * line ranges (AC-19). Overlap (not exact match) is intentional — a finding
 * that spans into or past the expected range still counts as covering it.
 */
export function matchesExpectation(finding: FindingLike, expectation: Expectation): boolean {
  if (finding.file !== expectation.file) return false;
  return finding.startLine <= expectation.line_end && finding.endLine >= expectation.line_start;
}

/**
 * Scores a single eval case: for each `must_find` expectation, matched if
 * ANY kept finding matches it; for each `must_not_flag` expectation, any
 * kept finding matching it counts as a violation.
 *
 * `mustNotFlagViolations` is counted PER KEPT FINDING, not per expectation
 * (N1 fix): a finding is marked as violating at most once even if it
 * overlaps multiple `must_not_flag` zones, so the count can never exceed
 * `findingsCount` — symmetric with how `mustFindMatched` is capped at
 * `mustFindTotal`. Counting per-expectation allowed `violations > findingsCount`
 * (e.g. one finding inside two guarded zones), which drove precision below 0.
 *
 * An empty `expectations` array (AC-9's "clean diff" case) falls out of the
 * general loop naturally — zero iterations, all-zero counts, no special
 * branch required.
 */
export function scoreCase(expectations: Expectation[], keptFindings: FindingLike[]): CaseScoreResult {
  let mustFindMatched = 0;
  let mustFindTotal = 0;

  const mustNotFlagExpectations = expectations.filter((e) => e.type === 'must_not_flag');
  const mustFindExpectations = expectations.filter((e) => e.type === 'must_find');

  for (const expectation of mustFindExpectations) {
    mustFindTotal += 1;
    const matched = keptFindings.some((finding) => matchesExpectation(finding, expectation));
    if (matched) mustFindMatched += 1;
  }

  // Each kept finding contributes at most ONE violation, no matter how many
  // must_not_flag zones it overlaps.
  const mustNotFlagViolations = keptFindings.filter((finding) =>
    mustNotFlagExpectations.some((expectation) => matchesExpectation(finding, expectation)),
  ).length;

  return {
    mustFindMatched,
    mustFindTotal,
    mustNotFlagViolations,
    findingsCount: keptFindings.length,
  };
}

/**
 * Aggregate recall across every scored case in a batch (AC-20):
 * sum(mustFindMatched) / sum(mustFindTotal).
 *
 * Zero-denominator convention: when no case in the batch carries a
 * `must_find` expectation (e.g. a `must_not_flag`-only batch), recall is
 * defined as vacuously satisfied (1) rather than NaN/0 — there was nothing
 * to find, so nothing was missed. The spec does not pin this convention
 * beyond "does not divide by zero at the batch level"; `1` was chosen to
 * mirror `computeCitationAccuracy`'s and `aggregatePrecision`'s identical
 * "nothing to hold against it" zero-denominator convention below.
 */
export function aggregateRecall(caseResults: CaseScoreResult[]): number {
  let totalMatched = 0;
  let totalExpected = 0;
  for (const result of caseResults) {
    totalMatched += result.mustFindMatched;
    totalExpected += result.mustFindTotal;
  }
  if (totalExpected === 0) return 1;
  return totalMatched / totalExpected;
}

/**
 * Aggregate precision across every scored case in a batch (AC-21):
 * (sum(findingsCount) - sum(mustNotFlagViolations)) / sum(findingsCount).
 *
 * Zero-denominator convention: when no findings were produced across the
 * whole batch, precision is vacuously satisfied (1) — there were no false
 * positives because there were no positives at all.
 */
export function aggregatePrecision(caseResults: CaseScoreResult[]): number {
  let totalFindings = 0;
  let totalViolations = 0;
  for (const result of caseResults) {
    totalFindings += result.findingsCount;
    totalViolations += result.mustNotFlagViolations;
  }
  if (totalFindings === 0) return 1;
  // Clamp to >= 0 (N1): mustNotFlagViolations is now capped per-case at
  // findingsCount by scoreCase, so totalViolations should never exceed
  // totalFindings in practice — this clamp is defense-in-depth against the
  // same underflow at the aggregate level.
  return Math.max(0, (totalFindings - totalViolations) / totalFindings);
}

/**
 * Citation accuracy for a single case's grounding outcome (AC-22):
 * keptCount / (keptCount + droppedCount).
 *
 * Zero-denominator convention: no findings proposed at all (kept or
 * dropped) is vacuously satisfied (1) — there was nothing to cite badly.
 */
export function computeCitationAccuracy(keptCount: number, droppedCount: number): number {
  const total = keptCount + droppedCount;
  if (total === 0) return 1;
  return keptCount / total;
}

/** Raw kept/dropped counts for one case's grounding outcome — the inputs
 *  `aggregateCitationAccuracy` pools across a batch (AC-22). */
export interface CitationCounts {
  keptCount: number;
  droppedCount: number;
}

/**
 * Batch-level citation accuracy, POOLED per AC-22: sum(kept) /
 * sum(kept + dropped) across every scored case — NOT an average of each
 * case's own ratio. Averaging per-case ratios weights a case with 1 finding
 * the same as a case with 100, which the spec's worked example (1.0 & 0.5
 * → pooled ≈0.545, not the naive average 0.75) explicitly rejects.
 *
 * Zero-denominator convention: no findings proposed at all across the batch
 * is vacuously satisfied (1), mirroring `computeCitationAccuracy`.
 */
export function aggregateCitationAccuracy(counts: CitationCounts[]): number {
  let totalKept = 0;
  let totalDropped = 0;
  for (const c of counts) {
    totalKept += c.keptCount;
    totalDropped += c.droppedCount;
  }
  const total = totalKept + totalDropped;
  if (total === 0) return 1;
  return totalKept / total;
}

/**
 * A case "passes" when every `must_find` expectation was matched AND zero
 * `must_not_flag` violations occurred.
 */
export function casePassed(result: CaseScoreResult): boolean {
  return result.mustFindMatched === result.mustFindTotal && result.mustNotFlagViolations === 0;
}

/** Input used to derive an agent's identity fingerprint for a batch run. */
export interface AgentSnapshotInput {
  systemPrompt: string;
  skills: string[];
  model: string;
  provider: string;
}

/** Deterministic identity fingerprint + a human-readable display object. */
export interface AgentSnapshot {
  fingerprint: string;
  display: unknown;
}

/**
 * Computes a deterministic fingerprint for an agent's configuration at run
 * time (AC-17). The fingerprint must change if the system prompt, the
 * enabled-skills list (order matters — reordering skills changes prompt
 * assembly output), the model, or the provider changes — never from the
 * prompt alone.
 *
 * NOTE: `agent.strategy` is intentionally EXCLUDED from this fingerprint —
 * AC-17 itself omits it (a faithfully-implemented spec gap, not an
 * oversight); do not add it without a spec update.
 *
 * `createHash('sha256')` (precedent: conventions/extractor.ts) replaces a
 * hand-rolled 32-bit multiply-31 rolling hash — the old hash had no
 * collision resistance beyond the `-{length}` suffix and overpromised
 * "any change → different fingerprint" in its doc comment.
 */
export function computeAgentSnapshot(input: AgentSnapshotInput): AgentSnapshot {
  const stable = JSON.stringify({
    systemPrompt: input.systemPrompt,
    skills: input.skills,
    model: input.model,
    provider: input.provider,
  });

  const fingerprint = createHash('sha256').update(stable).digest('hex');

  return {
    fingerprint,
    display: {
      model: input.model,
      provider: input.provider,
      skills: input.skills,
      promptLength: input.systemPrompt.length,
      promptExcerpt: input.systemPrompt.slice(0, 200),
    },
  };
}

/**
 * True when the last (up to) 3 full-batch outcomes for a case contain both
 * a pass and a fail-or-error — i.e. the case's status flipped (AC-27).
 * Fewer than 2 data points can never flip, so it's never flaked.
 */
export function computeFlakedStatus(lastThreeOutcomes: ('passed' | 'failed' | 'error')[]): boolean {
  if (lastThreeOutcomes.length < 2) return false;
  const hasPass = lastThreeOutcomes.includes('passed');
  const hasFailure = lastThreeOutcomes.some((outcome) => outcome === 'failed' || outcome === 'error');
  return hasPass && hasFailure;
}
