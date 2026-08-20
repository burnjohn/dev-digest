import type { Finding, UnifiedDiff } from '@devdigest/shared';

/** Internal aliases let new core modules depend inward without adding vendor edges. */
export type ReviewFinding = Finding;
export type ReviewDiff = UnifiedDiff;

/**
 * Citation grounding — the mandatory mechanical gate for diff-findings.
 *
 * A diff-finding is kept ONLY if its [start_line, end_line] range intersects a
 * real hunk in the unified diff for the same file. Findings that fail are
 * dropped (the model "hallucinated" a location).
 *
 * EXCEPTION (opt-in only): findings from dedicated full-file scanner stages
 * (hooks / blast / onboarding) are not tied to a diff hunk — they ground
 * against the file existing in the diff. `kind` in {secret_leak,
 * lethal_trifecta, phantom, hook} marks such findings, but the exemption is
 * CALLER-SCOPED via `allowFullFileKinds` and defaults to OFF.
 */

/**
 * Kinds a dedicated full-file scanner stage may emit. The line-check exemption
 * for these is opt-in (`allowFullFileKinds: true`), NOT automatic, because
 * `kind` is model-emitted output: a cheap mapper can mislabel a hallucinated
 * finding as e.g. `secret_leak` and sail through with fabricated line anchors
 * that later anchor an inline GitHub comment (output/to-review.ts).
 *
 * Decision (2026-08-20 hardening): default is `allowFullFileKinds: false`
 * because NO existing legitimate flow relies on the bypass — the general
 * reviewer prompt instructs `kind: "finding"`, the security reviewer prompt
 * requires every finding (lethal_trifecta included) to "cite an exact file and
 * line range that exists in the diff", and no dedicated scanner stage exists
 * yet (HookKind/HookScanResult in @devdigest/shared eval-ci are contract-only).
 * When a real scanner stage lands, it passes `allowFullFileKinds: true` for its
 * own trusted findings; LLM-reviewer paths (review/run.ts) never do.
 */
const FULL_FILE_KINDS = new Set(['secret_leak', 'lethal_trifecta', 'phantom', 'hook']);

export interface GroundingOptions {
  /**
   * Exempt FULL_FILE_KINDS findings from line verification (file presence in
   * the diff still required). Only dedicated full-file scanner stages should
   * pass true; findings parsed from general LLM reviewer output must not.
   */
  allowFullFileKinds?: boolean;
}

export interface GroundingResult {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
}

/** Build a quick lookup of file → set of new-side line numbers covered by hunks. */
export function buildLineIndex(diff: UnifiedDiff): Map<string, Set<number>> {
  const idx = new Map<string, Set<number>>();
  for (const f of diff.files) {
    const set = new Set<number>();
    for (const h of f.hunks) {
      if (h.newLineNumbers && h.newLineNumbers.length > 0) {
        for (const n of h.newLineNumbers) set.add(n);
      } else {
        // fall back to the hunk's declared new range
        for (let n = h.newStart; n < h.newStart + Math.max(h.newLines, 1); n++) set.add(n);
      }
    }
    idx.set(f.path, set);
  }
  return idx;
}

function rangeIntersects(lines: Set<number>, start: number, end: number): boolean {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  // Iterate the diff-bounded line set, never the model-supplied [lo, hi] range:
  // start/end come from unvalidated LLM output, so an astronomically large range
  // must not be able to drive this loop.
  for (const n of lines) if (n >= lo && n <= hi) return true;
  return false;
}

/**
 * Apply the grounding gate to a set of findings against a unified diff.
 * Returns the kept findings and the dropped ones with reasons (for the trace).
 */
export function groundFindings(
  findings: Finding[],
  diff: UnifiedDiff,
  opts: GroundingOptions = {},
): GroundingResult {
  const allowFullFileKinds = opts.allowFullFileKinds ?? false;
  const lineIndex = buildLineIndex(diff);
  const filesInDiff = new Set(diff.files.map((f) => f.path));
  const kept: Finding[] = [];
  const dropped: { finding: Finding; reason: string }[] = [];

  for (const finding of findings) {
    const isFullFile =
      allowFullFileKinds && finding.kind ? FULL_FILE_KINDS.has(finding.kind) : false;

    if (!filesInDiff.has(finding.file)) {
      dropped.push({ finding, reason: `file '${finding.file}' not present in diff` });
      continue;
    }

    if (isFullFile) {
      // full-file scanners only need the file to be in the diff
      kept.push(finding);
      continue;
    }

    const lines = lineIndex.get(finding.file) ?? new Set<number>();
    if (rangeIntersects(lines, finding.start_line, finding.end_line)) {
      kept.push(finding);
    } else {
      dropped.push({
        finding,
        reason: `lines ${finding.start_line}-${finding.end_line} do not intersect any diff hunk in '${finding.file}'`,
      });
    }
  }

  return { kept, dropped };
}

/** Human-readable summary, e.g. "3/3 passed" used in run-trace stats. */
export function groundingSummary(result: GroundingResult): string {
  const total = result.kept.length + result.dropped.length;
  return `${result.kept.length}/${total} passed`;
}
