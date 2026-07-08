/** Pure helpers for the DiffViewer. */
import type { PrFile } from "@/lib/types";
import { HUNK_HEADER_RE } from "./constants";

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

/**
 * Splits a raw multi-file unified diff (the `diff --git a/... b/...` / `---`
 * / `+++` / `@@ ... @@` format pasted into an eval-case fixture) into
 * per-file `PrFile`-shaped chunks a live `DiffViewer` preview can render.
 * `parsePatch()` above expects a GitHub-style PER-FILE patch body starting at
 * the first `@@` hunk (no `diff --git`/`---`/`+++` header lines) — this strips
 * those header lines per file before that point. Display-only: never sent to
 * the server. The authoritative diff parse used for scoring is the server's
 * own `parseUnifiedDiff()` (an unrelated implementation) — this function only
 * feeds a preview, it is not a validity check.
 */
export function rawDiffToPrFiles(raw: string): PrFile[] {
  if (!raw.trim()) return [];
  return raw
    .split(/^diff --git /m)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .map((block) => {
      const lines = block.split("\n");
      const path = block.match(/\+\+\+ b\/(\S+)/)?.[1] ?? lines[0]?.match(/b\/(\S+)/)?.[1] ?? "unknown";

      const hunkStart = lines.findIndex((l) => l.startsWith("@@"));
      const patchLines = hunkStart >= 0 ? lines.slice(hunkStart) : [];

      let additions = 0;
      let deletions = 0;
      for (const l of patchLines) {
        if (l.startsWith("+") && !l.startsWith("+++")) additions++;
        else if (l.startsWith("-") && !l.startsWith("---")) deletions++;
      }

      return { path, additions, deletions, patch: patchLines.join("\n") };
    });
}
