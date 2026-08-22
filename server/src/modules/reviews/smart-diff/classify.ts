import type {
  Severity,
  SmartDiff,
  SmartDiffFile,
  SmartDiffFileFinding,
  SmartDiffGroup,
  SmartDiffRole,
} from '@devdigest/shared';
import {
  ALWAYS_COLLAPSED_ROLES,
  BOILERPLATE_PATTERNS,
  LARGE_FILE_LINES,
  ROLE_ORDER,
  SPLIT_SUGGESTION_LINES,
  WIRING_PATTERNS,
} from './constants.js';

/**
 * The pure heart of Smart Diff (`docs/plans/04-smart-diff.md` §5.2/§5.3).
 * Path-only classification, a total within-group order, the file-level
 * collapse rule, and the newest-wins finding dedup. Imports NOTHING but the
 * R0 contracts and this module's own `constants.ts` — no `drizzle-orm`, no
 * `adapters/`, no LLM provider of any kind (REQ-8).
 */

/** The caller's changed-file shape — a subset of the cached `pr_files` row. */
export interface ClassifiableFile {
  path: string;
  additions: number;
  deletions: number;
  /** `null` when GitHub omitted the patch (too large, or binary). */
  patch: string | null;
}

/** The caller's finding shape — a subset of a joined `findings` + `reviews` row. */
export interface ClassifiableFinding {
  id: string;
  file: string;
  start_line: number;
  end_line: number;
  severity: Severity;
  title: string;
  /** ISO 8601 — the owning review's `created_at`. Used only to break dedup ties. */
  review_created_at: string;
}

/**
 * Boilerplate > Wiring > Core (§5.2). Boilerplate wins first because a
 * generated file that also looks like config should be skimmed, not
 * reviewed. An unmatched path defaults to `core`: wrongly promoting a file
 * costs a few seconds of attention, wrongly demoting one hides it behind a
 * closed diff by default (REQ-3) and it may never be read at all.
 */
export function classifyPath(path: string): SmartDiffRole {
  if (BOILERPLATE_PATTERNS.some((re) => re.test(path))) return 'boilerplate';
  if (WIRING_PATTERNS.some((re) => re.test(path))) return 'wiring';
  return 'core';
}

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

/**
 * Newest-review-wins dedup on `severity|file|start_line|end_line|title`
 * (character-identical to `client/src/components/findings-indicator/index.ts`
 * `findingKey` and the block in `server/src/modules/pulls/routes.ts` — never
 * re-implement this key a third way).
 *
 * Sorts internally (`review_created_at` desc, then `id` desc) before
 * deduping, so the result does not depend on the order the caller passed —
 * `buildSmartDiff` never trusts `reviewsForPull`'s ordering.
 */
function dedupeFindings(findings: readonly ClassifiableFinding[]): ClassifiableFinding[] {
  const sorted = [...findings].sort((a, b) => {
    if (a.review_created_at !== b.review_created_at) {
      return a.review_created_at > b.review_created_at ? -1 : 1;
    }
    return a.id > b.id ? -1 : 1;
  });

  const seen = new Set<string>();
  const winners: ClassifiableFinding[] = [];
  for (const f of sorted) {
    const key = findingDedupKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    winners.push(f);
  }
  return winners;
}

function findingDedupKey(f: ClassifiableFinding): string {
  return `${f.severity}|${f.file}|${f.start_line}|${f.end_line}|${f.title.trim().toLowerCase()}`;
}

/** The highest severity rank present in a file's findings, or 0 if none. */
function highestSeverityRank(findings: readonly SmartDiffFileFinding[]): number {
  let max = 0;
  for (const f of findings) {
    const rank = SEVERITY_RANK[f.severity] ?? 0;
    if (rank > max) max = rank;
  }
  return max;
}

/**
 * Total within-group order (§5.3): has findings desc -> highest severity
 * desc -> finding count desc -> changed_lines desc -> path asc. `path` is
 * unique within a PR, so this key alone makes the order total and the
 * result reproducible byte-for-byte across identical requests (REQ-9).
 */
function compareFiles(a: SmartDiffFile, b: SmartDiffFile): number {
  const aHasFindings = a.findings.length > 0;
  const bHasFindings = b.findings.length > 0;
  if (aHasFindings !== bHasFindings) return aHasFindings ? -1 : 1;

  const aSeverity = highestSeverityRank(a.findings);
  const bSeverity = highestSeverityRank(b.findings);
  if (aSeverity !== bSeverity) return bSeverity - aSeverity;

  if (a.findings.length !== b.findings.length) return b.findings.length - a.findings.length;

  if (a.changed_lines !== b.changed_lines) return b.changed_lines - a.changed_lines;

  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

/**
 * The file-level collapse rule (REQ-3), computed once, here, so the UI never
 * re-derives it: `false` for every ALWAYS_COLLAPSED_ROLES role, findings or
 * no findings; otherwise `true` iff the file has at least one finding.
 */
function defaultOpenFor(role: SmartDiffRole, findingCount: number): boolean {
  if (ALWAYS_COLLAPSED_ROLES.includes(role)) return false;
  return findingCount > 0;
}

/**
 * Builds the full Smart Diff response from the PR's changed files and the
 * PR's findings across every review run. Zero LLM calls, zero I/O — REQ-8.
 */
export function buildSmartDiff(
  files: readonly ClassifiableFile[],
  findings: readonly ClassifiableFinding[],
): SmartDiff {
  const changedPaths = new Set(files.map((f) => f.path));
  const dedupedFindings = dedupeFindings(findings);

  let unmatchedFindingCount = 0;
  const findingsByPath = new Map<string, ClassifiableFinding[]>();
  for (const f of dedupedFindings) {
    if (!changedPaths.has(f.file)) {
      unmatchedFindingCount += 1;
      continue;
    }
    let list = findingsByPath.get(f.file);
    if (!list) findingsByPath.set(f.file, (list = []));
    list.push(f);
  }

  const filesByRole = new Map<SmartDiffRole, SmartDiffFile[]>(ROLE_ORDER.map((role) => [role, []]));

  let totalLines = 0;

  for (const file of files) {
    const role = classifyPath(file.path);
    const changedLines = file.additions + file.deletions;
    totalLines += changedLines;

    const fileFindings = findingsByPath.get(file.path) ?? [];
    const wireFindings: SmartDiffFileFinding[] = fileFindings.map((f) => ({
      id: f.id,
      line: f.start_line,
      severity: f.severity,
    }));
    const findingLines = [...new Set(wireFindings.map((f) => f.line))].sort((a, b) => a - b);

    const smartDiffFile: SmartDiffFile = {
      path: file.path,
      // pseudocode_summary intentionally omitted — nothing constructs it (REQ-27).
      additions: file.additions,
      deletions: file.deletions,
      changed_lines: changedLines,
      large: changedLines > LARGE_FILE_LINES,
      has_patch: file.patch !== null,
      default_open: defaultOpenFor(role, wireFindings.length),
      findings: wireFindings,
      finding_lines: findingLines,
    };

    filesByRole.get(role)!.push(smartDiffFile);
  }

  const groups: SmartDiffGroup[] = ROLE_ORDER.map((role) => {
    const roleFiles = [...filesByRole.get(role)!].sort(compareFiles);
    return { role, file_count: roleFiles.length, files: roleFiles };
  });

  return {
    groups,
    total_files: files.length,
    total_lines: totalLines,
    unmatched_finding_count: unmatchedFindingCount,
    split_suggestion: {
      too_big: totalLines > SPLIT_SUGGESTION_LINES,
      total_lines: totalLines,
      proposed_splits: [], // always [] — §11 D12
    },
  };
}
