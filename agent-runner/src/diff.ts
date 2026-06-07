import type { UnifiedDiff, DiffHunk } from '@devdigest/shared';

/** A changed file as returned by GitHub's `pulls.listFiles` (path + hunk patch). */
export interface ChangedFile {
  path: string;
  /** Unified-diff hunks for this file; absent for binary / too-large files. */
  patch?: string | null;
}

/**
 * Reconstruct a single UnifiedDiff from GitHub `listFiles` patches (the runner's
 * diff source — no clone needed). Files without a `patch` (binary / truncated by
 * the API) are reported in `skipped` so the caller can surface them — a silent
 * skip would read as "clean" when grounding later drops anything citing them.
 */
export function filesToUnifiedDiff(files: ChangedFile[]): { diff: UnifiedDiff; skipped: string[] } {
  const parts: string[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (!f.patch) {
      skipped.push(f.path);
      continue;
    }
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return { diff: parseUnifiedDiff(parts.join('\n')), skipped };
}

/**
 * Minimal unified-diff parser (vendored from the server's git adapter — pure,
 * "copy & own"). The runner owns diff acquisition: in M2 it reconstructs a
 * unified diff from the GitHub `listFiles` patches, then parses it here into the
 * UnifiedDiff shape the grounding gate needs (file:line must intersect a hunk's
 * new-side line numbers).
 */
export function parseUnifiedDiff(raw: string): UnifiedDiff {
  const files: UnifiedDiff['files'] = [];
  const lines = raw.split('\n');

  let current: UnifiedDiff['files'][number] | null = null;
  let hunk: DiffHunk | null = null;
  let newLineCursor = 0;

  const flushHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };
  const flushFile = () => {
    flushHunk();
    if (current) files.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      flushFile();
      current = { path: '', additions: 0, deletions: 0, hunks: [] };
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (!current) current = { path: '', additions: 0, deletions: 0, hunks: [] };
      const p = line.slice(4).replace(/^b\//, '').trim();
      current.path = p === '/dev/null' ? current.path : p;
      continue;
    }
    if (line.startsWith('--- ')) continue;
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
      continue;
    }
    if (!current || !hunk) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.additions++;
      hunk.newLineNumbers.push(newLineCursor);
      newLineCursor++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      current.deletions++;
    } else {
      hunk.newLineNumbers.push(newLineCursor);
      newLineCursor++;
    }
  }
  flushFile();

  return { raw, files: files.filter((f) => f.path) };
}
