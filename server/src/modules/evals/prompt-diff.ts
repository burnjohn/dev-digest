import type { EvalPromptDiffLine } from '../../vendor/shared/contracts/eval-batch.js';

/**
 * Pure, first-party line differ for the compare-modal's prompt diff (SPEC-03
 * AC-35/AC-36). No diff package — a first-party LCS over lines, computed with
 * an iterative DP table and an iterative backtrack (never recursion), so a
 * pathological pair of long prompts cannot blow the call stack.
 *
 * R2: imports only the contract type and node builtins. Returns data only —
 * no rendering, no formatting; the client renders `EvalPromptDiffLine[]`.
 */

/** Split on any line ending so a CRLF-authored prompt diffs identically to an LF one. */
function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/**
 * Line-level diff between two prompt texts. Returns an ordered array of
 * `{op, text}` matching `EvalPromptDiffLine` exactly — unchanged lines as
 * `same`, lines only in `newText` as `add`, lines only in `oldText` as `del`,
 * in source order.
 *
 * Iterative DP (bottom-up fill) + iterative backtrack: no recursion at any
 * input size, so a pathological pair of long prompts cannot overflow the
 * stack.
 */
export function diffPromptLines(oldText: string, newText: string): EvalPromptDiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;

  // dp[i][j] = length of the LCS of a[i..n) and b[j..m). Every index below is
  // within [0, n] / [0, m] by construction (loop bounds), so the
  // non-null assertions reflect a proven invariant, not an unchecked guess.
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) {
    dp.push(new Array<number>(m + 1).fill(0));
  }
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!;
    const nextRow = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? nextRow[j + 1]! + 1 : Math.max(nextRow[j]!, row[j + 1]!);
    }
  }

  const result: EvalPromptDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const lineA = a[i]!;
    const lineB = b[j]!;
    if (lineA === lineB) {
      result.push({ op: 'same', text: lineA });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      result.push({ op: 'del', text: lineA });
      i++;
    } else {
      result.push({ op: 'add', text: lineB });
      j++;
    }
  }
  while (i < n) {
    result.push({ op: 'del', text: a[i]! });
    i++;
  }
  while (j < m) {
    result.push({ op: 'add', text: b[j]! });
    j++;
  }
  return result;
}

/**
 * The REQ-36 verdict: whether two prompt texts are the *same version*, as a
 * discriminated result rather than an array a caller must test for
 * emptiness. `sameVersion: true` carries no diff at all (mirrors
 * `EvalBatchComparison.same_version` / `prompt_diff: null`, AC-36); the route
 * never inspects `diff.length === 0` to decide which case it is in.
 */
export type PromptDiffVerdict =
  | { sameVersion: true }
  | { sameVersion: false; diff: EvalPromptDiffLine[] };

/** Compares two prompt texts and returns the verdict plus diff (REQ-35, REQ-36). */
export function comparePromptVersions(oldText: string, newText: string): PromptDiffVerdict {
  if (oldText === newText) {
    return { sameVersion: true };
  }
  return { sameVersion: false, diff: diffPromptLines(oldText, newText) };
}
