import type { SkillType } from '@devdigest/shared';

/**
 * Starter skills seeded alongside the built-in agents.
 *
 * A skill is TEXT AND CONFIG ONLY — it is appended to an agent's prompt and
 * never executed. `description` is the skill's interface: it is written as a
 * directive so an agent reads it as "when this applies, do this".
 *
 * `agents` names the seeded agents that link this skill, in the order the skill
 * should appear in each of their prompts.
 */
export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  agents: string[];
}

export const SEED_SKILLS: SeedSkill[] = [
  {
    name: 'test-coverage-nudge',
    description:
      'When the diff changes conditional logic, check that every branch of it is exercised by a test.',
    type: 'custom',
    agents: ['Test Quality Reviewer'],
    body: `## Branch coverage of changed logic

For every conditional the diff adds or changes — \`if\`/\`else\`, ternary, \`switch\`
case, early return, \`catch\`, optional chaining that can short-circuit, default
parameter — locate the test that exercises EACH side of it.

Report a finding when a side has no test. Name the branch by file and line, and
state the input that would reach it.

Do not report:
- branches in code the diff did not touch;
- a branch covered indirectly by a test that would fail if the branch broke.

A test that exercises a branch without asserting anything about its effect does
not count as coverage — say so explicitly when you see it.`,
  },
  {
    name: 'corner-case-checklist',
    description:
      'When reviewing tests, walk this checklist of boundary conditions and report the ones nothing covers.',
    type: 'rubric',
    agents: ['Test Quality Reviewer'],
    body: `## Corner cases to check for

Walk this list against the changed behaviour. Report only the entries that are
BOTH plausible for this code and untested.

- **Emptiness** — empty string, empty array/object, empty result set, no rows.
- **Cardinality** — zero, exactly one, many; the difference between them often
  hides a \`[0]\` or a missing loop.
- **Boundaries** — first/last element, off-by-one on ranges and slices, min/max
  numeric values, exactly-at-the-limit inputs.
- **Absence** — null, undefined, a missing optional field, a field present but
  empty.
- **Text** — unicode, emoji, very long strings, whitespace-only, embedded quotes
  or delimiters that could break parsing.
- **Ordering** — unordered inputs asserted in a fixed order, duplicate entries,
  stability of a sort.
- **Repetition** — calling twice (idempotence), concurrent invocation, retry
  after failure.
- **Time** — timezone, DST boundary, clock-dependent assertions.

For each gap: name the case, the file:line of the code that would mishandle it,
and the assertion you would add.`,
  },
  {
    name: 'mocking-smells',
    description:
      'When a test uses mocks, check that it still proves something about the real code.',
    type: 'convention',
    agents: ['Test Quality Reviewer'],
    body: `## Mocking smells

Flag a test when the mocking has hollowed it out:

- **The subject is mocked.** The unit under test is itself stubbed, so the test
  asserts the stub.
- **Assertion on the mock, not the effect.** The test only checks that a mock was
  called (\`toHaveBeenCalledWith\`) when the observable result could be asserted
  instead.
- **The fixture encodes the answer.** The mock returns exactly the value the
  assertion expects, so the transformation being tested is a pass-through.
- **Everything is mocked.** Every collaborator is faked, including ones that are
  pure and cheap to use for real.
- **The mock has drifted.** The mock's shape no longer matches the real
  collaborator's signature, so the test would pass against code that cannot work.

For each: name the mock, say what the test currently proves, and what it should
assert instead.`,
  },
  {
    name: 'contract-breaking-change',
    description:
      'When the diff changes a route signature, request/response shape or status code, classify it as breaking or compatible.',
    type: 'rubric',
    agents: ['API Contract Reviewer'],
    body: `## Breaking vs compatible

Classify every change to a public surface. BREAKING means an existing caller,
written against the previous version and unchanged, stops working.

**Breaking — report as CRITICAL**
- Removing or renaming a request or response field.
- Adding a required request field, or making an optional one required.
- Narrowing a type, enum, or validation rule on input.
- Changing a response field's type or making a non-null field nullable.
- Changing a status code, error code, or error body shape.
- Changing a route path, method, or parameter name/order.
- Removing a default that callers relied on, or changing what it means.

**Compatible — do not report as breaking**
- Adding an optional request field with a default.
- Adding a response field (unless the consumer validates strictly and rejects
  unknown keys — check whether it does before deciding).
- Loosening input validation.

For every breaking change, name the caller that breaks and give the compatible
alternative: a new optional field, a new route/version, or a deprecation window.

### Bad — a rename, dressed as a cleanup

\`\`\`diff
 export const Repo = z.object({
   id: z.string(),
-  full_name: z.string(),
+  fullName: z.string(),
 });
\`\`\`

Every consumer reading \`full_name\` now reads \`undefined\`. Nothing fails at build
time on the other side of the wire. CRITICAL.

### Good — additive, with the old field kept until callers move

\`\`\`diff
 export const Repo = z.object({
   id: z.string(),
-  full_name: z.string(),
+  /** @deprecated use fullName; removed in v3 */
+  full_name: z.string(),
+  fullName: z.string(),
 });
\`\`\`

Both shapes ship, old callers keep working, and the removal is a separate,
announced change.`,
  },
  {
    name: 'response-shape-guard',
    description:
      'When a handler changes what it returns, check the declared schema and every copy of the contract agree with it.',
    type: 'convention',
    agents: ['API Contract Reviewer'],
    body: `## The handler and the contract must agree

For each route the diff touches:

1. Compare what the handler actually returns against the response schema it
   declares. Extra fields that no schema mentions leak; missing fields break the
   consumer. A route with NO declared response schema and a changed return shape
   is itself worth a finding.
2. Check the DTO mapping. A row→DTO function that gained a field, dropped one, or
   changed a null default changes the wire contract even when the route did not.
3. Check every copy of the contract. When a schema is duplicated across packages,
   a change to one copy leaves the other stale — producer and consumer now
   disagree, and nothing will fail at build time.

Report the specific field, both sides of the disagreement, and which one is
wrong.

### Bad — the handler and its declared schema drift apart

\`\`\`ts
// route declares: response: { 200: z.object({ id: z.string(), score: z.number() }) }
return { id: row.id, score: row.score, internalNotes: row.notes };
\`\`\`

\`internalNotes\` is either stripped silently or leaks, depending on whether the
serializer is active. Neither is what the author intended, and no test says so.

### Good — one shape, declared and returned

\`\`\`ts
// response: { 200: ReviewDto }
return ReviewDto.parse({ id: row.id, score: row.score });
\`\`\`

### Bad — a DTO mapper changing the wire contract with no route change

\`\`\`diff
 export function toRepoDto(row: RepoRow): Repo {
-  return { id: row.id, full_name: row.fullName, clone_path: row.clonePath };
+  return { id: row.id, full_name: row.fullName };
 }
\`\`\`

The route is untouched, so the diff reads as internal — but \`clone_path\` just
disappeared from every response. Report it as a response change, not a refactor.`,
  },
  {
    name: 'semver-discipline',
    description:
      'When the diff changes a public contract, decide which version bump it forces and check the change carries it.',
    type: 'rubric',
    agents: ['API Contract Reviewer'],
    body: `## Which bump does this change force?

Decide the bump from the CALLER's perspective, never from the size of the diff.
A one-line change can be major; a 400-line refactor is usually patch.

**MAJOR — an existing caller must change to keep working**
- A removed, renamed, or retyped field on a request or response.
- A new required input, or an optional input made required.
- A narrowed enum, tightened validation, changed status code or error shape.
- A changed route path, method, parameter name or order.
- A removed exported symbol, or a changed signature of one.

**MINOR — new surface, nothing existing moves**
- A new route, a new optional request field, a new response field.
- A new enum member on OUTPUT only. (On input it is minor; on output it is major
  for any consumer that exhaustively switches — say so and let the author decide.)

**PATCH — no observable contract change**
- Internal refactor, performance work, comment and test changes, a bug fix that
  makes behaviour match the documented contract.

### What to report

A major-forcing change is only complete when the version moves with it. Check the
package manifest in the diff, or say plainly that it is missing:

### Bad — major change, patch bump

\`\`\`diff
-  "version": "2.4.1",
+  "version": "2.4.2",
...
-  status: z.enum(['open', 'merged', 'closed']),
+  status: z.enum(['open', 'merged']),
\`\`\`

A caller sending \`closed\` now gets a validation error from a patch release.

### Good — the bump matches the break

\`\`\`diff
-  "version": "2.4.1",
+  "version": "3.0.0",
\`\`\`

If the repo is pre-1.0 or unversioned, say which bump the change WOULD force and
what the release note must tell callers — do not skip the finding for lack of a
version field.`,
  },
];
