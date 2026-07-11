/**
 * Run one child `vitest` quietly, with a live spinner + elapsed seconds so a long model run
 * visibly makes progress instead of hanging the terminal in silence. Full per-run trace is
 * suppressed (EVAL_QUIET) and captured; the caller prints the outcome line once the run ends.
 * Falls back to a single static line when stdout is not a TTY (CI logs).
 */

import { execFileSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIM, RESET } from "./ansi.js";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** How many test cases the pattern matches, via `vitest list` (no model calls). null on error. */
export function countTests(vitestArgs: string[]): number | null {
  try {
    const out = execFileSync("pnpm", ["exec", "vitest", "list", ...vitestArgs], {
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
    const child = spawn("pnpm", ["exec", "vitest", "run", "--reporter=dot", ...vitestArgs], {
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
