/**
 * Run one child `vitest` quietly, with a live spinner + elapsed seconds so a long model run
 * visibly makes progress instead of hanging the terminal in silence. Full per-run trace is
 * suppressed (EVAL_QUIET) and captured; the caller prints the outcome line once the run ends.
 * Falls back to a single static line when stdout is not a TTY (CI logs).
 */

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIM, RESET } from "./ansi.js";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

// Random per-CLI-process salt, so two eval sessions started in the same second cannot mint the
// same run id.
const SESSION = Math.random().toString(36).slice(2, 6);

/**
 * A run id unique to one child vitest process, passed in as EVAL_RUN_ID. It is what lets the
 * parent attribute records.jsonl rows (and the results/outputs/<id>/ dir) to the run it
 * launched, instead of guessing from a line offset that a concurrent run invalidates.
 */
export function newRunId(suffix: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
  return stamp + "-" + SESSION + "-" + suffix;
}
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Resolve vitest's actual JS entry and invoke it via `node <script>` instead of `pnpm exec
// vitest`. This sidesteps package-manager shims entirely (on Windows, "pnpm"/"vitest.cmd" are
// .cmd shims that Node — since the CVE-2024-27980 fix — refuses to spawn without a shell, and
// getting shell-quoting right cross-platform is its own can of worms). `process.execPath` is
// always a real executable, on every platform, so plain array-arg spawn() just works.
const VITEST_BIN = createRequire(import.meta.url).resolve("vitest/vitest.mjs");

/** How many test cases the pattern matches, via `vitest list` (no model calls). null on error. */
export function countTests(vitestArgs: string[]): number | null {
  try {
    const out = execFileSync(process.execPath, [VITEST_BIN, "list", ...vitestArgs], {
      cwd: EVALS_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const n = out.split("\n").filter((l) => l.includes(" > ")).length;
    return n || null;
  } catch {
    return null;
  }
}

/** Run vitest once; resolves with the child's combined stdout+stderr (for crash diagnosis). */
export function runVitestOnce(label: string, vitestArgs: string[], extraEnv: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve) => {
    const start = Date.now();
    let out = "";
    const child = spawn(process.execPath, [VITEST_BIN, "run", "--reporter=dot", ...vitestArgs], {
      cwd: EVALS_DIR,
      env: { ...process.env, EVAL_QUIET: "1", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));

    let timer: ReturnType<typeof setInterval> | undefined;
    if (process.stdout.isTTY) {
      let f = 0;
      const tick = () => {
        const secs = Math.round((Date.now() - start) / 1000);
        process.stdout.write(`\r  ${label}  ${FRAMES[(f = (f + 1) % FRAMES.length)]} running… ${DIM}${secs}s${RESET}   `);
      };
      tick();
      timer = setInterval(tick, 120);
    } else {
      process.stdout.write(`  ${label} running…\n`);
    }

    child.on("close", () => {
      if (timer) {
        clearInterval(timer);
        process.stdout.write("\r\x1b[K"); // clear the spinner line; caller prints the result
      }
      resolve(out);
    });
  });
}
