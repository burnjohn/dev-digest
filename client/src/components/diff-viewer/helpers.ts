/** Pure helpers for the DiffViewer. */
import { HUNK_HEADER_RE } from "./constants";

export interface ParsedDiffFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface Line {
  kind: "add" | "del" | "ctx" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Parse unified-diff patch text into renderable lines with old/new line numbers. */
export function parsePatch(patch: string | null | undefined): Line[] {
  if (!patch) return [];
  const out: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(HUNK_HEADER_RE);
      if (m) {
        oldNo = parseInt(m[1]!, 10);
        newNo = parseInt(m[2]!, 10);
      }
      out.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newNo });
      newNo++;
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNo });
      oldNo++;
    } else {
      out.push({ kind: "ctx", text: raw.slice(raw.startsWith(" ") ? 1 : 0), oldNo, newNo });
      oldNo++;
      newNo++;
    }
  }
  return out;
}

const FILE_HEADER_RE = /^(?:---|\+\+\+) (?:[ab]\/(.+)|\/dev\/null)$/;

/**
 * Best-effort split of a hand-pasted, possibly multi-file unified diff into
 * per-file `PrFile`-shaped records DiffViewer already knows how to render.
 * GitHub's own per-file `patch` (what `parsePatch` above expects) never
 * includes the `--- a/…` / `+++ b/…` header pair — only hunk (`@@`) and
 * +/-/context lines — so those two header lines are consumed here and never
 * forwarded into `patch`. A paste that doesn't look like a unified diff
 * (no `--- `/`+++ ` pair) yields an empty array — never a thrown error, since
 * this only ever feeds an optional preview, not validation.
 */
export function parseMultiFileDiff(raw: string): ParsedDiffFile[] {
  const lines = raw.split("\n");
  const files: ParsedDiffFile[] = [];
  let i = 0;
  while (i < lines.length) {
    const oldHeader = lines[i];
    const newHeader = lines[i + 1];
    if (oldHeader?.startsWith("--- ") && newHeader?.startsWith("+++ ")) {
      const path = newHeader.match(FILE_HEADER_RE)?.[1] ?? oldHeader.match(FILE_HEADER_RE)?.[1] ?? "unknown";
      i += 2;
      const body: string[] = [];
      let additions = 0;
      let deletions = 0;
      while (i < lines.length && !lines[i]!.startsWith("--- ")) {
        const line = lines[i]!;
        if (line.startsWith("+") && !line.startsWith("+++ ")) additions++;
        else if (line.startsWith("-") && !line.startsWith("--- ")) deletions++;
        body.push(line);
        i++;
      }
      files.push({ path, additions, deletions, patch: body.join("\n") });
    } else {
      i++;
    }
  }
  return files;
}
