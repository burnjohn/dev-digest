/**
 * Run the same eval pattern N times to measure stability (LLM evals are probabilistic — one
 * green run proves little). Wraps `vitest run`, so vitest flags (-t, path patterns) pass through;
 * only -n/--times and --label are consumed here. Aggregates the records written during the runs
 * into per-test pass rate, a per-practice breakdown, and metric stats (mean ± stddev).
 *
 *   pnpm eval:repeat skills/onion-architecture -n 5 --label baseline
 *
 * --label saves the aggregate to results/repeat-<label>.json so two labeled series can be diffed
 * with `pnpm eval:delta baseline candidate`.
 */

import { mkdirSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GREEN, RED, DIM, RESET, rateColor } from "./ansi.js";
import { gitInfo } from "./git.js";
import { countTests, runVitestOnce } from "./run-vitest.js";
import { RESULTS_DIR } from "./artifacts/paths.js";
import { aggregate, loadRecords, recordCount, type NodeAggregate, type Stats } from "./records/stats.js";

/**
 * vitest treats a path pattern as a SUBSTRING filter, so a bare `agents/architecture-reviewer`
 * also matches `agents/architecture-reviewer-lite/...` and silently doubles the run with the
 * wrong agent. Expand any positional arg that points at a directory into the exact `.eval.ts`
 * file paths inside it (which are NOT substrings of a sibling directory's files), so an A/B stays
 * a clean A/B. Args that already name a file, or that don't resolve to a directory, pass through.
 */
function resolveEvalPatterns(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    // Preserve flags and the value that follows a value-taking flag (e.g. -t <pattern>).
    if (a.startsWith("-")) {
      out.push(a);
      if (a === "-t" || a === "--testNamePattern") out.push(args[++i]);
      continue;
    }
    if (existsSync(a) && statSync(a).isDirectory()) {
      const evals = readdirSync(a)
        .filter((f) => f.endsWith(".eval.ts"))
        .map((f) => join(a, f));
      if (evals.length) {
        out.push(...evals);
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const statLine = (label: string, s: Stats) =>
  `      ${label}: ${s.mean.toFixed(0)} ± ${s.stddev.toFixed(0)} [${s.min}–${s.max}]`;

function printTest(agg: NodeAggregate, times: number): void {
  const shortId = agg.nodeid.split(" > ").slice(-1)[0];
  console.log(`\n  ${rateColor(agg.pass.rate)}${agg.pass.passed}/${agg.pass.total} ${pct(agg.pass.rate)}${RESET}  ${shortId}`);
  const practices = Object.entries(agg.practices);
  if (practices.length) {
    for (const [text, s] of practices) {
      console.log(`      ${rateColor(s.rate)}${s.passed}/${s.total} ${pct(s.rate).padStart(4)}${RESET}  ${text}`);
    }
  }
  console.log(statLine("turns   ", agg.metrics.numTurns));
  console.log(statLine("duration", agg.metrics.durationMs));
  console.log(statLine("tok_out ", agg.metrics.outputTokens));
  if (times < 5) console.log(`      ${DIM}(n=${times}: stddev indicative only)${RESET}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Cap runs at 2 to keep token spend bounded — LLM sessions are expensive, and 2 runs is enough
  // to catch a blatantly flaky case. Bump MAX_TIMES if you deliberately want a fuller stability run.
  const MAX_TIMES = 2;
  let times = MAX_TIMES;
  let label: string | undefined;
  const vitestArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-n" || a === "--times") times = Number(argv[++i]);
    else if (a === "--label") label = argv[++i];
    else vitestArgs.push(a);
  }
  if (vitestArgs.length === 0 || !Number.isFinite(times) || times < 1) {
    console.error("usage: pnpm eval:repeat <vitest pattern> [-n times<=2] [-t testNamePattern] [--label name]");
    process.exit(1);
  }
  if (times > MAX_TIMES) {
    console.error(`  ${DIM}capping -n ${times} → ${MAX_TIMES} (token economy)${RESET}`);
    times = MAX_TIMES;
  }
  vitestArgs.splice(0, vitestArgs.length, ...resolveEvalPatterns(vitestArgs));

  const startLine = recordCount();
  let line = startLine;
  const nCases = countTests(vitestArgs);
  console.log(`\nRepeat: ${vitestArgs.join(" ")}`);
  console.log(`  ${nCases ?? "?"} test case(s) × ${times} runs  (full traces in results/outputs/)\n`);
  for (let i = 1; i <= times; i++) {
    const captured = await runVitestOnce(`run ${i}/${times}`, vitestArgs);
    const fresh = loadRecords(line);
    line = recordCount();
    if (fresh.length === 0) {
      console.log(`  run ${i}/${times}  ${RED}no records — run crashed${RESET}`);
      if (captured) console.log(captured.split("\n").slice(-6).join("\n"));
      continue;
    }
    const passed = fresh.filter((r) => r.outcome).length;
    const mark = passed === fresh.length ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  run ${i}/${times}  ${mark} ${passed}/${fresh.length} cases`);
  }

  const records = loadRecords(startLine);
  const tests = aggregate(records);
  const nodeids = Object.keys(tests).sort();

  console.log(`\n${"=".repeat(60)}\nRepeat summary (${times} runs)\n${"=".repeat(60)}`);
  if (nodeids.length === 0) {
    console.log("  (no records produced — check the pattern / -t filter)");
  }
  for (const id of nodeids) printTest(tests[id], times);

  if (label) {
    const git = gitInfo();
    mkdirSync(RESULTS_DIR, { recursive: true });
    const file = join(RESULTS_DIR, `repeat-${label}.json`);
    writeFileSync(file, JSON.stringify({ label, git_sha: git.sha, dirty: git.dirty, times, vitestArgs, tests }, null, 2));
    console.log(`\n${GREEN}Saved as '${label}'${RESET} -> ${file}`);
    console.log(`Compare with: pnpm eval:delta <baseline-label> ${label}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
