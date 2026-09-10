/**
 * Smart Diff — pure helpers (side-effect free; operate purely on their
 * arguments — no DB / network / `this`), same shape as `pulls/status.ts`.
 * Deterministically classifies a PR's files by risk and merges in the
 * latest review's findings. No LLM call.
 */
import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import {
  BOILERPLATE_PATH_PATTERNS,
  DOCS_PATH_PATTERNS,
  SPLIT_SUGGESTION_LINE_THRESHOLD,
  TEST_PATH_PATTERNS,
  WIRING_BASENAME_PATTERNS,
  WIRING_PATH_PATTERNS,
} from './smart-diff-constants.js';

const ROLE_ORDER: SmartDiffRole[] = ['core', 'wiring', 'tests', 'docs', 'boilerplate'];

/** Classify one file path into a risk role — boilerplate, docs, tests, wiring, else core. */
export function classifyFile(path: string): SmartDiffRole {
  if (BOILERPLATE_PATH_PATTERNS.some((re) => re.test(path))) return 'boilerplate';
  if (DOCS_PATH_PATTERNS.some((re) => re.test(path))) return 'docs';
  if (TEST_PATH_PATTERNS.some((re) => re.test(path))) return 'tests';
  const basename = path.split('/').pop() ?? path;
  if (WIRING_BASENAME_PATTERNS.some((re) => re.test(basename))) return 'wiring';
  if (WIRING_PATH_PATTERNS.some((re) => re.test(path))) return 'wiring';
  return 'core';
}

/** Every line in [startLine, endLine], inclusive. */
function expandLineRange(startLine: number, endLine: number): number[] {
  const out: number[] = [];
  for (let n = startLine; n <= endLine; n++) out.push(n);
  return out;
}

/** Top-level directory of a path (empty string for a root-level file). */
function topLevelDir(path: string): string {
  const i = path.indexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/**
 * Assemble the SmartDiff response from already-loaded PR files and the
 * latest review's findings. Deterministic — no LLM call.
 */
export function buildSmartDiff(
  files: { path: string; additions: number; deletions: number }[],
  findings: { file: string; startLine: number; endLine: number }[],
): SmartDiff {
  const findingLinesByFile = new Map<string, Set<number>>();
  for (const f of findings) {
    const set = findingLinesByFile.get(f.file) ?? new Set<number>();
    for (const line of expandLineRange(f.startLine, f.endLine)) set.add(line);
    findingLinesByFile.set(f.file, set);
  }

  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  for (const file of files) {
    const role = classifyFile(file.path);
    const finding_lines = [...(findingLinesByFile.get(file.path) ?? [])].sort((a, b) => a - b);
    const entry: SmartDiffFile = {
      path: file.path,
      pseudocode_summary: null,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines,
    };
    const list = byRole.get(role) ?? [];
    list.push(entry);
    byRole.set(role, list);
  }

  const groups: SmartDiffGroup[] = ROLE_ORDER.filter((role) => byRole.has(role)).map((role) => ({
    role,
    files: byRole.get(role)!,
  }));

  const total_lines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const too_big = total_lines > SPLIT_SUGGESTION_LINE_THRESHOLD;
  const proposed_splits = too_big
    ? [...new Set((byRole.get('core') ?? []).map((f) => topLevelDir(f.path)))].map((dir) => ({
        name: dir || '(root)',
        files: (byRole.get('core') ?? [])
          .filter((f) => topLevelDir(f.path) === dir)
          .map((f) => f.path),
      }))
    : [];

  return {
    groups,
    split_suggestion: { too_big, total_lines, proposed_splits },
  };
}
