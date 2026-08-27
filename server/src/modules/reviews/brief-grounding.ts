/**
 * PR risk brief grounding — the structural defence against a hostile PR body
 * (server/specs/SPEC-02-pr-risk-brief.md § "The grounded sets", § "Untrusted inputs").
 *
 * A `RiskBriefGeneration` is untrusted model output: every `file` it names is verified
 * against a **grounded path set** harvested from the database — `pr_files` and, when
 * available, the blast response — never from the prompt. Membership is EXACT STRING
 * EQUALITY after trimming surrounding whitespace; never a prefix/suffix/basename/glob
 * match, because "close enough" is exactly the crack an attacker-controlled path walks
 * through. This is the same shape as `groundFindings`
 * (`reviewer-core/src/grounding.ts:56-88`), one step simpler: no line ranges, no
 * full-file-kind exception — every `risks[].file` and `review_focus[].file` is subject
 * to the same test.
 *
 * The six stages below run in a FIXED order, and the order is load-bearing: dedupe runs
 * BEFORE the cap, or a repeated file silently costs a slot that a distinct file could
 * have used (AC-36, AC-14). This file does no I/O and never retries, re-prompts, or
 * repairs a response — a compromised model reply degrades to an empty list, never to a
 * dangerous one (D7).
 */
import type { BlastRadiusResponse, RiskBriefArea, RiskBriefFocusItem, RiskBriefGeneration } from '@devdigest/shared';

const RISK_CAP = 8;
const FOCUS_CAP = 6;

/** Drop / dedupe / cap counts per list — a RETURN VALUE, never a field on the brief (AC-9/REQ-9). */
export interface BriefGroundingCounts {
  risks: {
    /** Entries dropped because `file` failed the grounded-path membership test (AC-6). */
    grounded_dropped: number;
    /** Entries removed by the 8-item cap (AC-14). */
    capped: number;
  };
  review_focus: {
    /** Entries dropped because `file` failed the grounded-path membership test (AC-7). */
    grounded_dropped: number;
    /** Entries removed by first-occurrence-wins dedupe on `file` (AC-36). */
    deduped: number;
    /** Entries removed by the 6-item cap (AC-14). */
    capped: number;
  };
}

export interface GroundedBrief {
  brief: RiskBriefGeneration;
  counts: BriefGroundingCounts;
}

function trimmed(value: string): string {
  return value.trim();
}

/** The grounded path set (§ "The grounded sets", steps 1-2): `pr_files` paths, plus every
 *  file-bearing field of the blast response when it is available. */
function buildGroundedPathSet(prFilePaths: readonly string[], blast: BlastRadiusResponse | undefined): Set<string> {
  const paths = new Set<string>();
  for (const path of prFilePaths) paths.add(trimmed(path));

  if (blast) {
    for (const symbol of blast.symbols) {
      paths.add(trimmed(symbol.file));
      for (const caller of symbol.callers) paths.add(trimmed(caller.file));
      for (const chip of symbol.chips) paths.add(trimmed(chip.file));
    }
    for (const impact of blast.file_impact) {
      paths.add(trimmed(impact.file));
      for (const chip of impact.chips) paths.add(trimmed(chip.file));
    }
  }

  return paths;
}

/** The grounded endpoint set: every `chips[].label` with `kind === 'endpoint'` in the blast
 *  response. Empty when blast is unavailable, so every `endpoint` is nulled (AC-8). */
function buildGroundedEndpointSet(blast: BlastRadiusResponse | undefined): Set<string> {
  const endpoints = new Set<string>();
  if (!blast) return endpoints;

  for (const symbol of blast.symbols) {
    for (const chip of symbol.chips) {
      if (chip.kind === 'endpoint') endpoints.add(trimmed(chip.label));
    }
  }
  for (const impact of blast.file_impact) {
    for (const chip of impact.chips) {
      if (chip.kind === 'endpoint') endpoints.add(trimmed(chip.label));
    }
  }

  return endpoints;
}

/**
 * Ground and normalise a parsed `RiskBriefGeneration`. `prFilePaths` is every
 * `pr_files.path` for this PR; `blast` is the blast response for this PR, or `undefined`
 * when it is unavailable. No I/O, no Drizzle, no container, no LLM — pure R2.
 */
export function groundBrief(
  generation: RiskBriefGeneration,
  prFilePaths: readonly string[],
  blast: BlastRadiusResponse | undefined,
): GroundedBrief {
  const pathSet = buildGroundedPathSet(prFilePaths, blast);
  const endpointSet = buildGroundedEndpointSet(blast);

  // Stage 2 (part 1): drop risks[] entries failing the path test (AC-6).
  // Stage 2 (part 2): null endpoint values failing the endpoint test, never drop the risk (AC-8).
  const groundedRisks: RiskBriefArea[] = [];
  let risksGroundedDropped = 0;
  for (const risk of generation.risks) {
    if (!pathSet.has(trimmed(risk.file))) {
      risksGroundedDropped++;
      continue;
    }
    const endpoint = risk.endpoint !== null && endpointSet.has(trimmed(risk.endpoint)) ? risk.endpoint : null;
    groundedRisks.push({ ...risk, endpoint });
  }

  // Stage 3: drop review_focus[] entries failing the path test (AC-7).
  const groundedFocus: RiskBriefFocusItem[] = [];
  let focusGroundedDropped = 0;
  for (const item of generation.review_focus) {
    if (!pathSet.has(trimmed(item.file))) {
      focusGroundedDropped++;
      continue;
    }
    groundedFocus.push(item);
  }

  // Stage 4: deduplicate review_focus[] by file, first occurrence wins (AC-36) — BEFORE the cap.
  const seenFocusFiles = new Set<string>();
  const dedupedFocus: RiskBriefFocusItem[] = [];
  let focusDeduped = 0;
  for (const item of groundedFocus) {
    const key = trimmed(item.file);
    if (seenFocusFiles.has(key)) {
      focusDeduped++;
      continue;
    }
    seenFocusFiles.add(key);
    dedupedFocus.push(item);
  }

  // Stage 5: truncate to 8 risks / 6 focus items (AC-14) — order preserved, no re-sort.
  const risksCapped = Math.max(0, groundedRisks.length - RISK_CAP);
  const finalRisks = groundedRisks.slice(0, RISK_CAP);

  const focusCapped = Math.max(0, dedupedFocus.length - FOCUS_CAP);
  const finalFocus = dedupedFocus.slice(0, FOCUS_CAP);

  return {
    brief: {
      ...generation,
      risks: finalRisks,
      review_focus: finalFocus,
    },
    counts: {
      risks: { grounded_dropped: risksGroundedDropped, capped: risksCapped },
      review_focus: {
        grounded_dropped: focusGroundedDropped,
        deduped: focusDeduped,
        capped: focusCapped,
      },
    },
  };
}
