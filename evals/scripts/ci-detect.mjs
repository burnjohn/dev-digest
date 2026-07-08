/**
 * CI change detector for the harness evals.
 *
 * Reads a newline-separated list of changed files (repo-relative) from $CHANGED_FILES and maps
 * them onto the eval suites that should run for this PR:
 *
 *   .claude/skills/<name>/**   OR  evals/skills/<name>/**   → run evals/skills/<name>  (content tier)
 *   .claude/agents/<name>.md   OR  evals/agents/<name>/**   → run evals/agents/<name>  (tool tier)
 *   CLAUDE.md / .claude/CLAUDE.md / any agent / engine change → run the workflow tier
 *
 * A changed artifact with NO written evals is NOT a failure: it is reported on the `skipped_*`
 * outputs so the job can print a visible "SKIP <name> (no evals)" line instead of going red.
 *
 * Emits GitHub Actions step outputs (skills, agents, run_workflow, skipped_skills, skipped_agents)
 * to $GITHUB_OUTPUT. Pure filesystem + string work — no deps.
 */

import { existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(EVALS_DIR, "..");

const changed = (process.env.CHANGED_FILES ?? "")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

/** Does evals/<tier>/<name>/ contain at least one *.eval.ts? */
function hasEvals(tier, name) {
  const dir = join(EVALS_DIR, tier, name);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".eval.ts"));
}

/**
 * Does the artifact under test exist on this checkout? Evals can outlive their artifact (e.g. an
 * A/B variant's eval merged without the variant's agent .md) — running such a suite is a
 * guaranteed `agent not found` crash, so it must be skipped, not run.
 */
function hasArtifact(tier, name) {
  return tier === "skills"
    ? existsSync(join(REPO_ROOT, ".claude", "skills", name, "SKILL.md"))
    : existsSync(join(REPO_ROOT, ".claude", "agents", `${name}.md`));
}

/** Collect distinct artifact names touched under a `.claude` and/or `evals` prefix. */
function touched(reClaude, reEvals) {
  const names = new Set();
  for (const f of changed) {
    const m = f.match(reClaude) ?? f.match(reEvals);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

const skillNames = touched(
  /^\.claude\/skills\/([^/]+)\//,
  /^evals\/skills\/([^/]+)\//,
);
// README.md sits next to the agent definitions but is not an agent — without the filter an edit
// to it would register a phantom "README" agent AND re-trigger the (expensive) workflow tier.
const agentNames = touched(
  /^\.claude\/agents\/([^/]+)\.md$/,
  /^evals\/agents\/([^/]+)\//,
).filter((n) => n.toLowerCase() !== "readme");

/**
 * Why a changed suite must NOT run on CI (null = runnable). A `.ci-skip` marker file in the
 * suite dir opts an experiment out of gating (e.g. an A/B variant whose cases are EXPECTED to
 * fail at threshold 1.0 — it exists for eval:repeat/eval:delta, not for pass/fail).
 */
function skipReason(tier, name) {
  if (!hasEvals(tier, name)) return "no evals";
  if (!hasArtifact(tier, name)) return "artifact missing in .claude";
  if (existsSync(join(EVALS_DIR, tier, name, ".ci-skip"))) return "marked .ci-skip (experiment, not a gate)";
  return null;
}

const skills = skillNames.filter((n) => !skipReason("skills", n));
const skippedSkills = skillNames.filter((n) => skipReason("skills", n));
const agents = agentNames.filter((n) => !skipReason("agents", n));
const skippedAgents = agentNames.filter((n) => skipReason("agents", n));

// The workflow tier measures the LIVE harness, so anything that changes it re-triggers it:
// the root or .claude CLAUDE.md, any agent definition, the workflow cases, or the engine itself.
const runWorkflow = changed.some(
  (f) =>
    f === "CLAUDE.md" ||
    f === ".claude/CLAUDE.md" ||
    (/^\.claude\/agents\/.+\.md$/.test(f) && !/\/readme\.md$/i.test(f)) ||
    /^evals\/workflow\//.test(f) ||
    /^evals\/src\//.test(f),
);

const out = process.env.GITHUB_OUTPUT;
const write = (k, v) => (out ? appendFileSync(out, `${k}=${v}\n`) : console.log(`${k}=${v}`));

write("skills", JSON.stringify(skills));
write("agents", JSON.stringify(agents));
write("run_workflow", String(runWorkflow));
write("skipped_skills", skippedSkills.join(" "));
write("skipped_agents", skippedAgents.join(" "));

// Human-readable summary in the step log.
console.error("── eval change detection ──");
console.error(`changed files : ${changed.length}`);
console.error(`skills → run  : ${skills.join(", ") || "(none)"}`);
console.error(`agents → run  : ${agents.join(", ") || "(none)"}`);
console.error(`workflow tier : ${runWorkflow ? "run" : "skip"}`);
for (const n of skippedSkills) console.error(`SKIP skill ${n} — ${skipReason("skills", n)}`);
for (const n of skippedAgents) console.error(`SKIP agent ${n} — ${skipReason("agents", n)}`);

// Markdown summary on the run page (GITHUB_STEP_SUMMARY), so the trigger-table outcome is
// visible without opening the step log.
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) {
  const row = (label, run, skipped) =>
    `| ${label} | ${run.length ? run.map((n) => `\`${n}\``).join(", ") : "—"} | ${
      skipped.length ? skipped.map((n) => `\`${n}\``).join(", ") : "—"
    } |`;
  appendFileSync(
    summaryFile,
    [
      "### Eval change detection",
      "",
      `Changed files: **${changed.length}**`,
      "",
      "| Tier | Runs | Skipped (no evals) |",
      "|---|---|---|",
      row("skills", skills, skippedSkills),
      row("agents", agents, skippedAgents),
      `| workflow | ${runWorkflow ? "**run**" : "—"} | |`,
      "",
    ].join("\n"),
  );
}
