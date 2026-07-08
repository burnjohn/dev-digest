/**
 * Local version-over-version trend. A tiny vitest reporter that appends each eval test's
 * pass/fail (with the current git sha) to results/history.jsonl. Both `eval:compare` and
 * `eval:repeat` read this file, so removing the reporter disables both — it is not optional
 * if you use those. Nothing here calls a model.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HISTORY = join(HERE, "..", "results", "history.jsonl");

function gitSha(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "unknown";
  }
}

interface TaskLike {
  type?: string;
  name?: string;
  result?: { state?: string };
  tasks?: TaskLike[];
}

export default class TrendReporter {
  private runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  private sha = gitSha();

  onFinished(files: TaskLike[] = []) {
    const rows: string[] = [];
    const walk = (task: TaskLike, file: string) => {
      const state = task.result?.state;
      // Only record tests that actually ran (pass/fail) — skips add noise to the trend.
      if (state === "pass" || state === "fail") {
        rows.push(
          JSON.stringify({
            run_id: this.runId,
            git_sha: this.sha,
            nodeid: `${file} > ${task.name ?? "?"}`,
            outcome: state,
          }),
        );
      }
      task.tasks?.forEach((t) => walk(t, file));
    };
    for (const f of files) (f.tasks ?? []).forEach((t) => walk(t, f.name ?? "?"));
    if (!rows.length) return;
    mkdirSync(dirname(HISTORY), { recursive: true });
    appendFileSync(HISTORY, rows.join("\n") + "\n");
  }
}
