import type { Finding, UnifiedDiff } from '@devdigest/shared';

/**
 * Citation grounding — the mandatory mechanical gate for diff-findings.
 *
 * A diff-finding is kept ONLY if its [start_line, end_line] range intersects a
 * real hunk in the unified diff for the same file. Findings that fail are
 * dropped (the model "hallucinated" a location).
 *
 * EXCEPTION: findings from full-file scanners (hooks / blast / onboarding) are
 * not tied to a diff hunk — they ground against the file existing in the diff
 * (or are exempted entirely). We treat `kind` in {secret_leak, lethal_trifecta,
 * phantom, hook} as full-file: they only require the file to be present.
 */

const FULL_FILE_KINDS = new Set(['secret_leak', 'lethal_trifecta', 'phantom', 'hook']);

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
  for (let n = lo; n <= hi; n++) if (lines.has(n)) return true;
  return false;
}

/**
 * Apply the grounding gate to a set of findings against a unified diff.
 * Returns the kept findings and the dropped ones with reasons (for the trace).
 */
export function groundFindings(findings: Finding[], diff: UnifiedDiff): GroundingResult {
  const lineIndex = buildLineIndex(diff);
  const filesInDiff = new Set(diff.files.map((f) => f.path));
  const kept: Finding[] = [];
  const dropped: { finding: Finding; reason: string }[] = [];

  for (const finding of findings) {
    const isFullFile = finding.kind ? FULL_FILE_KINDS.has(finding.kind) : false;

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

// ---------------------------------------------------------------------------
// Intent Layer — post-grounding scope check.
//
// A GROUNDED finding (real citation, already passed groundFindings) whose file
// matches one of the PR's declared `out_of_scope` areas is handled by
// severity, not dropped uniformly:
//   - non-CRITICAL: dropped, same as any other out-of-scope noise.
//   - CRITICAL: never silently dropped — pulled out of the findings list and
//     folded into a single consolidated `risk_areas` string per affected file,
//     so a real defect outside the PR's stated scope still surfaces, but as a
//     signal rather than a full blocking finding (it should not gate THIS
//     PR's merge the way an in-scope CRITICAL finding does).
// ---------------------------------------------------------------------------

export interface ScopeDemotionResult {
  kept: Finding[];
  /** Short, chip-friendly strings — one per file with a demoted CRITICAL finding. */
  riskAreas: string[];
}

/**
 * Mechanical match between a finding's file and a declared out-of-scope area:
 * case-insensitive substring, either direction. `out_of_scope` entries are
 * free-text (a path, a directory, or a short area description from the
 * classifier) — this is deliberately the same "no model re-judgment at the
 * gate" philosophy as `groundFindings`'s citation check, not a semantic match.
 */
function isOutOfDeclaredScope(file: string, outOfScope: string[]): boolean {
  const f = file.toLowerCase();
  return outOfScope.some((area) => {
    const a = area.toLowerCase().trim();
    return a.length > 0 && (f.includes(a) || a.includes(f));
  });
}

/**
 * Apply the scope-demotion rule to findings that already passed
 * `groundFindings`. `outOfScope` is the PR Intent Layer's declared
 * `out_of_scope` list (see `@devdigest/shared`'s `Intent`); pass `undefined`
 * (no cached intent) or `[]` for a no-op passthrough.
 */
export function applyScopeDemotion(findings: Finding[], outOfScope: string[] | undefined): ScopeDemotionResult {
  if (!outOfScope || outOfScope.length === 0) return { kept: findings, riskAreas: [] };

  const kept: Finding[] = [];
  const demotedByFile = new Map<string, Finding[]>();

  for (const finding of findings) {
    if (!isOutOfDeclaredScope(finding.file, outOfScope)) {
      kept.push(finding);
      continue;
    }
    if (finding.severity !== 'CRITICAL') continue; // out-of-scope, non-critical: dropped
    const list = demotedByFile.get(finding.file) ?? [];
    list.push(finding);
    demotedByFile.set(finding.file, list);
  }

  const riskAreas = [...demotedByFile.entries()].map(([file, demoted]) => {
    const titles = demoted.map((f) => f.title).join('; ');
    return `${file}: ${demoted.length} CRITICAL finding${demoted.length > 1 ? 's' : ''} outside declared scope (${titles})`;
  });

  return { kept, riskAreas };
}
