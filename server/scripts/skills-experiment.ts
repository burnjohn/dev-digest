/**
 * Control experiment: does linking a skill change the review?
 *
 * Runs each of the two new agents twice over the SAME diff with the SAME model —
 * once with no skills, once with its seeded skills — and prints both reviews
 * side by side plus the prompt-section sizes from the assembled prompt.
 *
 * It calls `reviewPullRequest` directly rather than driving the HTTP API, so the
 * only thing that differs between the two runs is the `skills` argument. No
 * database, no server, no GitHub: the fixtures below are the whole input.
 *
 *   cd server && pnpm experiment:skills            # both agents
 *   cd server && pnpm experiment:skills test       # one agent (name substring)
 *
 * Needs OPENROUTER_API_KEY, from ~/.devdigest/secrets.json or the environment.
 * It makes 2 model calls per agent and costs a fraction of a cent on the default
 * model; nothing is written anywhere.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { reviewPullRequest, OpenRouterProvider } from '@devdigest/reviewer-core';
import type { Finding } from '@devdigest/shared';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import {
  API_CONTRACT_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
} from '../src/db/seed-prompts.js';
import {
  BOUNDARY_CASE_CHECKLIST,
  BREAKING_CHANGE_GATE,
  CONTRACT_COPY_DRIFT,
  MOCK_OVERUSE_GATE,
  UNCOVERED_BRANCH_GATE,
  type SeedSkill,
} from '../src/db/seed-skills.js';

const MODEL = process.env.EXPERIMENT_MODEL ?? 'deepseek/deepseek-v4-flash';

/**
 * A test that exercises only the middle of the range, for a function whose whole
 * point is its two clamping branches. The base agent has no rubric telling it
 * that an unreached branch is a finding; `uncovered-branch-gate` does.
 */
const HAPPY_PATH_ONLY_DIFF = `diff --git a/src/modules/pulls/paging.ts b/src/modules/pulls/paging.ts
--- a/src/modules/pulls/paging.ts
+++ b/src/modules/pulls/paging.ts
@@ -1,3 +1,14 @@
 export const MAX_PAGE_SIZE = 100;
+
+/**
+ * Clamp a caller-supplied page size into [1, MAX_PAGE_SIZE].
+ * A size of 0 or below means "the caller did not choose" and gets the default.
+ */
+export function clampPageSize(size: number): number {
+  if (size > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
+  if (size < 1) return DEFAULT_PAGE_SIZE;
+  return size;
+}
+
+export const DEFAULT_PAGE_SIZE = 25;
diff --git a/test/paging.test.ts b/test/paging.test.ts
--- a/test/paging.test.ts
+++ b/test/paging.test.ts
@@ -1,2 +1,9 @@
 import { describe, it, expect } from 'vitest';
+import { clampPageSize } from '../src/modules/pulls/paging.js';
+
+describe('clampPageSize', () => {
+  it('returns the requested size', () => {
+    expect(clampPageSize(50)).toBe(50);
+  });
+});
`;

/**
 * A change that looks purely additive and IS additive — except that
 * `@devdigest/shared` is vendored as two independent copies and only the server
 * one moved. Both packages typecheck green; the client's `Repo` type simply does
 * not have the field, and the drift surfaces later at runtime.
 *
 * Chosen deliberately over an obvious break (a renamed response field, a
 * newly-required parameter). The base prompt's no-skills fallback already names
 * those, so the agent catches them either way and the experiment measures
 * nothing. This one is knowable ONLY from `contract-copy-drift`: nothing in the
 * diff says a second copy exists.
 */
const CONTRACT_DRIFT_DIFF = `diff --git a/src/vendor/shared/contracts/platform.ts b/src/vendor/shared/contracts/platform.ts
--- a/src/vendor/shared/contracts/platform.ts
+++ b/src/vendor/shared/contracts/platform.ts
@@ -40,6 +40,8 @@
 export const Repo = z.object({
   id: z.string(),
   full_name: z.string(),
   default_branch: z.string(),
+  /** Repo size in KB, from the GitHub API. Surfaced on the repo picker. */
+  size_kb: z.number().int().nullish(),
   last_polled_at: z.string().nullable(),
 });
diff --git a/src/modules/repos/service.ts b/src/modules/repos/service.ts
--- a/src/modules/repos/service.ts
+++ b/src/modules/repos/service.ts
@@ -60,6 +60,7 @@
   private toDto(row: RepoRow): Repo {
     return {
       id: row.id,
       full_name: row.fullName,
       default_branch: row.defaultBranch,
+      size_kb: row.sizeKb ?? null,
       last_polled_at: row.lastPolledAt?.toISOString() ?? null,
     };
   }
`;

interface Fixture {
  agent: string;
  systemPrompt: string;
  skills: SeedSkill[];
  diff: string;
  task: string;
  /** What the skills are supposed to make the agent notice. */
  expectation: string;
}

const FIXTURES: Fixture[] = [
  {
    agent: 'Test Quality Reviewer',
    systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
    skills: [UNCOVERED_BRANCH_GATE, BOUNDARY_CASE_CHECKLIST, MOCK_OVERUSE_GATE],
    diff: HAPPY_PATH_ONLY_DIFF,
    task: "Review PR #901 'Clamp the page size on /repos'",
    expectation: 'the two unreached clamping branches, and the boundary at exactly MAX_PAGE_SIZE',
  },
  {
    agent: 'API Contract Reviewer',
    systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
    skills: [BREAKING_CHANGE_GATE, CONTRACT_COPY_DRIFT],
    diff: CONTRACT_DRIFT_DIFF,
    task: "Review PR #902 'Surface repo size on the picker'",
    expectation:
      'that only the SERVER copy of the vendored contract moved — the client copy is now a generation behind',
  },
];

/** OPENROUTER_API_KEY from the local secrets file, falling back to the env. */
function apiKey(): string {
  try {
    const path = join(homedir(), '.devdigest', 'secrets.json');
    const secrets = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    if (secrets.OPENROUTER_API_KEY) return secrets.OPENROUTER_API_KEY;
  } catch {
    // No secrets file — fall through to the environment.
  }
  const fromEnv = process.env.OPENROUTER_API_KEY;
  if (!fromEnv) {
    throw new Error('OPENROUTER_API_KEY is not configured (~/.devdigest/secrets.json or env)');
  }
  return fromEnv;
}

function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) return '    (none)';
  return findings
    .map(
      (f) =>
        `    [${f.severity}] ${f.title}\n      ${f.file}:${f.start_line}-${f.end_line}` +
        `\n      ${f.rationale.replace(/\s+/g, ' ').slice(0, 160)}`,
    )
    .join('\n');
}

async function runOnce(fixture: Fixture, withSkills: boolean) {
  const llm = new OpenRouterProvider(apiKey());
  const outcome = await reviewPullRequest({
    systemPrompt: fixture.systemPrompt,
    model: MODEL,
    diff: parseUnifiedDiff(fixture.diff),
    llm,
    strategy: 'single-pass',
    task: fixture.task,
    ...(withSkills ? { skills: fixture.skills.map((s) => s.body) } : {}),
  });
  return outcome;
}

const SEVERITY_RANK = { SUGGESTION: 1, WARNING: 2, CRITICAL: 3 } as const;

/** Highest severity in a review, or null for an empty findings list. */
function topSeverity(findings: Finding[]): keyof typeof SEVERITY_RANK | null {
  let top: keyof typeof SEVERITY_RANK | null = null;
  for (const f of findings) {
    if (!top || SEVERITY_RANK[f.severity] > SEVERITY_RANK[top]) top = f.severity;
  }
  return top;
}

interface Sample {
  verdict: string;
  top: string;
  findings: number;
  blocks: boolean;
}

/**
 * Run one condition N times.
 *
 * N > 1 is not padding. The model is stochastic, and a single pair of runs is
 * not evidence: an early version of this script reported "0 findings without
 * skills" once and "1 WARNING without skills" on the very next invocation of the
 * same input. What is stable across repeats is the SEVERITY and the VERDICT —
 * and since only CRITICAL trips the merge gate, that is also the difference that
 * matters operationally.
 */
async function sample(fixture: Fixture, withSkills: boolean, runs: number) {
  const outcomes = await Promise.all(
    Array.from({ length: runs }, () => runOnce(fixture, withSkills)),
  );
  const samples: Sample[] = outcomes.map((o) => ({
    verdict: o.review.verdict,
    top: topSeverity(o.review.findings) ?? '—',
    findings: o.review.findings.length,
    blocks: o.review.findings.some((f) => f.severity === 'CRITICAL'),
  }));
  return { outcomes, samples };
}

function tally(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].map(([v, n]) => `${v}×${n}`).join(', ');
}

async function main() {
  const args = process.argv.slice(2);
  const runsFlag = args.findIndex((a) => a === '--runs');
  const runs = runsFlag === -1 ? 3 : Number(args[runsFlag + 1] ?? 3);
  const filter = args.find((a) => !a.startsWith('--') && a !== String(runs))?.toLowerCase();

  const fixtures = filter
    ? FIXTURES.filter((f) => f.agent.toLowerCase().includes(filter))
    : FIXTURES;

  if (fixtures.length === 0) {
    console.error(`No agent matches "${filter}". Known: ${FIXTURES.map((f) => f.agent).join(', ')}`);
    process.exit(1);
  }
  if (!Number.isInteger(runs) || runs < 1) {
    console.error(`--runs must be a positive integer, got "${runs}"`);
    process.exit(1);
  }

  console.log(`model: ${MODEL}   runs per condition: ${runs}\n`);

  for (const fixture of fixtures) {
    console.log('='.repeat(78));
    console.log(fixture.agent);
    console.log(`  looking for: ${fixture.expectation}`);
    console.log('='.repeat(78));

    const [without, with_] = await Promise.all([
      sample(fixture, false, runs),
      sample(fixture, true, runs),
    ]);

    for (const [label, result] of [
      ['WITHOUT skills', without],
      ['WITH skills', with_],
    ] as const) {
      const first = result.outcomes[0]!;
      // Show a run that actually found something. Printing run 0's empty list
      // under a "3/5 runs block merge" tally reads as a contradiction; the
      // index is labelled so the sample is never mistaken for the summary.
      const shownIndex = Math.max(
        0,
        result.outcomes.findIndex((o) => o.review.findings.length > 0),
      );
      const shown = result.outcomes[shownIndex]!;
      const skills = (first.assembly.section_sizes ?? []).find((s) => s.section === 'skills');
      console.log(`\n  ${label}`);
      console.log(
        `    prompt: ` +
          (skills
            ? `skills block ${skills.chars} chars, ≈${skills.est_tokens} tokens (estimate)`
            : 'no skills block'),
      );
      console.log(`    verdict:  ${tally(result.samples.map((s) => s.verdict))}`);
      console.log(`    severity: ${tally(result.samples.map((s) => s.top))}`);
      console.log(
        `    blocks merge: ${result.samples.filter((s) => s.blocks).length}/${runs} runs`,
      );
      console.log(`    findings, run ${shownIndex + 1} of ${runs} (${shown.review.findings.length}):`);
      console.log(renderFindings(shown.review.findings));
    }

    const blocksWithout = without.samples.filter((s) => s.blocks).length;
    const blocksWith = with_.samples.filter((s) => s.blocks).length;
    console.log(
      `\n  → merge-blocking verdict in ${blocksWithout}/${runs} runs without skills, ` +
        `${blocksWith}/${runs} with.\n` +
        '    Compare the finding text too — the count is the weakest signal here.\n',
    );
  }
}

main().catch((err) => {
  console.error('experiment failed:', err);
  process.exit(1);
});
