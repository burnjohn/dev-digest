/**
 * Pure diff synthesis for eval cases (SPEC-03) — two owner kinds, one shared
 * point (`_shared/`, R0/R1-grade: two functions over strings, no `Db`, no
 * container, no I/O — see docs/plans/09-eval-pipeline.md T5).
 *
 * Both functions produce a bare diff TEXT string, never a parsed `UnifiedDiff`
 * — parsing stays the job of `adapters/git/diff-parser.ts::parseUnifiedDiff`,
 * which an R2 module may not import (ring R4). Callers parse the output
 * themselves when they need the structured shape.
 */

const DEFAULT_SKILL_CASE_FILENAME = 'snippet.ts';

/**
 * Prepend the three unified-diff header lines to a stored `pr_files.patch` —
 * byte-for-byte the shape `diffFromPrFiles` builds
 * (`modules/reviews/diff-loader.ts`), which is the reason every agent-owned
 * eval case parses at all (REQ-4/REQ-20, and SPEC-03 §4.3).
 */
export function buildAgentCaseDiff(file: string, patch: string): string {
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, patch].join('\n');
}

export interface SkillCaseDiffInput {
  /** Omitted or empty for a `new_file` case — declares a zero-length old side. */
  before?: string | null;
  after: string;
  /** Absent/empty/whitespace-only normalizes to `snippet.ts` (REQ-56). */
  filename?: string | null;
}

/**
 * Synthesize a one-file, one-hunk unified diff from authored before/after
 * source (REQ-56, REQ-57, REQ-58). Every `before` line is emitted `-`-prefixed,
 * then every `after` line `+`-prefixed — so an `after` of `m` lines numbers
 * `1..m` on the new side, and an empty `before` declares a zero-length old
 * side (`oldStart`/`oldLines` both `0`).
 *
 * Prefixing alone does not make an authored line safe to hand to the parser
 * unmodified: an authored `after` line `++ x` becomes `+++ x` once prefixed,
 * and an authored `before` line `-- x` becomes `--- x` — both collide with the
 * unified-diff file-header syntax. That collision is closed in the PARSER
 * (`adapters/git/diff-parser.ts`'s in-hunk guard), not here — there is no
 * prefix that escapes it, since `+`-prefixing is the whole encoding.
 */
export function buildSkillCaseDiff(input: SkillCaseDiffInput): string {
  const filename = normalizeFilename(input.filename);
  const beforeLines = splitLines(input.before ?? '');
  const afterLines = splitLines(input.after);

  const oldLines = beforeLines.length;
  const newLines = afterLines.length;
  const oldStart = oldLines > 0 ? 1 : 0;
  const newStart = newLines > 0 ? 1 : 0;

  const hunkHeader = `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;
  const body = [...beforeLines.map((l) => `-${l}`), ...afterLines.map((l) => `+${l}`)];

  return [
    `diff --git a/${filename} b/${filename}`,
    `--- a/${filename}`,
    `+++ b/${filename}`,
    hunkHeader,
    ...body,
  ].join('\n');
}

function normalizeFilename(filename?: string | null): string {
  const trimmed = filename?.trim();
  return trimmed ? trimmed : DEFAULT_SKILL_CASE_FILENAME;
}

/** Split on `/\r?\n/` — `\r` is a JS regex line terminator, so `'\n'` alone silently breaks CRLF input (server/INSIGHTS.md, 2026-08-17). */
function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.split(/\r?\n/);
}
