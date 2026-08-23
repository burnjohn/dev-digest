/**
 * Source gathering for PR intent classification (plan 03-intent-layer.md §5.1).
 *
 * REQ-3 boundary — structural, not a discipline: this file reads ONLY
 * `pull.title`, `pull.body`, `IssueMeta.{title,body}`, `GitClient.readFile`
 * text, and `diff.files[].{path,additions,deletions,hunks[].{oldStart,oldLines,
 * newStart,newLines}}`. `UnifiedDiff.raw` and `PrFile.patch` are never read —
 * the `UnifiedDiff.files[]` shape has no field that could carry a hunk body,
 * so there is no code path through which one could reach the prompt.
 *
 * Every source gets its OWN character budget (never a shared pool), with one
 * exception: `plan_or_spec` references draw from a single aggregate budget
 * (`PLAN_SPEC_TOTAL_BUDGET`) shared across all of them, so an early
 * unreachable/unsafe reference cannot starve a later readable one — the
 * safety gate runs first and unconditionally, before any budget is spent.
 * Every source also gets an honest `IntentSourceStatus` — see
 * `contracts/intent.ts`'s file header for what each of the five statuses
 * means. `used` means read in full; a
 * heading-aware cut (never first-N-bytes) is what lets a `truncated` source
 * still carry the document's real headings past the cut point.
 *
 * SSRF boundary (ledger D12a): only two plan/spec reference forms are ever
 * fetched — a repo-relative `.md` path via the existing clone, or a
 * `github.com/<owner>/<name>/blob/<ref>/<path>` URL whose owner/name match
 * THIS repo. Everything else, and anything failing the path-safety check
 * (`..` segments, absolute paths, drive letters, non-`.md` extensions), is
 * rejected BEFORE it ever reaches `GitClient.readFile` and is recorded
 * `unreachable` — never fabricated, never silently fetched.
 */
import type { GitClient, GitHubClient, IntentSource, RepoRef, UnifiedDiff } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';

// ---- Deps this file needs (a subset of IntentClassifierDeps) ----
export interface IntentSourceDeps {
  git: GitClient;
  /** Lazy resolver — mirrors `Container.github()`; never a resolved client. */
  github: () => Promise<GitHubClient>;
}

/** The minimal PR shape source-gathering needs — deliberately NOT `PullRow`,
 *  so this module carries no dependency on the DB row shape. */
export interface IntentSourcePull {
  title: string;
  body: string | null | undefined;
}

// ---- Per-source character budgets (plan §5.1 — fixed here, not invented) ----
const PR_BODY_BUDGET = 4000;
const LINKED_ISSUE_BUDGET = 2000;
const PLAN_SPEC_BUDGET = 6000;
/** Aggregate budget shared across every `plan_or_spec` reference (3 ×
 *  `PLAN_SPEC_BUDGET`, deliberately more than the old cap-of-two's 12,000
 *  worst case, so no PR that classified well before classifies worse now). */
const PLAN_SPEC_TOTAL_BUDGET = 18_000;
/** Below this much remaining budget a reference is `skipped` without a read
 *  — a sub-1,000 slice is almost entirely the truncation marker. */
const PLAN_SPEC_MIN_SLICE = 1_000;
const FILE_LIST_MAX_FILES = 200;
const FILE_LIST_MAX_CHARS = 8000;

const TRUNCATION_MARKER = '[… truncated …]';
const HEADING_RE = /^#{1,6}\s/;
const LINES_AFTER_HEADING = 3;

/**
 * Heading-aware truncation for markdown text (plan §5.1 / ledger D11). Walks
 * the WHOLE document keeping every ATX heading line plus a few lines beneath
 * it, until the budget is spent, then appends an explicit truncation marker —
 * never a first-N-bytes cut, so a heading that lives past the cut point in the
 * original text can still appear in the included text. Falls back to a plain
 * head cut when the document has no headings at all (the "non-markdown" case
 * from §5.1), which is still recorded `truncated`, never `used`.
 *
 * Splits on `/\r?\n/`, never `'\n'` (server/INSIGHTS.md, 2026-08-17 — `.` does
 * not match `\r`, so a bare `split('\n')` silently breaks on CRLF text).
 */
export function truncateMarkdown(
  text: string,
  budget: number,
): { text: string; truncated: boolean; chars: number } {
  if (text.length <= budget) {
    return { text, truncated: false, chars: text.length };
  }
  const markerBudget = Math.max(0, budget - TRUNCATION_MARKER.length - 1);
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const headingLine = lines[i] ?? '';
    if (!HEADING_RE.test(headingLine)) continue;
    const chunk = [headingLine];
    for (let k = 1; k <= LINES_AFTER_HEADING && i + k < lines.length; k++) {
      const nextLine = lines[i + k] ?? '';
      if (HEADING_RE.test(nextLine)) break;
      chunk.push(nextLine);
    }
    const chunkText = chunk.join('\n');
    const addLen = chunkText.length + (kept.length > 0 ? 1 : 0);
    if (used + addLen > markerBudget) break;
    kept.push(chunkText);
    used += addLen;
  }
  const bodyText = kept.length > 0 ? kept.join('\n') : text.slice(0, markerBudget);
  const result = `${bodyText}\n${TRUNCATION_MARKER}`;
  return { text: result, truncated: true, chars: result.length };
}

/**
 * Plain head cut for non-markdown / structureless text (the file-list block).
 * Always recorded `truncated`, never `used`.
 */
function truncatePlain(text: string, budget: number): { text: string; chars: number } {
  const markerBudget = Math.max(0, budget - TRUNCATION_MARKER.length - 1);
  const result = `${text.slice(0, markerBudget)}\n${TRUNCATION_MARKER}`;
  return { text: result, chars: result.length };
}

/**
 * Issue references in a PR body — mirrors the (private) regex in
 * `adapters/github/octokit.ts#resolveLinkedIssue` so the same "closes #123"
 * convention is honoured. Pure: no I/O. Returns every distinct issue number
 * referenced, in order of first appearance; callers use only the first (the
 * plan's data model has ONE `linked_issue` source).
 */
export function linkedIssueRefs(body: string | null | undefined): number[] {
  if (!body) return [];
  const re = /(?:closes|fixes|resolves)?\s*#(\d+)/gi;
  const seen = new Set<number>();
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    // Group 1 (`\d+`) is mandatory whenever the whole match succeeds.
    const n = Number(m[1]!);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export interface PlanSpecRef {
  /** Display string recorded as `IntentSource.ref` — the raw markdown path or
   *  the full blob URL, exactly as it appeared in the body. */
  ref: string;
  /** Repo-relative path to read via `GitClient.readFile`, or `null` when the
   *  reference is not repo-relative (an off-repo blob URL, an external URL,
   *  an absolute path, a traversal, or anything else outside the accepted
   *  shape) — in which case it is recorded `unreachable` with NO fetch
   *  attempted. */
  path: string | null;
}

const GH_BLOB_RE = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/([^/\s]+)\/([^\s)>\]]+\.md)/gi;
/** Broad `.md`-token scan (2b) — every `.md`-ending token in the body,
 *  bounded by whitespace/bracket/quote delimiters. Deliberately does NOT
 *  require a leading word character, so `../evil.md`, `/etc/passwd.md` and
 *  bare external URLs (`https://evil.com/plan.md`) are captured too, instead
 *  of silently producing no source record at all. Whether a captured token
 *  is actually repo-relative is decided separately by `REPO_RELATIVE_MD_RE`.
 *  For the accepted repo-relative form, the extracted text and match
 *  position are unchanged from the previous narrower regex. */
const MD_TOKEN_RE = /(?:^|[\s(['"`<])([^\s()[\]{}'"`<>]+\.md)(?=$|[\s)\].,;:!?'"`>])/gm;
/** The accepted repo-relative shape — same character class as the old
 *  `BARE_MD_RE` capture group. A token that fails this test is real (it was
 *  referenced) but not fetchable as a repo path, so it is recorded
 *  `unreachable` rather than silently dropped. */
const REPO_RELATIVE_MD_RE = /^[\w][\w./-]*\.md$/;

/**
 * Plan/spec references in a PR body (ledger D12a): a repo-relative markdown
 * path, or a `github.com/<owner>/<name>/blob/<ref>/<path>` URL. Pure: no I/O,
 * no path-safety check (that happens in `gatherIntentSources`, right before
 * the read) — this only extracts candidates and decides, from `repoRef`
 * alone, whether a blob URL is IN this repo. Order of first appearance is
 * preserved. Every `.md` reference in the body is recorded — including one
 * that is not repo-relative (`path: null`) — so the caller can honestly
 * report `unreachable` instead of silently omitting it (2b); the caller
 * applies no count limit, only the aggregate character budget in
 * `gatherIntentSources`.
 */
export function planSpecRefs(body: string | null | undefined, repoRef: RepoRef): PlanSpecRef[] {
  if (!body) return [];

  const matches: { index: number; ref: string; path: string | null }[] = [];
  const urlSpans: [number, number][] = [];

  let m: RegExpExecArray | null;
  GH_BLOB_RE.lastIndex = 0;
  while ((m = GH_BLOB_RE.exec(body))) {
    // Groups 1/2/4 (owner/name/path) are mandatory whenever the match succeeds.
    const full = m[0];
    const owner = m[1]!;
    const name = m[2]!;
    const filePath = m[4]!;
    urlSpans.push([m.index, m.index + full.length]);
    const sameRepo =
      owner.toLowerCase() === repoRef.owner.toLowerCase() &&
      name.toLowerCase() === repoRef.name.toLowerCase();
    matches.push({ index: m.index, ref: full, path: sameRepo ? filePath : null });
  }

  // Mask matched URL spans so the token scan never re-matches inside a URL.
  let masked = body;
  for (const [start, end] of urlSpans) {
    masked = masked.slice(0, start) + ' '.repeat(end - start) + masked.slice(end);
  }

  MD_TOKEN_RE.lastIndex = 0;
  while ((m = MD_TOKEN_RE.exec(masked))) {
    const token = m[1]!; // group 1 is mandatory whenever the match succeeds
    const path = REPO_RELATIVE_MD_RE.test(token) ? token : null;
    matches.push({ index: m.index, ref: token, path });
  }

  matches.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  const out: PlanSpecRef[] = [];
  for (const cand of matches) {
    const key = cand.path ?? cand.ref;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ref: cand.ref, path: cand.path });
  }
  return out;
}

/**
 * Path-safety gate — the SSRF/path-traversal boundary from §5.1, applied
 * BEFORE anything reaches `GitClient.readFile`. Rejects `..` segments,
 * absolute paths, drive letters, and anything not ending in `.md`.
 */
function isSafeRepoMdPath(path: string): boolean {
  if (!path.toLowerCase().endsWith('.md')) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  const segments = path.split(/[\\/]/);
  if (segments.some((s) => s === '..' || s === '')) return false;
  return true;
}

/**
 * Inline plan/spec material (ledger D12b): when the PR body is itself long
 * and markdown-structured, the confidence clamp and the intent card should
 * count it as documentation even though it arrived inline, not by reference.
 * No heuristic judges whether the prose "is really a plan" — this only
 * records what was structurally there (length + heading/list shape).
 */
function isLongMarkdownBody(body: string): boolean {
  if (body.length < 1200) return false;
  const lines = body.split(/\r?\n/);
  let headings = 0;
  let listItems = 0;
  for (const line of lines) {
    if (HEADING_RE.test(line)) headings++;
    else if (/^\s*(?:[-*+]|\d+\.)\s/.test(line)) listItems++;
  }
  return headings >= 2 || (headings >= 1 && listItems >= 1);
}

function renderFileList(files: UnifiedDiff['files']): { text: string; status: IntentSource['status']; chars: number } {
  if (files.length === 0) {
    return { text: '', status: 'missing', chars: 0 };
  }
  const capped = files.slice(0, FILE_LIST_MAX_FILES);
  const lines: string[] = [];
  for (const f of capped) {
    lines.push(`${f.path} (+${f.additions}/-${f.deletions})`);
    for (const h of f.hunks) {
      lines.push(`  @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
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

export interface GatheredIntentSources {
  /** Ready-to-join, already delimiter-wrapped prompt sections, in a fixed
   *  order; empty/absent sources contribute no section. */
  promptSections: string[];
  /** The full server-observed audit list — never something the model reports. */
  sources: IntentSource[];
}

/**
 * Gather every input the intent classifier is allowed to read, honestly
 * recording what happened to each (plan §5.1). Every fetch is best-effort:
 * this function itself never throws (REQ-7) — an unreachable source is
 * recorded, never fabricated, and classification proceeds without it.
 */
export async function gatherIntentSources(
  deps: IntentSourceDeps,
  repoRef: RepoRef,
  pull: IntentSourcePull,
  diff: UnifiedDiff,
): Promise<GatheredIntentSources> {
  const sections: string[] = [];
  const sources: IntentSource[] = [];

  // ---- pr_title (no budget — titles are short) ----
  sections.push(`## PR title\n${wrapUntrusted('pr-title', pull.title)}`);
  sources.push({ kind: 'pr_title', ref: 'title', status: 'used', chars: pull.title.length });

  // ---- pr_body ----
  const body = pull.body ?? '';
  if (!body) {
    sources.push({ kind: 'pr_body', ref: 'body', status: 'missing', chars: 0 });
  } else {
    const cut = truncateMarkdown(body, PR_BODY_BUDGET);
    sections.push(`## PR description\n${wrapUntrusted('pr-body', cut.text)}`);
    sources.push({
      kind: 'pr_body',
      ref: 'body',
      status: cut.truncated ? 'truncated' : 'used',
      chars: cut.chars,
    });

    // Inline plan/spec (D12b) — audit-only, adds no text (the body is already above).
    if (isLongMarkdownBody(body)) {
      sources.push({
        kind: 'plan_or_spec',
        ref: 'inline (PR body)',
        status: cut.truncated ? 'truncated' : 'used',
        chars: cut.chars,
      });
    }
  }

  // ---- linked_issue ----
  const issueNumbers = linkedIssueRefs(body);
  if (issueNumbers.length === 0) {
    sources.push({ kind: 'linked_issue', ref: 'none', status: 'missing', chars: 0 });
  } else {
    const issueNumber = issueNumbers[0]!; // guarded by the length check above
    try {
      const github = await deps.github();
      const issue = await github.getIssue(repoRef, issueNumber);
      const issueText = `#${issue.number} ${issue.title}\n\n${issue.body ?? ''}`;
      const cut = truncateMarkdown(issueText, LINKED_ISSUE_BUDGET);
      sections.push(`## Linked issue\n${wrapUntrusted('linked-issue', cut.text)}`);
      sources.push({
        kind: 'linked_issue',
        ref: `#${issueNumber}`,
        status: cut.truncated ? 'truncated' : 'used',
        chars: cut.chars,
      });
    } catch {
      // git.readFile-style ENOENT / GitHub 404 / network failure — never fabricated.
      sources.push({ kind: 'linked_issue', ref: `#${issueNumber}`, status: 'unreachable', chars: 0 });
    }
  }

  // ---- plan_or_spec (by reference; aggregate character budget, §5.1 / D12a / D12c) ----
  // No count limit: the safety gate runs first and unconditionally, so an
  // unreachable/unsafe reference (however many appear first) can never
  // starve a later readable one of its slice of PLAN_SPEC_TOTAL_BUDGET.
  const refs = planSpecRefs(body, repoRef);
  let planSpecRemaining = PLAN_SPEC_TOTAL_BUDGET;
  let planSpecIndex = 0;
  for (const cand of refs) {
    if (!cand.path || !isSafeRepoMdPath(cand.path)) {
      // Not repo-relative, or fails the path-safety gate — NO fetch
      // attempted, and ZERO budget consumed.
      sources.push({ kind: 'plan_or_spec', ref: cand.ref, status: 'unreachable', chars: 0 });
      continue;
    }
    if (planSpecRemaining < PLAN_SPEC_MIN_SLICE) {
      // Budget exhausted: deliberately not read. `skipped`, never
      // `unreachable` (D12c) — recording it as unreachable would claim we
      // tried and failed. A sub-1,000 slice would be almost entirely the
      // truncation marker and would poison the confidence clamp with a
      // bogus `truncated`.
      sources.push({ kind: 'plan_or_spec', ref: cand.ref, status: 'skipped', chars: 0 });
      continue;
    }
    try {
      const text = await deps.git.readFile(repoRef, cand.path);
      const cut = truncateMarkdown(text, Math.min(PLAN_SPEC_BUDGET, planSpecRemaining));
      planSpecRemaining -= cut.chars;
      sections.push(
        `## Referenced document: ${cand.ref}\n${wrapUntrusted(`plan-spec-${planSpecIndex}`, cut.text)}`,
      );
      sources.push({
        kind: 'plan_or_spec',
        ref: cand.ref,
        status: cut.truncated ? 'truncated' : 'used',
        chars: cut.chars,
      });
      planSpecIndex++;
    } catch {
      // git.readFile throws ENOENT for a missing file (server/INSIGHTS.md, 2026-08-17).
      sources.push({ kind: 'plan_or_spec', ref: cand.ref, status: 'unreachable', chars: 0 });
    }
  }

  // ---- file_list — paths, add/delete counts and hunk HEADERS only (REQ-3) ----
  const fileList = renderFileList(diff.files);
  if (fileList.status !== 'missing') {
    sections.push(`## Changed files\n${wrapUntrusted('file-list', fileList.text)}`);
  }
  sources.push({
    kind: 'file_list',
    ref: `${diff.files.length} files`,
    status: fileList.status,
    chars: fileList.chars,
  });

  return { promptSections: sections, sources };
}
