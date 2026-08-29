import type { UnifiedDiff, DiffHunk } from '@devdigest/shared';

/**
 * Minimal unified-diff parser. Extracts per-file hunks and the set of new-side
 * line numbers each hunk covers — exactly what the citation-grounding gate
 * needs (file:line must intersect a real hunk).
 *
 * Handles standard `git diff` output:
 *   diff --git a/path b/path
 *   --- a/path
 *   +++ b/path
 *   @@ -oldStart,oldLines +newStart,newLines @@
 */
export function parseUnifiedDiff(raw: string): UnifiedDiff {
  const files: UnifiedDiff['files'] = [];
  const lines = raw.split('\n');

  let current: UnifiedDiff['files'][number] | null = null;
  let hunk: DiffHunk | null = null;
  let newLineCursor = 0;
  // A real unified diff's `--- `/`+++ ` file-header lines appear ONLY before
  // the first `@@` of a file — that is what a file header means, and what
  // every existing caller already relies on. Once a hunk has started, a line
  // that happens to begin `--- `/`+++ ` is hunk CONTENT, not a header: an
  // authored source line `-- x` / `++ x` picks up one more prefix character
  // when diff-encoded (`buildSkillCaseDiff`, `modules/_shared/diff-synth.ts`),
  // and honouring it as a header there forges the file's path and silently
  // drops the line from the hunk (docs/plans/09-eval-pipeline.md T5).
  let sawHunk = false;

  const flushHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };
  const flushFile = () => {
    flushHunk();
    if (current) files.push(current);
    current = null;
    sawHunk = false;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      flushFile();
      // path resolved from +++ line below; placeholder for now
      current = { path: '', additions: 0, deletions: 0, hunks: [] };
      continue;
    }
    if (!sawHunk && line.startsWith('+++ ')) {
      if (!current) current = { path: '', additions: 0, deletions: 0, hunks: [] };
      const p = line.slice(4).replace(/^b\//, '').trim();
      current.path = p === '/dev/null' ? current.path : p;
      continue;
    }
    if (!sawHunk && line.startsWith('--- ')) continue;
    const hh = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hh) {
      flushHunk();
      const newStart = Number(hh[3]);
      const newLines = hh[4] ? Number(hh[4]) : 1;
      hunk = {
        file: current?.path ?? '',
        oldStart: Number(hh[1]),
        oldLines: hh[2] ? Number(hh[2]) : 1,
        newStart,
        newLines,
        newLineNumbers: [],
      };
      newLineCursor = newStart;
      sawHunk = true;
      continue;
    }
    if (!current || !hunk) continue;
    // Once inside a hunk (sawHunk is true here — the two checks above already
    // intercepted any real header), a line's diff-marker prefix is exactly
    // its first character. No further exclusion is needed or correct: a line
    // like `+++ x` this deep IS an addition (its content, after the one
    // marker char, is `++ x`), not a header-lookalike to skip.
    if (line.startsWith('+')) {
      current.additions++;
      hunk.newLineNumbers.push(newLineCursor);
      newLineCursor++;
    } else if (line.startsWith('-')) {
      current.deletions++;
      // deletion: no new-side line consumed
    } else {
      // context line: advances new-side cursor and counts as covered
      hunk.newLineNumbers.push(newLineCursor);
      newLineCursor++;
    }
  }
  flushFile();

  return { raw, files: files.filter((f) => f.path) };
}
