/**
 * DevDigest web e2e runner — Vercel agent-browser, deterministic, no LLM.
 *
 * agent-browser is a CDP browser-automation CLI (not a test framework), so we
 * define a thin convention: each flow is a `specs/*.flow.json` file listing
 * agent-browser commands. Commands share one browser session (the daemon keeps
 * the page between invocations). A command that exits non-zero — including a
 * `wait --text` / `wait --url` whose condition never holds — fails the step and
 * the flow. We add only light substring checks on top.
 *
 * Env:
 *   E2E_BASE_URL       web app origin (default http://localhost:3000)
 *   AGENT_BROWSER_BIN  binary name/path (default "agent-browser")
 *   E2E_STEP_TIMEOUT   per-command timeout in ms (default 60000)
 *
 * Specs target read-only seeded data, so nothing here triggers an LLM call or
 * needs an API key. Run order is the lexical order of the spec filenames.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  orderFlows,
  resolveArgs,
  stdoutContains,
  summarize,
  type Flow,
  type FlowResult,
  type StepResult,
} from "./lib/assert.js";

const exec = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = join(HERE, "specs");
const RESULTS_DIR = join(HERE, "test-results");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const BIN = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const STEP_TIMEOUT = Number(process.env.E2E_STEP_TIMEOUT ?? 60_000);

/** Run one agent-browser command; resolve with its stdout, reject on non-zero exit. */
async function ab(args: string[]): Promise<string> {
  const { stdout } = await exec(BIN, args, {
    cwd: HERE,
    timeout: STEP_TIMEOUT,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout ?? "";
}

function loadFlows(): { file: string; flow: Flow }[] {
  // Read-only flows first, mutating flows (`"mutates": true`) last — never by
  // lexical accident: all flows share one seeded DB and one browser session.
  return orderFlows(
    readdirSync(SPECS_DIR)
      .filter((f) => f.endsWith(".flow.json"))
      .sort()
      .map((file) => ({
        file,
        flow: JSON.parse(readFileSync(join(SPECS_DIR, file), "utf8")) as Flow,
      })),
  );
}

async function runFlow(file: string, flow: Flow): Promise<FlowResult> {
  const id = file.replace(/\.flow\.json$/, "");
  console.log(`\n▶ ${flow.name}  (${file})`);
  const steps: StepResult[] = [];

  for (const step of flow.steps) {
    const args = resolveArgs(step.cmd, BASE);
    const label = step.label ?? args.join(" ");
    try {
      const stdout = await ab(args);
      if (step.assert?.stdoutIncludes && !stdoutContains(stdout, step.assert.stdoutIncludes)) {
        steps.push({ label, ok: false, detail: `stdout missing "${step.assert.stdoutIncludes}"` });
        console.log(`   ✗ ${label} — assertion failed`);
        break;
      }
      steps.push({ label, ok: true });
      console.log(`   ✓ ${label}`);
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      steps.push({ label, ok: false, detail: msg });
      console.log(`   ✗ ${label} — ${msg}`);
      // Best-effort failure screenshot for the artifact upload.
      mkdirSync(RESULTS_DIR, { recursive: true });
      await ab(["screenshot", join(RESULTS_DIR, `${id}-fail.png`)]).catch(() => {});
      break;
    }
  }

  const ok = steps.every((s) => s.ok);
  return { name: flow.name, ok, steps };
}

async function main(): Promise<void> {
  console.log(`DevDigest e2e — base=${BASE} bin=${BIN}`);
  const flows = loadFlows();
  if (flows.length === 0) {
    console.error(`No specs found in ${SPECS_DIR}`);
    process.exit(1);
  }

  const results: FlowResult[] = [];
  try {
    for (const { file, flow } of flows) {
      results.push(await runFlow(file, flow));
    }
  } finally {
    // Tear down the shared browser session regardless of outcome.
    await ab(["close"]).catch(() => {});
  }

  console.log(`\n${summarize(results)}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error(`e2e runner crashed: ${(e as Error).message}`);
  process.exit(1);
});
