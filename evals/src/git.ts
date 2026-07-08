/**
 * Git provenance for a run — the short sha and whether the tree is dirty. Shared by record.ts
 * (per-run rows) and repeat.ts (labeled aggregates) so both stamp the same way. No vitest
 * dependency here, so plain `tsx` CLIs can import it safely.
 */

import { execFileSync } from "node:child_process";

export interface GitInfo {
  sha: string;
  dirty: boolean;
}

export function gitInfo(): GitInfo {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
    return { sha, dirty };
  } catch {
    return { sha: "unknown", dirty: false };
  }
}
