/**
 * Built-in skills used by the seed.
 *
 * A skill is a reusable block of review rules that any agent can link. Its body
 * is injected into the agent's prompt as INSTRUCTIONS, in the `## Skills / rules`
 * section, in the order configured on the agent — so a body is written the way
 * you would write the middle of a system prompt, not as reference documentation.
 *
 * Deliberately narrow. Each of these states ONE checkable rule, because the
 * point of the unit is that two agents can share it and a user can turn it off
 * to see the difference in a review.
 *
 * Note what is NOT here: `flaky-test-gate` ships as an importable file under
 * `docs/skills/` instead of being seeded, so the import path gets exercised on a
 * real skill rather than a throwaway.
 */

import type { SkillType } from '@devdigest/shared';

export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

export const UNCOVERED_BRANCH_GATE: SeedSkill = {
  name: 'uncovered-branch-gate',
  description:
    'Use when a diff changes control flow — an if, a ternary, a catch, an early return, a switch — to check every new branch is reached by a test.',
  type: 'rubric',
  body: `## Uncovered branches

Enumerate every branch this diff ADDS or CHANGES in production code: each arm of
an \`if\` / \`else\`, each ternary, each \`case\`, each \`catch\`, each early
return, each short-circuit (\`??\`, \`||\`, \`?.\`) that can now take a different
path.

For each one, find the test that reaches it. Read the assertions — a test that
executes a branch without asserting anything about its effect does not cover it.

Report a branch with no test as CRITICAL when it changes observable behaviour,
naming the branch and what would break silently. A test suite that exercises only
the happy path of a changed function is the single most common instance of this,
and it is a finding even when the happy-path test is well written.

Do not ask for a test that would only restate the implementation, and do not
count coverage percentages — the unit is the branch.`,
};

export const BOUNDARY_CASE_CHECKLIST: SeedSkill = {
  name: 'boundary-case-checklist',
  description:
    'Use when a diff adds a test for logic that takes a collection, a number, a string, or an optional value, to check the edges are pinned and not just the middle.',
  type: 'rubric',
  body: `## Boundary cases

For each input the changed code accepts, check the edge as well as the middle:

- Collections — empty, exactly one, and the size that trips a limit or a page.
- Numbers — zero, negative, the boundary itself and both sides of it.
- Strings — empty, whitespace-only, and past any length cap.
- Optionals — absent, null, and present-but-empty, when the code treats them
  differently.
- Ordering — the first and last element, when position affects the result.

Report a missing edge as WARNING, naming the specific value and the behaviour it
would expose. Report it as CRITICAL only when the edge is the case the diff
exists to handle.

An edge that behaves identically to the middle does not need its own test. Say so
rather than asking for one.`,
};

export const MOCK_OVERUSE_GATE: SeedSkill = {
  name: 'mock-overuse-gate',
  description:
    'Use when a test file adds stubs, spies, or fakes, to check the mocking stops short of the behaviour under test.',
  type: 'convention',
  body: `## Mock overuse

A mock is for the outside world — network, clock, filesystem, LLM, database when
the test is not about SQL. It is not for the unit under test.

Flag as CRITICAL a test that mocks the thing it claims to verify: stubbing the
function being tested, asserting only that a mock was called, or replacing the
logic with a fake that encodes the expected answer. Such a test passes when the
implementation is deleted.

Flag as WARNING a test whose mocks pin an implementation rather than a contract —
asserting call counts and argument order where the observable result would do —
because it will fail on a harmless refactor.

Prefer the real collaborator when it is hermetic and fast. A mock that exists
only to make an already-hermetic dependency "isolated" is worth removing.`,
};

export const BREAKING_CHANGE_GATE: SeedSkill = {
  name: 'breaking-change-gate',
  description:
    'Use when a diff changes a route, a request or response schema, an exported signature, or a DB column, to classify it as breaking or additive for existing callers.',
  type: 'rubric',
  body: `## Breaking changes

For every changed route, schema, exported signature and column, classify the
change from the caller's side:

BREAKING (CRITICAL) — an existing caller stops working with no migration path:
- a removed or renamed route, path parameter, query parameter, or field;
- a request field that becomes required, or whose type narrows;
- a response field that is removed, renamed, or whose type narrows;
- a changed status code, error code, or error body shape;
- a dropped or narrowed column, which breaks every row already written.

ADDITIVE (not a finding) — an optional request field, a new response field, a
widened union, a new route, a new nullable column.

Name the caller that breaks — a client page, the CI runner, another package,
persisted rows — and state the migration that would make the change safe.
"Something might depend on this" is not a finding; find the dependant or drop it.`,
};

export const CONTRACT_COPY_DRIFT: SeedSkill = {
  name: 'contract-copy-drift',
  description:
    'Use when a diff touches a file under src/vendor/shared/, to check the server and client copies of the contract moved together.',
  type: 'convention',
  body: `## Vendored contract drift

\`@devdigest/shared\` exists as TWO independent copies —
\`server/src/vendor/shared/\` and \`client/src/vendor/shared/\` — with no sync
step between them. The server copy is canonical.

If this diff changes one copy and not the other, that is a finding, and it is
CRITICAL. Both packages typecheck green when the copies disagree, because each
one only ever sees its own; the drift surfaces later, at runtime, on whichever
field diverged.

Cite both paths: the file that changed and the twin that did not. The fix is
\`./scripts/check-contracts.sh --fix\` followed by \`cd client && pnpm typecheck\`,
because adopting new fields widens unions on the client side.

A change to only ONE copy is a finding even when that copy is the server's.`,
};

/** Skills seeded into a fresh workspace. */
export const SEED_SKILLS: readonly SeedSkill[] = [
  UNCOVERED_BRANCH_GATE,
  BOUNDARY_CASE_CHECKLIST,
  MOCK_OVERUSE_GATE,
  BREAKING_CHANGE_GATE,
  CONTRACT_COPY_DRIFT,
];

/**
 * Which skills each seeded agent links, IN PROMPT ORDER. The rubric goes first
 * so the narrower conventions are read against it.
 */
export const SEED_AGENT_SKILLS: Readonly<Record<string, readonly string[]>> = {
  'Test Quality Reviewer': [
    UNCOVERED_BRANCH_GATE.name,
    BOUNDARY_CASE_CHECKLIST.name,
    MOCK_OVERUSE_GATE.name,
  ],
  'API Contract Reviewer': [BREAKING_CHANGE_GATE.name, CONTRACT_COPY_DRIFT.name],
};
