/**
 * Benchmark a skill/agent's LIFT: run a pattern N times with the artifact injected (candidate)
 * and N times without it (baseline: raw model), then report mean ± stddev / min / max per
 * configuration, the delta, a per-practice matrix, and deterministic analyst flags. This is the
 * with_skill vs without_skill comparison from skill-creator v2.
 *
 *   pnpm eval:benchmark skills/engineering-insights -n 5
 *
 * Skills/agents only — a "no artifact" baseline is meaningless for the workflow tier, which has
 * its own control-vs-treatment design; workflow patterns are refused.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GREEN, RED, YELLOW, DIM, RESET } from "../ansi.js";
import { countTests, runVitestOnce } from "../run-vitest.js";
import { EVAL_MODEL, EVAL_JUDGE_MODEL } from "../config.js";
import { RESULTS_DIR } from "../artifacts/paths.js";
import { gitInfo } from "../git.js";
import {
  aggregate,
  byConfig,
  calcStats,
  computeFlags,
  loadRecords,
  recordCount,
  type EvalRecord,
  type Flag,
  type NodeAggregate,
  type Series,
  type Stats,
} from "./stats.js";

/** Run one config N times, with a live spinner per run. Each run prints one outcome line read
 *  from the records it wrote; full per-run trace is suppressed (EVAL_QUIET) and lives in
 *  results/outputs/. */
async function runConfig(config: string, times: number, vitestArgs: string[]): Promise<void> {
  let line = recordCount();
  for (let i = 1; i <= times; i++) {
    const label = `${config.padEnd(9)} ${i}/${times}`;
    const captured = await runVitestOnce(label, vitestArgs, { EVAL_CONFIG: config });
    const fresh = loadRecords(line);
    line = recordCount();
    if (fresh.length === 0) {
      console.log(`  ${label}  ${RED}no records — run crashed${RESET}`);
      if (captured) console.log(captured.split("\n").slice(-8).join("\n"));
      continue;
    }
    const passed = fresh.filter((r) => r.outcome).length;
    const scores = fresh.map((r) => r.score).filter((s): s is number => s !== undefined);
    const meanScore = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) : null;
    const mark = passed === fresh.length ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${label}  ${mark} ${passed}/${fresh.length} cases` + (meanScore !== null ? `  score ${meanScore}%` : ""));
  }
}

/** Overall per-config summary: pass_rate + resource stats pooled across every record. */
function summarize(records: EvalRecord[]) {
  const passed = records.filter((r) => r.outcome).length;
  return {
    n: records.length,
    pass_rate: records.length ? passed / records.length : 0,
    outputTokens: calcStats(records.map((r) => r.metrics?.outputTokens ?? 0)),
    durationMs: calcStats(records.map((r) => r.metrics?.durationMs ?? 0)),
    numTurns: calcStats(records.map((r) => r.num_turns ?? 0)),
  };
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const cell = (s: Stats) => `${s.mean.toFixed(0)} ± ${s.stddev.toFixed(0)} [${s.min}–${s.max}] (n=${s.n})`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let times = 5;
  let label: string | undefined;
  const vitestArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-n" || a === "--runs" || a === "--times") times = Number(argv[++i]);
    else if (a === "--label") label = argv[++i];
    else vitestArgs.push(a);
  }
  if (vitestArgs.length === 0 || !Number.isFinite(times) || times < 1) {
    console.error("usage: pnpm eval:benchmark <vitest pattern> [-n runs] [--label name]");
    process.exit(1);
  }
  if (vitestArgs.some((a) => a.includes("workflow"))) {
    console.error(
      "benchmark does not apply to the workflow tier: a 'no artifact' baseline is meaningless\n" +
        "for tests that load the real harness. Use pnpm eval:workflow / eval:repeat instead.",
    );
    process.exit(1);
  }

  // Sequential — never parallelize benchmark runs (subscription rate limits).
  const startLine = recordCount();
  const nCases = countTests(vitestArgs);
  console.log(`\nBenchmark: ${vitestArgs.join(" ")}`);
  console.log(
    `  ${nCases ?? "?"} test case(s) × ${times} runs × 2 configs = ${(nCases ?? 0) * times * 2} sessions`,
  );
  console.log(`  ${GREEN}candidate${RESET} = artifact injected (with skill)   ${DIM}·${RESET}   ${YELLOW}baseline${RESET} = raw model, no artifact\n`);
  await runConfig("candidate", times, vitestArgs);
  await runConfig("baseline", times, vitestArgs);

  const configs = byConfig(loadRecords(startLine));
  const cand = configs.candidate ?? [];
  const base = configs.baseline ?? [];
  const candAgg = aggregate(cand);
  const baseAgg = aggregate(base);
  const candSum = summarize(cand);
  const baseSum = summarize(base);

  const git = gitInfo();
  const timestamp = new Date().toISOString();
  const nodeids = [...new Set([...Object.keys(candAgg), ...Object.keys(baseAgg)])].sort();

  // Per-test + per-practice flags.
  const flagList: { nodeid: string; practice?: string; flags: Flag[] }[] = [];
  for (const id of nodeids) {
    const c = candAgg[id];
    const b = baseAgg[id];
    const testFlags = computeFlags(c?.pass, b?.pass, {
      candTokens: c?.metrics.outputTokens.mean,
      baseTokens: b?.metrics.outputTokens.mean,
    });
    if (testFlags.length) flagList.push({ nodeid: id, flags: testFlags });
    const practiceTexts = [...new Set([...Object.keys(c?.practices ?? {}), ...Object.keys(b?.practices ?? {})])];
    for (const text of practiceTexts) {
      const pf = computeFlags(c?.practices[text], b?.practices[text]);
      if (pf.length) flagList.push({ nodeid: id, practice: text, flags: pf });
    }
  }

  const report = {
    metadata: {
      pattern: vitestArgs.join(" "),
      task_model: EVAL_MODEL,
      judge_model: EVAL_JUDGE_MODEL,
      runs_per_configuration: times,
      git_sha: git.sha,
      dirty: git.dirty,
      timestamp,
    },
    run_summary: { candidate: candSum, baseline: baseSum },
    delta: { pass_rate: candSum.pass_rate - baseSum.pass_rate },
    tests: nodeids.reduce<Record<string, { candidate?: NodeAggregate; baseline?: NodeAggregate }>>((acc, id) => {
      acc[id] = { candidate: candAgg[id], baseline: baseAgg[id] };
      return acc;
    }, {}),
    flags: flagList,
  };

  const outDir = join(RESULTS_DIR, "benchmarks", timestamp.replace(/[:.]/g, "-"));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "benchmark.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, "benchmark.md"), renderMarkdown(report, nodeids, candAgg, baseAgg));

  // Console summary — compact candidate | baseline | Δ table.
  const dPct = (c: number, b: number) => {
    const d = Math.round((c - b) * 100);
    const col = d > 0 ? GREEN : d < 0 ? RED : DIM;
    return `${col}${d > 0 ? "+" : ""}${d}%${RESET}`;
  };
  const dNum = (c: number, b: number, betterLower = true) => {
    const d = c - b;
    const good = betterLower ? d < 0 : d > 0;
    const col = d === 0 ? DIM : good ? GREEN : RED;
    return `${col}${d > 0 ? "+" : ""}${d.toFixed(0)}${RESET}`;
  };
  const W = 18;
  console.log(`\n${"=".repeat(64)}\nBenchmark: ${vitestArgs.join(" ")}  (${times} runs/config)\n${"=".repeat(64)}`);
  console.log(`  ${GREEN}candidate${RESET} = with artifact   ${YELLOW}baseline${RESET} = raw model   Δ = candidate − baseline\n`);
  console.log(`  ${"metric".padEnd(12)}${"candidate".padEnd(W)}${"baseline".padEnd(W)}Δ`);
  console.log(
    `  ${"pass_rate".padEnd(12)}${pct(candSum.pass_rate).padEnd(W)}${pct(baseSum.pass_rate).padEnd(W)}${dPct(candSum.pass_rate, baseSum.pass_rate)}`,
  );
  console.log(
    `  ${"tok_out".padEnd(12)}${candSum.outputTokens.mean.toFixed(0).padEnd(W)}${baseSum.outputTokens.mean.toFixed(0).padEnd(W)}${dNum(candSum.outputTokens.mean, baseSum.outputTokens.mean)}`,
  );
  console.log(
    `  ${"num_turns".padEnd(12)}${candSum.numTurns.mean.toFixed(1).padEnd(W)}${baseSum.numTurns.mean.toFixed(1).padEnd(W)}${dNum(candSum.numTurns.mean, baseSum.numTurns.mean)}`,
  );

  // Per-practice candidate → baseline (the discriminating signal — where the artifact earns its keep).
  const practiceLines: string[] = [];
  for (const id of nodeids) {
    const c = candAgg[id];
    const b = baseAgg[id];
    const texts = [...new Set([...Object.keys(c?.practices ?? {}), ...Object.keys(b?.practices ?? {})])];
    for (const t of texts) {
      const cr = c?.practices[t];
      const br = b?.practices[t];
      const cs = cr ? `${Math.round(cr.rate * 100)}%` : "—";
      const bs = br ? `${Math.round(br.rate * 100)}%` : "—";
      practiceLines.push(`    ${cs.padStart(4)} → ${bs.padStart(4)}  ${t}`);
    }
  }
  if (practiceLines.length) {
    console.log(`\n  practices (candidate → baseline):`);
    practiceLines.forEach((l) => console.log(l));
  }

  const lift = candSum.pass_rate - baseSum.pass_rate;
  const liftCol = lift > 0 ? GREEN : lift < 0 ? RED : DIM;
  console.log(`\n  ${liftCol}lift: ${lift >= 0 ? "+" : ""}${Math.round(lift * 100)}% pass rate${RESET}`);
  if (flagList.length) {
    console.log(`  ${YELLOW}flags:${RESET}`);
    for (const f of flagList) {
      const where = f.practice ?? "(whole test)";
      console.log(`    ${YELLOW}${f.flags.join(", ").padEnd(22)}${RESET} ${where}`);
    }
  }
  console.log(`\n  full report: ${join(outDir, "benchmark.md")}`);
}

function renderMarkdown(
  report: ReturnType<typeof Object>,
  nodeids: string[],
  candAgg: Record<string, NodeAggregate>,
  baseAgg: Record<string, NodeAggregate>,
): string {
  const r = report as any;
  const rateCell = (s?: Series) => (s && s.total ? `${Math.round(s.rate * 100)}% (${s.passed}/${s.total})` : "—");
  const lines: string[] = [];
  lines.push(`# Benchmark — ${r.metadata.pattern}`);
  lines.push("");
  lines.push(
    `Task model \`${r.metadata.task_model}\` · judge \`${r.metadata.judge_model}\` · ` +
      `${r.metadata.runs_per_configuration} runs/config · sha \`${r.metadata.git_sha}${r.metadata.dirty ? "-dirty" : ""}\` · ${r.metadata.timestamp}`,
  );
  lines.push("");
  lines.push("## Summary (per configuration)");
  lines.push("");
  lines.push("| metric | candidate | baseline |");
  lines.push("|---|---|---|");
  lines.push(`| pass_rate | ${pct(r.run_summary.candidate.pass_rate)} | ${pct(r.run_summary.baseline.pass_rate)} |`);
  lines.push(`| tokens_out | ${cell(r.run_summary.candidate.outputTokens)} | ${cell(r.run_summary.baseline.outputTokens)} |`);
  lines.push(`| duration_ms | ${cell(r.run_summary.candidate.durationMs)} | ${cell(r.run_summary.baseline.durationMs)} |`);
  lines.push(`| num_turns | ${cell(r.run_summary.candidate.numTurns)} | ${cell(r.run_summary.baseline.numTurns)} |`);
  lines.push("");
  lines.push(`**Lift:** ${Math.round(r.delta.pass_rate * 100)}% pass rate (candidate − baseline).`);
  lines.push("");
  lines.push("## Per-practice matrix");
  lines.push("");
  lines.push("| test / practice | candidate | baseline |");
  lines.push("|---|---|---|");
  for (const id of nodeids) {
    const short = id.split(" > ").slice(-1)[0];
    lines.push(`| **${short}** | ${rateCell(candAgg[id]?.pass)} | ${rateCell(baseAgg[id]?.pass)} |`);
    const texts = [...new Set([...Object.keys(candAgg[id]?.practices ?? {}), ...Object.keys(baseAgg[id]?.practices ?? {})])];
    for (const t of texts) {
      lines.push(`| ${t} | ${rateCell(candAgg[id]?.practices[t])} | ${rateCell(baseAgg[id]?.practices[t])} |`);
    }
  }
  lines.push("");
  lines.push("## Flags");
  lines.push("");
  if (!r.flags.length) lines.push("_none_");
  for (const f of r.flags as { nodeid: string; practice?: string; flags: Flag[] }[]) {
    const where = f.practice ? `${f.nodeid.split(" > ").slice(-1)[0]} — ${f.practice}` : f.nodeid.split(" > ").slice(-1)[0];
    lines.push(`- \`${f.flags.join(", ")}\` — ${where}`);
  }
  lines.push("");
  return lines.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
