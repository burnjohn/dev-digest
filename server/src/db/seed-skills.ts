import type { SkillType } from '@devdigest/shared';

/**
 * Built-in skill bodies used by the seed (mirrors `seed-prompts.ts`).
 *
 * A skill is markdown that is injected verbatim into the review prompt's
 * `## Skills / rules` section for every agent it is linked to. It executes
 * nothing — no scripts, no hooks, no tools.
 *
 * Authoring rules, which differ from an agent system prompt:
 *  - A skill is a RULE, not a role. No "You are a…", no stack context, no
 *    severity rubric, no verdict semantics — the agent prompt already carries all
 *    of that, and repeating it gives the model two specs to reconcile.
 *  - Keep each one narrow enough that "did this skill fire?" is answerable by
 *    looking at a single finding.
 *  - Stay well under MAX_SKILL_BODY_CHARS (8000). Under `map-reduce` every body
 *    is re-sent on every file call, so length is a per-call cost.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

const UNCOVERED_BRANCH_GATE = `# Uncovered branch gate

Every branch this diff ADDS must have a test that actually executes it.

For each new \`if\` / \`else\` / \`switch\` case / ternary / \`catch\` / early return /
short-circuit (\`??\`, \`||\`, \`?.\`) in the diff, find the test that enters it. If no
added or changed test does, report it and name the exact branch.

The pattern to look for hardest: the happy path is tested, the failure path is not.
A guard clause added to fix a bug with no regression test pinning that bug is the
same defect.

Cite the untested production line, not the test file. Do not ask for "more
coverage" in the abstract — name the input that would reach the branch.

Out of scope: branches that existed before this diff and branches in generated
code, pure re-exports, or type-only changes.`;

const CORNER_CASE_CHECKLIST = `# Corner case checklist

For each behaviour this diff introduces, walk this list and report only the entries
the code actually branches on and the tests actually miss:

- **Empty** — empty string, empty array, empty object, no rows returned.
- **Null / undefined** — an absent optional, a nullable column, a missing key.
- **Zero and negative** — 0, -1, and NaN where a count, index, or amount is used.
- **Boundary** — \`<\` vs \`<=\`, first and last element, exactly-at-the-limit, one
  over the limit, a single-element collection.
- **Unicode and length** — multi-byte characters, combining marks, and very long
  input wherever the code slices, counts, truncates, or pads.
- **Time** — timezone boundaries, DST transitions, and clock skew wherever dates
  are compared or formatted.
- **Concurrency** — two callers racing the same row or the same cache key;
  read-modify-write without a lock.
- **Error path** — a rejected promise, a thrown adapter error, a non-2xx response.

One finding per genuinely missed case, naming the concrete input. An entry the code
never branches on is not a finding — do not report the whole checklist.`;

const NO_OVER_MOCKING = `# No over-mocking

A test must be able to fail for the reason it claims to test.

Report a finding when:
- The unit under test is itself mocked, so the assertion says nothing about it.
- The assertion is on the mock (\`toHaveBeenCalledWith\`) where an observable return
  value or side effect was available to assert on instead.
- A mock hard-codes a shape the real collaborator no longer returns — the test
  passes while production is broken.
- Mocking reaches so deep that deleting the implementation would leave the test
  green.

Mock at the boundary the codebase already mocks at: adapters on the server, the
data-hook layer on the client. Mocking one layer below that is the smell.

Legitimate mocking is not a finding: network, clock, randomness, and paid external
calls should be faked.`;

const FLAKY_TEST_PATTERNS = `# Flaky test patterns

Report a finding for any of these in a test file in the diff:

- **Arbitrary waits** — \`sleep\`, \`setTimeout\`, or a fixed delay used to sequence
  async work instead of awaiting the actual signal.
- **Real clock or randomness** — \`Date.now()\`, \`new Date()\`, \`Math.random()\`, or
  \`crypto.randomUUID()\` where the assertion depends on the value.
- **Order dependence** — a test that only passes after another one has run, or that
  reads state a sibling wrote.
- **Shared mutable state** — a module-level array or object mutated across tests, a
  mock that is never reset, a DB row two tests both write.
- **Real I/O in a hermetic test** — network, filesystem, or a subprocess in a test
  that is not suffixed \`.it.test.ts\`.
- **Missing \`.it.test.ts\` suffix** on a DB-backed test — it runs in the wrong,
  Docker-less CI lane and fails confusingly.
- **Leftover \`.only\` or \`.skip\`** in the diff.

Each of these fails intermittently, which costs more than a test that never
existed: a suite people learn to re-run is a suite people stop trusting.`;

/** The four skills seeded alongside the Test Quality Reviewer agent. */
export const SEED_SKILLS: SeedSkill[] = [
  {
    name: 'uncovered-branch-gate',
    description: 'Flags a new branch that no added or changed test exercises.',
    type: 'rubric',
    body: UNCOVERED_BRANCH_GATE,
  },
  {
    name: 'corner-case-checklist',
    description: 'Walks empty/null/boundary/unicode/timezone/concurrency/error paths.',
    type: 'rubric',
    body: CORNER_CASE_CHECKLIST,
  },
  {
    name: 'no-over-mocking',
    description: 'Catches tests that mock the unit under test or assert on mocks.',
    type: 'convention',
    body: NO_OVER_MOCKING,
  },
  {
    name: 'flaky-test-patterns',
    description: 'Sleeps, real clocks, order dependence, shared state, real I/O.',
    type: 'custom',
    body: FLAKY_TEST_PATTERNS,
  },
];
