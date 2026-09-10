/**
 * Built-in skill catalogue used by the seed.
 *
 * A skill is reviewer instructions and NOTHING else — no code, no tools, no
 * execution. Each body below is concatenated verbatim into the review prompt's
 * `## Skills / rules` section, at the same trust level as the agent's system
 * prompt. Keep them short: every line is tokens on every run.
 *
 * `description` is written imperatively on purpose — it is the skill's
 * interface, the sentence that tells a reader (and, once selection becomes
 * dynamic, the router) when the skill applies.
 *
 * NOT seeded here: `api-contract-guard` (Test Quality Reviewer, spec 02) and
 * `deprecation-policy` (API & Integration Reviewer, specs/03). Both are imported
 * live through the UI's preview-then-confirm flow so the import path gets
 * exercised end to end — see `demo-assets/deprecation-policy.SKILL.md`.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: 'rubric' | 'convention' | 'security' | 'custom';
  source: 'manual' | 'imported_url' | 'extracted' | 'community';
  enabled: boolean;
  body: string;
}

export const SEED_SKILLS: SeedSkill[] = [
  {
    name: 'pr-quality-rubric',
    description: 'Rubric for evaluating overall PR quality across correctness, tests, and clarity.',
    type: 'rubric',
    source: 'manual',
    enabled: true,
    body: `# PR Quality Rubric

Evaluate the pull request against the following dimensions. For each, return a
finding only when the issue is **worth the author's time** — aim for 5
high-signal findings, not 50.

## Correctness
- Does the change do what the PR description claims?
- Are edge cases (empty input, nulls, concurrency) handled?

## Security
- Any secrets, tokens, or credentials in the diff?
- Untrusted input reaching a sink (SQL, shell, fetch)?

## Tests
- New branches covered by assertions?
- Are tests meaningful (not just snapshot churn)?

## Scope
- Does the diff do only what it says, or has unrelated work crept in?`,
  },
  {
    name: 'no-then-chains',
    description: 'Flag promise .then() chains; require async/await in new code.',
    type: 'convention',
    source: 'extracted',
    enabled: true,
    body: `# House rule: async/await over .then()

This codebase uses \`async\`/\`await\` everywhere. Flag any NEW code in the diff
that chains \`.then()\`, \`.catch()\`, or \`.finally()\` on a promise.

Do NOT flag:
- \`.catch()\` used as a deliberate fire-and-forget suppressor on a best-effort
  side effect (e.g. \`void write().catch(() => undefined)\`),
- existing lines the diff merely moves or reindents.`,
  },
  {
    name: 'secret-leakage-gate',
    description: 'Detect hardcoded credentials and keys committed in the diff.',
    type: 'security',
    source: 'community',
    enabled: true,
    body: `# Secret leakage gate

Flag any credential literal introduced by this diff, at CRITICAL severity:

- Provider keys: \`sk_live_\`, \`sk_test_\`, \`AKIA\`, \`ghp_\`, \`xoxb-\`, \`service_role\`
- Anything assigned to a name containing \`secret\`, \`token\`, \`password\`,
  \`api_key\`, \`private_key\` whose value is a string literal
- A \`NEXT_PUBLIC_\` variable holding something that is not safe to ship to a browser

A committed secret is CRITICAL even when the value looks like a placeholder —
if it is real, rotation is the only fix, and that decision belongs to a human.`,
  },
  {
    name: 'lethal-trifecta',
    description:
      'Flag changes that combine private data access, untrusted input, and an exfiltration path.',
    type: 'security',
    source: 'community',
    enabled: true,
    body: `# The lethal trifecta

A change is dangerous when it brings together all THREE of:

1. **Private data access** — reads secrets, user records, internal APIs, the filesystem
2. **Untrusted input** — request bodies, PR/issue text, scraped pages, model output
3. **An exfiltration path** — outbound HTTP, logging, a webhook, writing somewhere shared

Any two of these are ordinary. All three in one code path is the pattern behind
most agent data-leak incidents. When you find all three, report ONE finding that
names each leg and cites the line where it enters.`,
  },
  {
    name: 'phantom-api-gate',
    description: 'Detect calls to functions or modules that do not exist in the repository.',
    type: 'security',
    source: 'imported_url',
    // Imported from an untrusted source and left OFF until a human vets it.
    // This is the seeded example of the vetting gate — the rail card shows a
    // "needs vetting" badge and the skill reaches no prompt while it is false.
    enabled: false,
    body: `# Phantom API gate

Flag any call in the diff to a function, method, or module that does not exist
in this repository or in its declared dependencies.

Hallucinated imports are the most common way generated code fails at runtime
rather than at review time. Cite the import line and the call site.`,
  },
  {
    name: 'test-coverage-nudge',
    description: 'Flag branches introduced by the diff that no test exercises.',
    type: 'custom',
    source: 'manual',
    enabled: true,
    body: `# Uncovered branch check

For every branch this diff INTRODUCES — \`if\`, \`else\`, \`switch\` case, ternary,
\`catch\`, early return, optional chain that can short-circuit — ask whether any
test in the diff exercises it.

Report a finding for each branch with no covering assertion. Name the branch and
the line, and say which input would reach it.

A test that only walks the happy path through a function with an error branch is
exactly this finding: the error branch is untested. Do not accept "the happy
path is tested" as coverage of a conditional.`,
  },
  {
    name: 'corner-case-checklist',
    description: 'Check tests for boundary, empty, null, and error-path cases.',
    type: 'custom',
    source: 'manual',
    enabled: true,
    body: `# Corner-case checklist

Walk the tests added by this diff against this list and report what is missing:

- **Boundaries** — 0, 1, n-1, n, n+1; first and last element; exactly-at-limit
- **Empty** — empty string, empty array, empty object, no rows returned
- **Absent** — null, undefined, a missing optional field
- **Error paths** — the throw, the rejected promise, the non-2xx response
- **Ordering** — does the assertion depend on an order the code does not guarantee?

Report the specific missing case, not "add more tests".`,
  },
  {
    name: 'mock-discipline',
    description: 'Flag over-mocking, mocking the unit under test, and order- or time-dependent tests.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: `# Mock discipline

Flag tests in the diff that:

- **Mock the unit under test** — the assertion then verifies the mock, not the code
- **Over-mock** — so much is stubbed that the test would pass even if the real
  implementation were deleted
- **Depend on wall-clock time** — \`Date.now()\`, \`setTimeout\`, or a sleep, without
  fake timers; these are the flakes that fail only in CI
- **Depend on execution order** — shared mutable state between tests, or an
  assertion that relies on the previous test having run

For each, say what the test would still pass with, to make the gap concrete.`,
  },
  {
    name: 'breaking-change',
    description: 'Flag removal or incompatible change to a public route, param, or exported contract.',
    type: 'security',
    source: 'manual',
    enabled: true,
    body: `# Breaking-change guard

Flag any change in the diff that a caller outside this diff cannot safely
ignore: a removed or renamed route, a removed or renamed exported
function/type, a request parameter that became required, or a parameter/field
that was removed.

**Bad** — an existing caller silently breaks:
\`\`\`ts
// before: GET /users/:id
// after:
app.get('/users/:userId', handler); // route param renamed, callers 404
\`\`\`

**Good** — the old shape keeps working, or the break is explicit and versioned:
\`\`\`ts
app.get('/users/:id', handler);
app.get('/users/:userId', handler); // alias added, nothing removed
\`\`\`

Report the change at CRITICAL. Name the exact symbol/route and cite the line
that removed or renamed it. Do NOT flag a change to a function that is not
exported, or a route added for the first time (no existing caller to break).`,
  },
  {
    name: 'response-schema',
    description: 'Flag changes to a response shape: field type, nullability, or removal.',
    type: 'security',
    source: 'manual',
    enabled: true,
    body: `# Response-schema guard

Flag any change to what a route or function RETURNS to a caller: a field
removed, renamed, or made optional→required or required→optional in the wrong
direction, or a field's type changed (e.g. \`string\` → \`string | null\`,
\`number\` → \`string\`).

**Bad** — a caller reading \`user.email\` breaks or gets undefined behaviour:
\`\`\`ts
// before: { id, name, email }
return { id, name }; // email silently dropped from the response
\`\`\`

**Good** — the field stays, or its removal is called out as a breaking change
elsewhere in this review (see \`breaking-change\`):
\`\`\`ts
return { id, name, email: user.email ?? null }; // shape preserved
\`\`\`

A field becoming MORE permissive for callers (required → optional, narrower →
wider type) is not breaking; the reverse direction is. Report breaking
direction changes at CRITICAL, citing the exact field and file:line.`,
  },
  {
    name: 'semver-discipline',
    description: 'Flag a change that requires a major version bump but is not marked as one.',
    type: 'security',
    source: 'manual',
    enabled: true,
    body: `# Semver discipline

When this diff touches a published package's public API (exported functions,
types, routes) in a way that breaks an existing caller, check whether the
version bump (package.json, CHANGELOG, or PR title) reflects a MAJOR change.

**Bad** — a breaking change shipped as a patch/minor:
\`\`\`diff
- "version": "2.4.1"
+ "version": "2.4.2"   // but a required param was added to an exported fn
\`\`\`

**Good** — the bump matches the change:
\`\`\`diff
- "version": "2.4.1"
+ "version": "3.0.0"   // major bump for the breaking signature change
\`\`\`

Only flag this when BOTH are true in the diff: (1) a breaking change to a
public contract, and (2) a version file or changelog entry that under-bumps
it. Report at WARNING — this is a discipline check, not a correctness bug —
and name the specific breaking change that justifies the higher bump.`,
  },
];

/**
 * Which seeded agent gets which skills, in prompt order. Names, not ids —
 * resolved at seed time.
 *
 * `api-contract-guard` and `deprecation-policy` are deliberately absent: both
 * are imported live in the UI and attached as each agent's fourth skill.
 */
export const SEED_AGENT_SKILLS: Record<string, string[]> = {
  'Security Reviewer': ['pr-quality-rubric', 'secret-leakage-gate', 'lethal-trifecta'],
  'Test Quality Reviewer': ['test-coverage-nudge', 'corner-case-checklist', 'mock-discipline'],
  'API & Integration Reviewer': ['breaking-change', 'response-schema', 'semver-discipline'],
  'General Reviewer': ['pr-quality-rubric', 'no-then-chains', 'phantom-api-gate'],
};
