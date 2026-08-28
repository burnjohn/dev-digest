/**
 * Version-over-version comparison from the local trend log (results/history.jsonl, written
 * by the trend reporter). Shows which eval tests flipped between two runs — the diagnostic
 * signal for "what improved, what regressed" after a change.
 *
 *   pnpm eval:compare            # last two runs
 *   pnpm eval:compare --list     # list recorded runs
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HISTORY = join(dirname(fileURLToPath(import.meta.url)), "..", "results", "history.jsonl");

interface Row { run_id: string; git_sha: string; nodeid: string; outcome: string }

function loadRuns(): Map<string, { sha: string; outcomes: Map<string, string> }> {
  const runs = new Map<string, { sha: string; outcomes: Map<string, string> }>();
  if (!existsSync(HISTORY)) return runs;
  for (const line of readFileSync(HISTORY, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line) as Row;
    const run = runs.get(r.run_id) ?? { sha: r.git_sha, outcomes: new Map() };
    run.outcomes.set(r.nodeid, r.outcome);
    runs.set(r.run_id, run);
  }
  return runs;
}

function main() {
  const args = process.argv.slice(2);
  const runs = loadRuns();
  if (runs.size === 0) {
    console.log("No runs recorded yet. Run `pnpm eval` first.");
    return;
  }
  if (args.includes("--list")) {
    for (const [id, r] of runs) {
      const passed = [...r.outcomes.values()].filter((o) => o === "pass").length;
      console.log(`${id}  sha ${r.sha.padEnd(16)} ${passed}/${r.outcomes.size} passed`);
    }
    return;
  }
  const ids = args.length === 2 ? args : [...runs.keys()].slice(-2);
  if (ids.length < 2) return console.log("Need at least two runs to compare.");
  const [a, b] = ids.map((id) => runs.get(id)!);
  console.log(`A ${ids[0]}  sha ${a.sha}`);
  console.log(`B ${ids[1]}  sha ${b.sha}`);
  if (a.sha === b.sha) console.log("note: same git sha — differences are run-to-run noise, not a version change.");

  const gained: string[] = [];
  const lost: string[] = [];
  for (const node of [...a.outcomes.keys()].sort()) {
    if (!b.outcomes.has(node)) continue;
    const oa = a.outcomes.get(node);
    const ob = b.outcomes.get(node);
    if (oa !== "pass" && ob === "pass") gained.push(node);
    else if (oa === "pass" && ob !== "pass") lost.push(node);
  }
  console.log(`\n✅ improved (fail→pass): ${gained.length}`);
  gained.forEach((n) => console.log(`   + ${n}`));
  console.log(`❌ regressed (pass→fail): ${lost.length}`);
  lost.forEach((n) => console.log(`   - ${n}`));
  if (!gained.length && !lost.length) console.log("\n(no flips between these runs)");
}

main();
