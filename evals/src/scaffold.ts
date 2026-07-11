/**
 * Discover the skills/agents in .claude and scaffold eval files for one of them. Students bring
 * their own skill set, so this is how they add tests without hand-copying the file trio.
 *
 *   pnpm eval:scaffold                 # list every skill/agent and whether it has evals
 *   pnpm eval:scaffold <skill-name>    # create evals/skills/<name>/{<name>.eval.ts, .cases.ts, fixtures/}
 *   pnpm eval:scaffold --agent <name>  # same under evals/agents/<name>/
 *
 * Refuses to overwrite existing files.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GREEN, DIM, YELLOW, RESET } from "./ansi.js";
import { SKILLS_DIR, AGENTS_DIR, EVALS_DIR } from "./artifacts/paths.js";

function listSkills(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter((d) => statSync(join(SKILLS_DIR, d)).isDirectory() && existsSync(join(SKILLS_DIR, d, "SKILL.md")))
    .sort();
}

function listAgents(): string[] {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

const evalPath = (tier: "skills" | "agents", name: string) => join(EVALS_DIR, tier, name, `${name}.eval.ts`);
const hasEval = (tier: "skills" | "agents", name: string) => existsSync(evalPath(tier, name));

function list(): void {
  console.log(`\n${"=".repeat(56)}\nSkills (${SKILLS_DIR})\n${"=".repeat(56)}`);
  for (const s of listSkills()) {
    const mark = hasEval("skills", s) ? `${GREEN}✓ evals${RESET}` : `${DIM}— no evals${RESET}`;
    console.log(`  ${s.padEnd(32)} ${mark}`);
  }
  console.log(`\n${"=".repeat(56)}\nAgents (${AGENTS_DIR})\n${"=".repeat(56)}`);
  for (const a of listAgents()) {
    const mark = hasEval("agents", a) ? `${GREEN}✓ evals${RESET}` : `${DIM}— no evals${RESET}`;
    console.log(`  ${a.padEnd(32)} ${mark}`);
  }
  console.log(`\nScaffold one:  pnpm eval:scaffold <skill-name>   |   pnpm eval:scaffold --agent <agent-name>`);
}

function casesTemplate(kind: "Skill" | "Agent"): string {
  return `import type { ${kind}Case } from "../../src/index.js";

// To inline a fixture file into a prompt, uncomment these two lines and drop the file in
// fixtures/, then use fx("your-fixture.ext") inside a prompt string:
//   import { fixtureReader } from "../../src/index.js";
//   const fx = fixtureReader(import.meta.url);

export const cases: ${kind}Case[] = [
  {
    name: "TODO describe the good behavior this checks",
    kind: "quality",
    prompt: "TODO the user/task prompt the ${kind.toLowerCase()} should handle",
    practices: [
      "TODO a specific, binary, citable thing the answer must do",
      "TODO another one — keep each verifiable from a verbatim quote",
    ],
    // grounding: ["exact-substring-that-must-appear-before-judging"], // optional cheap gate
    // threshold: 0.6,
    // maxTurns: 8,
  },
  // Keep it minimal — one or two cases is enough to start.
];
`;
}

function evalTemplate(tier: "skills" | "agents", name: string): string {
  const describe = tier === "skills" ? "describeSkill" : "describeAgent";
  const run = tier === "skills" ? "runSkillCases" : "runAgentCases";
  return `import { ${describe}, ${run} } from "../../src/index.js";
import { cases } from "./${name}.cases.js";

${describe}("${name}", () => ${run}("${name}", cases));
`;
}

function scaffold(tier: "skills" | "agents", name: string): void {
  const kind = tier === "skills" ? "Skill" : "Agent";
  const available = tier === "skills" ? listSkills() : listAgents();
  if (!available.includes(name)) {
    console.error(`${YELLOW}warning:${RESET} '${name}' not found among ${tier} in .claude/ — scaffolding anyway.`);
    console.error(`  available ${tier}: ${available.join(", ") || "(none)"}`);
  }

  const dir = join(EVALS_DIR, tier, name);
  const files: [string, string][] = [
    [join(dir, `${name}.eval.ts`), evalTemplate(tier, name)],
    [join(dir, `${name}.cases.ts`), casesTemplate(kind)],
    [join(dir, "fixtures", ".gitkeep"), ""],
  ];

  const existing = files.filter(([f]) => existsSync(f)).map(([f]) => f);
  if (existing.length) {
    console.error(`${YELLOW}refusing to overwrite:${RESET}\n  ${existing.join("\n  ")}`);
    process.exit(1);
  }

  mkdirSync(join(dir, "fixtures"), { recursive: true });
  for (const [f, content] of files) writeFileSync(f, content);

  console.log(`${GREEN}scaffolded ${tier}/${name}:${RESET}`);
  for (const [f] of files) console.log(`  ${f.replace(EVALS_DIR + "/", "")}`);
  console.log(`\nNext: fill in ${name}.cases.ts, then run  pnpm vitest run ${tier}/${name}`);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) return list();
  const agentIdx = argv.indexOf("--agent");
  if (agentIdx !== -1) {
    const name = argv[agentIdx + 1];
    if (!name) return void console.error("usage: pnpm eval:scaffold --agent <agent-name>");
    return scaffold("agents", name);
  }
  scaffold("skills", argv[0]);
}

main();
