/**
 * Source gathering for the PR Risk Brief (server/specs/SPEC-02-pr-risk-brief.md
 * §"Non-functional requirements" / §"Prompt assembly order").
 *
 * Mirrors the `intent-sources.ts` / `intent-classifier.ts` split: this file
 * gathers and budgets every input, `brief-generator.ts` owns the system
 * prompt and the one structured call.
 *
 * REQ-19 boundary — structural, not a discipline: `pr_files.patch` is read
 * ONLY for its `@@ -x,y +z,w @@` hunk-header lines via `extractHunkHeaders`.
 * A hunk BODY (the `+`/`-`/` ` lines under a header) is never concatenated,
 * sliced, summarised or sampled into a prompt section.
 *
 * Every scalar source gets its own character budget (§"Non-functional
 * requirements"), with one exception: `.md` excerpts draw from a single
 * aggregate budget (`MD_AGGREGATE_BUDGET`) shared across every `.md` path in
 * `pr_files`, so an early file cannot starve a later one of its whole slice —
 * the path-safety gate runs first and unconditionally, before any budget is
 * spent. `sources` (`RiskBriefSources`) is a REPORT derived from what actually
 * reached the assembled prompt (REQ-44) — never a constant. Two rules
 * override the general derivation and are easy to get backwards:
 *   - REQ-16 — an absent `pr_intent` row is `"unavailable"`, NOT `"missing"`.
 *   - REQ-42 — no issue reference at all is `"missing"` and makes NO
 *     `getIssue` call; a referenced issue whose fetch fails is `"unavailable"`
 *     (REQ-39) and never blocks generation.
 *
 * SSRF / path-traversal boundary: every `.md` path in `pr_files` is a real,
 * repository-relative path already recorded by `pr_files` — but the same
 * `isSafeRepoMdPath` gate `intent-sources.ts` applies to body-derived
 * references is applied here too, unconditionally, before any
 * `GitClient.readFile` call. A rejected path costs zero budget and is never
 * fetched.
 */
import type {
  BlastRadiusResponse,
  GitClient,
  GitHubClient,
  PrIntentDetail,
  RepoRef,
  RiskBriefSourceStatus,
  RiskBriefSources,
} from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import { isSafeRepoMdPath, linkedIssueRefs, truncateMarkdown, truncatePlain } from './intent-sources.js';

// ---- Deps this file needs — mirrors `IntentSourceDeps` exactly ----
export interface BriefSourceDeps {
  git: GitClient;
  /** Lazy resolver — mirrors `Container.github()`; never a resolved client. */
  github: () => Promise<GitHubClient>;
}

/** The minimal PR shape source-gathering needs. */
export interface BriefSourcePull {
  title: string;
  body: string | null | undefined;
}

/** The minimal `pr_files` row shape (`db/schema/pulls.ts:38-51`) this file
 *  needs — deliberately NOT `UnifiedDiff['files']`: `renderFileList` in
 *  `intent-sources.ts` takes a diff-hunk shape (`hunks: DiffHunk[]`) that
 *  does not fit a `pr_files` row (`patch: string | null`), so this file
 *  renders its own changed-file section locally instead of widening that
 *  function's signature. */
export interface BriefPrFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

// ---- Per-source character budgets (SPEC-02 §"Non-functional requirements") ----
const TITLE_BUDGET = 500;
const PR_BODY_BUDGET = 4000;
const LINKED_ISSUE_BUDGET = 2000;
const FILE_LIST_MAX_CHARS = 8000;
const FILE_LIST_MAX_FILES = 200;
const BLAST_BUDGET = 6000;
const INTENT_BUDGET = 1500;
const MD_FILE_BUDGET = 1500;
/** Aggregate budget shared across every `.md` path in `pr_files`. */
const MD_AGGREGATE_BUDGET = 12_000;
/** Below this much remaining budget a `.md` path is `skipped` without a
 *  read — a sub-1,000 slice would be almost entirely the truncation marker. */
const MD_MIN_SLICE = 1000;
/** Documented per SPEC-02's total-assembled cap. NOT actively enforced by
 *  summing the per-source budgets above (which sum to more than this in the
 *  worst case, same as `intent-sources.ts`'s `PLAN_SPEC_TOTAL_BUDGET` vs its
 *  siblings) — it exists so the number lives in code, not only in prose. */
const TOTAL_ASSEMBLED_BUDGET = 32_000;

export interface GatherBriefSourcesInput {
  repoRef: RepoRef;
  pull: BriefSourcePull;
  /** Every `pr_files` row for this PR, in changed-file order. */
  prFiles: BriefPrFile[];
  /** The `pr_intent` row, already read directly from the table by the
   *  caller — NEVER computed here. `null` means no row exists (REQ-16). */
  intent: PrIntentDetail | null;
  /** Lazy — absent or throwing both record `sources.blast = "unavailable"`
   *  (REQ-17); a `degraded`/`partial` response is used and recorded
   *  `"partial"`. */
  blast?: () => Promise<BlastRadiusResponse>;
}

export interface GatheredBriefSources {
  /** Ready-to-join, already delimiter-wrapped prompt sections, in the fixed
   *  order SPEC-02's "Prompt assembly order" defines; an absent/empty source
   *  contributes no section. */
  promptSections: string[];
  sources: RiskBriefSources;
  /**
   * Per-source character counts, captured at the SAME point each source's
   * status is decided above — never approximated later by re-measuring
   * `promptSections` (a `missing`/`skipped`/`unavailable` source emits no
   * prompt section at all, so that approximation silently omitted exactly
   * the sources a reader most needs a count for). Keyed on the same field
   * names as `RiskBriefSources` so the two line up; every source reports an
   * explicit `0` rather than being absent when it contributed nothing
   * (server/INSIGHTS.md, 2026-08-17 — a silent fail-open hides a feature
   * that never ran; an absent key here would read the same way).
   * `md_files` reports ONE COUNT PER PATH, mirroring `sources.md_files`'s
   * own per-path shape — an aggregate would hide which path in a
   * many-`.md`-file PR actually consumed the shared budget.
   */
  charCounts: {
    intent: number;
    blast: number;
    pr_body: number;
    linked_issue: number;
    file_list: number;
    md_files: { path: string; chars: number }[];
  };
}

/**
 * Extracts `@@ -x,y +z,w @@` hunk-HEADER lines from a `pr_files.patch` value
 * — and nothing else. Splits on `/\r?\n/`, never `'\n'` (server/INSIGHTS.md,
 * 2026-08-17 — `.` does not match `\r`, so a bare `split('\n')` silently
 * breaks on CRLF text).
 */
function extractHunkHeaders(patch: string | null | undefined): string[] {
  if (!patch) return [];
  return patch.split(/\r?\n/).filter((line) => line.trimStart().startsWith('@@'));
}

/**
 * Local changed-file renderer over `pr_files` rows (see `BriefPrFile`'s
 * header comment for why this is not `intent-sources.ts`'s `renderFileList`).
 * `path (+additions/-deletions)` per file, then that file's hunk-header
 * lines only — REQ-19.
 */
function renderChangedFiles(
  files: BriefPrFile[],
): { text: string; status: RiskBriefSourceStatus; chars: number } {
  if (files.length === 0) {
    return { text: '', status: 'missing', chars: 0 };
  }
  const capped = files.slice(0, FILE_LIST_MAX_FILES);
  const lines: string[] = [];
  for (const f of capped) {
    lines.push(`${f.path} (+${f.additions}/-${f.deletions})`);
    for (const header of extractHunkHeaders(f.patch)) {
      lines.push(`  ${header}`);
    }
  }
  const full = lines.join('\n');
  const overFileCap = files.length > capped.length;
  if (full.length <= FILE_LIST_MAX_CHARS && !overFileCap) {
    return { text: full, status: 'used', chars: full.length };
  }
  const cut = truncatePlain(full, FILE_LIST_MAX_CHARS);
  return { text: cut.text, status: 'truncated', chars: cut.chars };
}

/**
 * Blast-radius summary text — symbol names, declaring files, caller COUNTS,
 * and endpoint/cron labels only. Deliberately never lists individual callers
 * (so no caller line number can reach the prompt, even though
 * `BlastCallerRef.line` exists on the wire shape).
 */
function renderBlastSummary(blast: BlastRadiusResponse): string {
  const lines: string[] = [];
  for (const sym of blast.symbols) {
    lines.push(`${sym.name} (${sym.file}) — ${sym.caller_count} caller(s)`);
    for (const chip of sym.chips) {
      lines.push(`  ${chip.kind}: ${chip.label} (${chip.file})`);
    }
  }
  for (const fi of blast.file_impact) {
    lines.push(`${fi.file} (depth ${fi.depth})`);
    for (const chip of fi.chips) {
      lines.push(`  ${chip.kind}: ${chip.label} (${chip.file})`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : '(no impacted symbols found)';
}

/**
 * Gather every input the risk-brief generator is allowed to read, honestly
 * recording what happened to each (REQ-44). Never throws by itself — every
 * fetch here is already `try`/`catch`ed; an unresolvable source is recorded,
 * never fabricated, and assembly proceeds without it.
 */
export async function gatherBriefSources(
  deps: BriefSourceDeps,
  input: GatherBriefSourcesInput,
): Promise<GatheredBriefSources> {
  const { repoRef, pull, prFiles, intent, blast } = input;
  const sections: string[] = [];

  // ---- pr_title (own budget, no tracked status — RiskBriefSources has none) ----
  const titleCut = truncatePlain(pull.title, TITLE_BUDGET);
  const titleText = pull.title.length > TITLE_BUDGET ? titleCut.text : pull.title;
  sections.push(`## PR title\n${wrapUntrusted('pr-title', titleText)}`);

  // ---- pr_body ----
  const body = pull.body ?? '';
  let prBodyStatus: RiskBriefSourceStatus;
  let prBodyChars = 0;
  if (!body) {
    prBodyStatus = 'missing';
  } else {
    const cut = truncateMarkdown(body, PR_BODY_BUDGET);
    sections.push(`## PR description\n${wrapUntrusted('pr-body', cut.text)}`);
    prBodyStatus = cut.truncated ? 'truncated' : 'used';
    prBodyChars = cut.chars;
  }

  // ---- linked_issue (REQ-42 / REQ-39) ----
  const issueNumbers = linkedIssueRefs(body);
  let linkedIssueStatus: RiskBriefSourceStatus;
  let linkedIssueChars = 0;
  if (issueNumbers.length === 0) {
    // No reference at all: "missing", and NO getIssue call is made (REQ-42).
    linkedIssueStatus = 'missing';
  } else {
    const issueNumber = issueNumbers[0]!; // guarded by the length check above
    try {
      const github = await deps.github();
      const issue = await github.getIssue(repoRef, issueNumber);
      const issueText = `#${issue.number} ${issue.title}\n\n${issue.body ?? ''}`;
      const cut = truncateMarkdown(issueText, LINKED_ISSUE_BUDGET);
      sections.push(`## Linked issue\n${wrapUntrusted('linked-issue', cut.text)}`);
      linkedIssueStatus = cut.truncated ? 'truncated' : 'used';
      linkedIssueChars = cut.chars;
    } catch {
      // A referenced issue that failed, timed out, or could not be attempted
      // (no token configured) — REQ-39. Never fabricated; never blocks
      // generation.
      linkedIssueStatus = 'unavailable';
    }
  }

  // ---- intent (REQ-16 — read from the row, never computed) ----
  let intentStatus: RiskBriefSourceStatus;
  let intentChars = 0;
  if (!intent) {
    intentStatus = 'unavailable';
  } else {
    const intentText = [
      intent.intent,
      intent.in_scope.length > 0 ? `In scope: ${intent.in_scope.join(', ')}` : '',
      intent.out_of_scope.length > 0 ? `Out of scope: ${intent.out_of_scope.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const cut = truncateMarkdown(intentText, INTENT_BUDGET);
    sections.push(`## Declared intent\n${wrapUntrusted('intent', cut.text)}`);
    intentStatus = cut.truncated ? 'truncated' : 'used';
    intentChars = cut.chars;
  }

  // ---- file_list — paths, add/delete counts and hunk HEADERS only (REQ-19) ----
  const fileList = renderChangedFiles(prFiles);
  if (fileList.status !== 'missing') {
    sections.push(`## Changed files\n${wrapUntrusted('file-list', fileList.text)}`);
  }
  const fileListStatus = fileList.status;
  const fileListChars = fileList.chars;

  // ---- blast (REQ-17) ----
  let blastStatus: RiskBriefSourceStatus;
  let blastChars = 0;
  if (!blast) {
    blastStatus = 'unavailable';
  } else {
    try {
      const data = await blast();
      const summary = renderBlastSummary(data);
      const cut = truncateMarkdown(summary, BLAST_BUDGET);
      sections.push(`## Blast radius\n${wrapUntrusted('blast', cut.text)}`);
      blastStatus = data.status === 'ok' ? (cut.truncated ? 'truncated' : 'used') : 'partial';
      blastChars = cut.chars;
    } catch {
      blastStatus = 'unavailable';
    }
  }

  // ---- .md excerpts (REQ-24 / REQ-45) ----
  // Every `.md` path in `pr_files` gets exactly one `md_files[]` entry,
  // whether or not it was read (REQ-45), spent in changed-file order.
  const mdPaths = prFiles.filter((f) => f.path.toLowerCase().endsWith('.md'));
  const mdFiles: RiskBriefSources['md_files'] = [];
  const mdCharCounts: { path: string; chars: number }[] = [];
  let mdRemaining = MD_AGGREGATE_BUDGET;
  let mdIndex = 0;
  for (const f of mdPaths) {
    if (!isSafeRepoMdPath(f.path)) {
      // Fails the path-safety gate — NO fetch attempted, zero budget spent.
      mdFiles.push({ path: f.path, status: 'unavailable' });
      mdCharCounts.push({ path: f.path, chars: 0 });
      continue;
    }
    if (mdRemaining < MD_MIN_SLICE) {
      // Budget exhausted: deliberately not read (REQ-45). `skipped`, never
      // `unavailable` — that would claim we tried and failed.
      mdFiles.push({ path: f.path, status: 'skipped' });
      mdCharCounts.push({ path: f.path, chars: 0 });
      continue;
    }
    try {
      const text = await deps.git.readFile(repoRef, f.path);
      const cut = truncateMarkdown(text, Math.min(MD_FILE_BUDGET, mdRemaining));
      mdRemaining -= cut.chars;
      sections.push(`## Documentation changed by this PR: ${f.path}\n${wrapUntrusted(`md-${mdIndex}`, cut.text)}`);
      mdFiles.push({ path: f.path, status: cut.truncated ? 'truncated' : 'used' });
      mdCharCounts.push({ path: f.path, chars: cut.chars });
      mdIndex++;
    } catch {
      // git.readFile THROWS for a missing/unreadable file — only the mock
      // returns '' (server/INSIGHTS.md, 2026-08-17). Never substitute '', a
      // base-branch version, or invented content (REQ-24).
      mdFiles.push({ path: f.path, status: 'unavailable' });
      mdCharCounts.push({ path: f.path, chars: 0 });
    }
  }

  const sources: RiskBriefSources = {
    intent: intentStatus,
    blast: blastStatus,
    pr_body: prBodyStatus,
    linked_issue: linkedIssueStatus,
    file_list: fileListStatus,
    md_files: mdFiles,
  };

  return {
    promptSections: sections,
    sources,
    charCounts: {
      intent: intentChars,
      blast: blastChars,
      pr_body: prBodyChars,
      linked_issue: linkedIssueChars,
      file_list: fileListChars,
      md_files: mdCharCounts,
    },
  };
}
