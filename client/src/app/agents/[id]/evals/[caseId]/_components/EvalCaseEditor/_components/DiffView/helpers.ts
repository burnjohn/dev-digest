/** Pure helpers for DiffView line styling. */

/** Background token for a unified-diff line (add / del / context). */
export function lineBackground(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "var(--code-add)";
  if (line.startsWith("-") && !line.startsWith("---")) return "var(--code-del)";
  return "transparent";
}

/** Whether a line is a hunk header (@@ … @@). */
export function isHunkHeader(line: string): boolean {
  return line.startsWith("@@");
}
