import type { EvalPromptDiffLine } from "@devdigest/shared";

/**
 * Pure helpers for CompareModal — gutter numbering for the served prompt diff.
 *
 * The line numbers and the `@@` header are derived HERE rather than served,
 * because `EvalPromptDiffLine` is `{op, text}` and nothing else. That is safe
 * only because the server sends a FULL-FILE diff: `prompt-diff.ts` emits every
 * unchanged line as `same`, with no context window and no hunk grouping, so
 * walking the array from 1 reproduces both sides' real line numbers exactly. If
 * the server ever starts collapsing runs of `same`, these numbers become
 * fiction and the counts have to move onto the wire.
 */

export interface NumberedDiffRow {
  line: EvalPromptDiffLine;
  /**
   * The row's 1-based number on the side it belongs to — the NEW side for
   * `same`/`add`, the OLD side for `del`. One gutter column, not two: a `del`
   * row has no new-side number to show, and a blank gutter reads as a bug.
   */
  number: number;
}

export interface NumberedDiff {
  rows: NumberedDiffRow[];
  oldCount: number;
  newCount: number;
  /** `@@ -1,N +1,M @@`. One hunk, because the diff is the whole file. */
  hunkHeader: string;
}

export function numberDiffLines(diff: EvalPromptDiffLine[]): NumberedDiff {
  let oldNo = 0;
  let newNo = 0;
  const rows = diff.map((line) => {
    if (line.op !== "add") oldNo += 1;
    if (line.op !== "del") newNo += 1;
    return { line, number: line.op === "del" ? oldNo : newNo };
  });
  return {
    rows,
    oldCount: oldNo,
    newCount: newNo,
    hunkHeader: `@@ -1,${oldNo} +1,${newNo} @@`,
  };
}
