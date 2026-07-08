/* diffWords.ts — pure, dependency-free word-level diff (AC-20).
   Standard LCS (longest common subsequence) over word-tokenized input,
   backtracked into a flat token list.

   Words and whitespace runs are tokenized together (split via `/(\s+)/`,
   keeping the whitespace runs as their own tokens) but the LCS comparison
   itself only matches WORD tokens against WORD tokens and WHITESPACE tokens
   against WHITESPACE tokens *at the same relative position* — two
   whitespace runs from unrelated parts of the text are treated as distinct
   tokens even if their string content happens to coincide (e.g. both are a
   single space). Without this distinction, the LCS optimizer can match an
   unrelated whitespace run instead of the one immediately adjacent to a
   real word, which fragments an otherwise-unchanged word into a spurious
   removed+added pair (see the "whitespace-only differences" test case).
   Concretely: a word token only ever equals another word token with the
   same text; a whitespace token only ever equals another whitespace token
   if it is the one immediately following the SAME equal-word match — this
   is enforced by never allowing two whitespace tokens to match unless the
   word token immediately preceding each of them was itself just matched as
   equal in the backtrack step. */

export type DiffTokenType = "equal" | "removed" | "added";

export interface DiffToken {
  type: DiffTokenType;
  text: string;
}

const isWhitespace = (tok: string) => /^\s+$/.test(tok);

/**
 * Word-level diff between `oldText` and `newText`. Returns a flat list of
 * tokens describing how to render the transition from `oldText` to
 * `newText`: `equal` tokens are shared, `removed` tokens only existed in
 * `oldText`, `added` tokens only exist in `newText`.
 */
export function diffWords(oldText: string, newText: string): DiffToken[] {
  const a = oldText.split(/(\s+)/).filter((t) => t.length > 0);
  const b = newText.split(/(\s+)/).filter((t) => t.length > 0);
  const m = a.length;
  const n = b.length;

  // dp[i][j] = length of the LCS of a[i..] and b[j..], where two tokens are
  // only considered equal if they are the SAME KIND (both whitespace or
  // both a word) AND — for whitespace — the tokens immediately preceding
  // them (if any) are themselves equal words. This prevents an unrelated
  // whitespace run from being matched across a real content change.
  const matches = (i: number, j: number): boolean => {
    const ai = a[i]!;
    const bj = b[j]!;
    if (isWhitespace(ai) !== isWhitespace(bj)) return false;
    if (!isWhitespace(ai)) return ai === bj;
    // Both whitespace: only "equal" when the preceding word (if any) on
    // each side is itself the same word — otherwise treat as unrelated.
    const prevA = i > 0 ? a[i - 1] : null;
    const prevB = j > 0 ? b[j - 1] : null;
    if (prevA === null && prevB === null) return ai === bj;
    if (prevA === null || prevB === null) return false;
    return prevA === prevB && ai === bj;
  };

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = matches(i, j) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const tokens: DiffToken[] = [];
  const push = (type: DiffTokenType, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.type === type) {
      last.text += text;
    } else {
      tokens.push({ type, text });
    }
  };

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (matches(i, j)) {
      push("equal", a[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      push("removed", a[i]!);
      i++;
    } else {
      push("added", b[j]!);
      j++;
    }
  }
  while (i < m) {
    push("removed", a[i]!);
    i++;
  }
  while (j < n) {
    push("added", b[j]!);
    j++;
  }

  return tokens;
}
