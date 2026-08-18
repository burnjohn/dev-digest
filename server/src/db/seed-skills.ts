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

/**
 * The agents the seed attaches skills to. Named here rather than in `seed.ts`
 * because a skill declares its own binding below, and the seed looks the agent
 * up by name to resolve it.
 */
export const TEST_QUALITY_AGENT_NAME = 'Test Quality Reviewer';
export const API_CONTRACT_AGENT_NAME = 'API Contract Reviewer';

export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  /** Agent names this skill is linked to. Array order within an agent is prompt order. */
  agents: string[];
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

const CONTRACT_BREAKING_CHANGE = `# Contract breaking change

Every published route, field, status code and exported symbol already has a caller you
cannot see and cannot update. Report a finding when this diff would break one of them.

- **Removed or renamed in place** — a response field, route, query or path parameter, enum
  member, or exported symbol. A rename is a removal plus an addition, not a rename.
- **Moved** — the URL path, HTTP method, or content type of an existing endpoint changed.
- **Newly required** — an optional request field made required, or a required field added
  with no default.
- **Narrowed** — a tighter pattern, a lower maximum, a smaller enum, or a stricter type on
  input that already validated.
- **Re-signalled** — 200 becoming 204, an empty list becoming a 404, an error body losing
  the \`code\` clients branch on.

Published means reachable today: a served route, a released export, a documented field.
Something added and then changed inside this same unreleased PR was never published. A
symbol no package entry point exports and no route reaches is internal — renaming it freely
is correct, and reporting it is a false positive.

Name the mechanism, not the category: which request stops working and how it fails — a 422
on a payload that worked yesterday, an \`undefined\` where a value was read. Cite the line
where the contract changes, once — not once per consumer or per generated artifact.`;

const RESPONSE_SHAPE_GUARD = `# Response shape guard

A response a client already parses may grow, and nothing else. Report a finding when a field
in a response this diff touches changes in any way other than being added as optional:

- A field's type changed, or a scalar was promoted to an object or array.
- A field that was always present became optional or nullable.
- An enum member disappeared from a response, or the value set widened where clients switch
  exhaustively over it.
- A default changed, or the unit or format changed while the type stayed the same — cents to
  dollars, seconds to milliseconds, ISO date to epoch. No compiler catches this one.
- The handler and its declared schema disagree: a field returned but not declared, or
  declared and no longer returned.

Assume a rolling deploy: for the length of the rollout an old client reads a new response.
A change that only works once both sides ship is a break even when both sides are in this PR.

The compatible shape is additive-optional, so say so — name the new field beside the old one
as the fix, rather than reporting that the shape changed.`;

const SEMVER_DISCIPLINE = `# Semver discipline

Breaking a contract is allowed. Shipping the break silently is not. This rule only fires once
you have already found a break — on a purely additive diff it produces nothing.

Check whether the diff carries a signal, in whatever form this repo already uses: a
\`package.json\` version bump matching the class of change (removal, narrowing, or a new
required input is major), a CHANGELOG entry naming the break and its migration, or a route
version segment where routes are versioned.

Report a finding when:
- A breaking change is smuggled into a patch or minor release.
- Something is deleted in the same PR that introduces its replacement, with no window between.
- A \`@deprecated\` marker names no replacement and no removal version.
- A deprecation lives only in a comment or CHANGELOG while the runtime says nothing.

Do not demand a bump, a \`Deprecation\` header, or an OpenAPI update this repo's own
conventions do not use — follow the pattern visible in the diff and the surrounding code.`;

/**
 * Seven skills across two agents: four judge the tests, three judge the public
 * contract. Each entry declares its own agent binding; `seed.ts` resolves the
 * name and keeps a per-agent order counter, so this array's order is the order
 * the model reads within each agent.
 */
export const SEED_SKILLS: SeedSkill[] = [
  {
    name: 'uncovered-branch-gate',
    description: 'Flags a new branch that no added or changed test exercises.',
    type: 'rubric',
    body: UNCOVERED_BRANCH_GATE,
    agents: [TEST_QUALITY_AGENT_NAME],
  },
  {
    name: 'corner-case-checklist',
    description: 'Walks empty/null/boundary/unicode/timezone/concurrency/error paths.',
    type: 'rubric',
    body: CORNER_CASE_CHECKLIST,
    agents: [TEST_QUALITY_AGENT_NAME],
  },
  {
    name: 'no-over-mocking',
    description: 'Catches tests that mock the unit under test or assert on mocks.',
    type: 'convention',
    body: NO_OVER_MOCKING,
    agents: [TEST_QUALITY_AGENT_NAME],
  },
  {
    name: 'flaky-test-patterns',
    description: 'Sleeps, real clocks, order dependence, shared state, real I/O.',
    type: 'custom',
    body: FLAKY_TEST_PATTERNS,
    agents: [TEST_QUALITY_AGENT_NAME],
  },
  {
    name: 'contract-breaking-change',
    description: 'Removed, renamed, moved, newly required or narrowed published surface.',
    type: 'rubric',
    body: CONTRACT_BREAKING_CHANGE,
    agents: [API_CONTRACT_AGENT_NAME],
  },
  {
    name: 'response-shape-guard',
    description: 'Type drift, present→nullable, dropped enum member, silent unit changes.',
    type: 'convention',
    body: RESPONSE_SHAPE_GUARD,
    agents: [API_CONTRACT_AGENT_NAME],
  },
  {
    name: 'semver-discipline',
    description: 'A break shipped with no version bump, changelog, or deprecation window.',
    type: 'rubric',
    body: SEMVER_DISCIPLINE,
    agents: [API_CONTRACT_AGENT_NAME],
  },
];
