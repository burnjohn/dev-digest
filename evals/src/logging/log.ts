/**
 * Human-readable run output. `logTrace` shows what a session DID (the trace workflow evals
 * assert on); `logVerdict` shows the judge's per-practice reasoning. Both no-op under EVAL_QUIET
 * so multi-run aggregation isn't drowned in per-run spam.
 */

import { RED, GREEN, YELLOW, DIM, RESET } from "../ansi.js";
import { QUIET } from "../config.js";
import type { Result } from "../runtime/run-claude.js";
import type { Verdict } from "../scoring/llm-judge.js";

/**
 * Print what a session ACTUALLY did — tools, subagent(s), skills, files read, turns — plus a
 * short preview of its final text. The trace does not lie the way prose does.
 */
export function logTrace(label: string, result: Result): void {
  if (QUIET) return;
  const status = result.isError ? `${RED}ERROR${RESET}` : `${GREEN}ok${RESET}`;
  console.log(`\n  trace: ${label} — ${status} (${result.numTurns} turns)`);
  console.log(`    tools:     ${result.toolsUsed.join(", ") || "(none)"}`);
  console.log(`    subagents: ${result.subagents.join(", ") || "(none)"}`);
  console.log(`    skills:    ${result.skillsInvoked.join(", ") || "(none)"}`);
  console.log(`    reads:     ${result.filesRead.join(", ") || "(none)"}`);
  const m = result.metrics;
  console.log(
    `    metrics:   ${result.numTurns} turns · ${m.durationMs}ms · ` +
      `${m.inputTokens}→${m.outputTokens} tok · ${m.toolCallCount} tool calls`,
  );
  const preview = result.text.slice(0, 300).replace(/\n/g, " ");
  console.log(`    ${DIM}text: ${preview}${result.text.length > 300 ? "…" : ""}${RESET}`);
}

/** Print the judge's per-practice breakdown: score, PASS/FAIL, and the verbatim evidence quote. */
export function logVerdict(label: string, verdict: Verdict): void {
  if (QUIET) return;
  const pct = Math.round(verdict.score * 100);
  const scoreColor = verdict.score >= 1 ? GREEN : verdict.score > 0 ? YELLOW : RED;
  console.log(`\n  judge: ${label} — ${scoreColor}${verdict.passed}/${verdict.total} (${pct}%)${RESET}`);
  for (const r of verdict.results) {
    const mark = r.passed ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
    console.log(`    [${mark}] ${r.practice}`);
    console.log(`      ${DIM}evidence: ${r.evidence || "(none)"}${RESET}`);
  }
}
