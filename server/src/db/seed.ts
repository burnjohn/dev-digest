import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and, sql } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the three built-in agents (General + Security +
 * Performance), all on the default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

/**
 * Seed a synthetic "provenance" PR + review + findings so a hand-authored eval
 * case can be linked to a real finding (populating its PR-meta tab: Source,
 * Source PR, Source finding). The PR is upserted by (repoId, number) so several
 * agents can share one fixture PR; the review + findings use deterministic ids
 * + onConflictDoNothing for idempotency. Findings are marked accepted (→ the
 * case's must_find expectation) or dismissed (→ must_not_flag), mirroring the
 * real "Add to evals" flow (createCaseFromFinding).
 */
async function seedEvalProvenance(
  db: Db,
  opts: {
    workspaceId: string;
    repoId: string;
    agentId: string;
    prNumber: number;
    prTitle: string;
    reviewId: string;
    findings: Array<{
      id: string;
      file: string;
      startLine: number;
      endLine: number;
      severity: string;
      category: string;
      kind?: string;
      title: string;
      rationale: string;
      decision: 'accepted' | 'dismissed';
    }>;
  },
): Promise<void> {
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, opts.repoId), eq(t.pullRequests.number, opts.prNumber)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: opts.workspaceId,
        repoId: opts.repoId,
        number: opts.prNumber,
        title: opts.prTitle,
        author: 'eval-fixtures',
        branch: `eval/fixtures-${opts.prNumber}`,
        base: 'main',
        headSha: `evalfixtures${opts.prNumber}`,
        status: 'needs_review',
        body: 'Synthetic PR hosting the seeded findings that back hand-authored eval cases (provenance only — not a real review target).',
      })
      .returning();
  }
  if (!pr) return;

  await db
    .insert(t.reviews)
    .values({
      id: opts.reviewId,
      workspaceId: opts.workspaceId,
      prId: pr.id,
      agentId: opts.agentId,
      kind: 'review',
      verdict: 'request_changes',
      summary: "Seeded review backing this agent's eval-case provenance.",
      model: 'seed',
    })
    .onConflictDoNothing({ target: t.reviews.id });

  const now = new Date();
  await db
    .insert(t.findings)
    .values(
      opts.findings.map((f) => ({
        id: f.id,
        reviewId: opts.reviewId,
        file: f.file,
        startLine: f.startLine,
        endLine: f.endLine,
        severity: f.severity,
        category: f.category,
        title: f.title,
        rationale: f.rationale,
        confidence: 0.9,
        kind: f.kind ?? 'finding',
        acceptedAt: f.decision === 'accepted' ? now : null,
        dismissedAt: f.decision === 'dismissed' ? now : null,
      })),
    )
    .onConflictDoNothing({ target: t.findings.id });
}

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset — includes one file per role so Smart Diff demo shows all three groups)
    await db.insert(t.prFiles).values([
      {
        prId: pr!.id,
        path: 'src/middleware/ratelimit.ts',
        additions: 84,
        deletions: 0,
        pseudocodeSummary: 'New token-bucket limiter: read bucketKey → Redis INCR → if over limit return 429, else next().',
      },
      {
        prId: pr!.id,
        path: 'src/api/public/webhooks.ts',
        additions: 31,
        deletions: 6,
        pseudocodeSummary: 'Forward webhook to caller-supplied callback_url with account token attached.',
      },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
      { prId: pr!.id, path: 'pnpm-lock.yaml', additions: 120, deletions: 3, patch: null },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // intent seed — shows in IntentCard before a live review run
    await db.insert(t.prIntent).values({
      prId: pr!.id,
      intent: 'Add rate limiting to public API endpoints to prevent abuse',
      inScope: ['token-bucket rate limiter middleware', 'rate limit config per endpoint', 'webhook endpoint limits', 'user list endpoint limits'],
      outOfScope: ['authentication changes', 'database schema changes', 'frontend UI changes'],
    }).onConflictDoUpdate({
      target: t.prIntent.prId,
      set: {
        intent: sql`excluded.intent`,
        inScope: sql`excluded.in_scope`,
        outOfScope: sql`excluded.out_of_scope`,
      },
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // Backfill pnpm-lock.yaml into pr_files for Smart Diff Boilerplate demo (idempotent)
  const [existingLock] = await db
    .select({ id: t.prFiles.id })
    .from(t.prFiles)
    .where(and(eq(t.prFiles.prId, pr!.id), eq(t.prFiles.path, 'pnpm-lock.yaml')));
  if (!existingLock) {
    await db.insert(t.prFiles).values({
      prId: pr!.id, path: 'pnpm-lock.yaml', additions: 120, deletions: 3, patch: null,
    });
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- demo skills for Test Quality Reviewer ----
  const demoSkills = [
    {
      name: 'test-coverage-rubric',
      description: 'Flags missing branch coverage and untested error paths in new test code.',
      type: 'rubric' as const,
      source: 'manual' as const,
      body: `# Test Coverage Rubric

Evaluate the pull request for gaps in test coverage.

## Required checks

- **Branch coverage**: Every if/else, switch branch, early return, or ternary introduced by the diff must have at least one test for each outcome.
- **Error paths**: Every catch block or error-fallback introduced must be exercised by at least one test.
- **Negative cases**: If a function validates input or can throw/return null, there must be at least one test for the invalid/null input.

## Reporting rule

Report only branches introduced in THIS diff that have no matching test case. Do not report pre-existing coverage gaps.`,
    },
    {
      name: 'no-mock-overuse',
      description: 'Detects excessive mocking patterns that make tests pass trivially.',
      type: 'convention' as const,
      source: 'manual' as const,
      body: `# No Mock Overuse

Flag tests that rely on mocking in ways that make them trivially pass.

## Antipatterns to flag

1. **Mocking the system under test** — the test mocks the very function it is testing. The test cannot fail.
2. **Mock always returns success** — a mock configured to return \`{ ok: true }\` regardless of input makes the assertion meaningless.
3. **Mocking DB in integration tests** — integration tests (\`*.it.test.ts\`) must hit a real database via testcontainers. Mocking the DB there invalidates the test.
4. **Implementation-detail mock** — mocking a private method or internal state instead of the public boundary.

## Reporting rule

Flag each occurrence with the specific antipattern. Cite the mock setup line and the assertion that becomes meaningless as a result.`,
    },
    {
      name: 'boundary-cases',
      description: 'Ensures boundary and edge case inputs are exercised for each new function.',
      type: 'rubric' as const,
      source: 'manual' as const,
      body: `# Boundary Case Coverage

For every new function or modified function in the diff, verify that the following boundary inputs are exercised:

## Boundary checklist

- **Empty**: empty string \`""\`, empty array \`[]\`, empty object \`{}\`
- **Zero / negative**: numeric arguments at 0 and -1 (where the function accepts numbers)
- **Null / undefined**: optional parameters not passed, nullable fields set to null
- **Single element**: collection-processing functions tested with exactly one element
- **Exact limit**: if there is a size limit (e.g., \`max(100)\`), test at limit-1, limit, limit+1
- **Concurrent calls**: async functions called simultaneously — is the result deterministic?

## Reporting rule

For each function introduced in the diff, list which boundary cases are missing. Skip functions that are purely cosmetic refactors with no logic change.`,
    },
    {
      name: 'flaky-test-detector',
      description: 'Spots patterns that cause intermittent test failures.',
      type: 'convention' as const,
      source: 'manual' as const,
      body: `# Flaky Test Detector

Flag patterns that cause tests to pass sometimes and fail others.

## Patterns to flag

1. **Hardcoded Date.now() or new Date()** — asserts on a specific timestamp. Will fail at midnight, end of month, or year boundary.
2. **Math.random() without seeding** — non-deterministic values in assertions.
3. **setTimeout/setInterval without fake timers** — tests that rely on real wall-clock delays are inherently flaky in CI.
4. **Array/object order assumptions** — asserting \`expect(result[0]).toBe(x)\` on data returned from a query without an ORDER BY.
5. **Shared state between tests** — a \`beforeAll\` that writes data and an \`afterAll\` that reads it without cleanup; if tests run in a different order the setup may be missing.
6. **External network calls** — any \`fetch\` or HTTP call in a unit test without a stub.

## Reporting rule

Report the exact line of the flaky pattern and explain what triggers the intermittent failure.`,
    },
    {
      name: 'backend-api-conventions',
      description: 'Enforces Fastify route and repository conventions for server-side code.',
      type: 'convention' as const,
      source: 'manual' as const,
      body: [
        '# Backend API Conventions',
        '',
        'Apply when the diff touches `server/` files.',
        '',
        '## Routes',
        '- Every handler that needs workspace context MUST call `getContext()`.',
        '- Route handlers must not contain business logic — delegate to the service.',
        '- Business errors must be thrown as `AppError` (or its subclasses), never plain `Error`.',
        '',
        '## Repository',
        '- Every query MUST filter by `workspace_id` — no exceptions.',
        '- Never return raw DB rows — map to DTO in the service layer.',
        '',
        '## Secrets',
        '- Never read from `process.env` directly — use `SecretsProvider`.',
        '',
        '## Report',
        'Flag each violation with `file:line` and the exact rule broken.',
      ].join('\n'),
    },
  ];

  const skillIds: string[] = [];
  for (const s of demoSkills) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (existing) {
      skillIds.push(existing.id);
    } else {
      const [inserted] = await db
        .insert(t.skills)
        .values({ workspaceId, ...s, enabled: true, version: 1 })
        .returning();
      // Record initial version snapshot
      await db.insert(t.skillVersions).values({ skillId: inserted!.id, version: 1, body: s.body });
      skillIds.push(inserted!.id);
    }
  }

  // ---- Test Quality Reviewer agent (with attached skills) ----
  const tqrName = 'Test Quality Reviewer';
  let [tqrAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, tqrName)));
  if (!tqrAgent) {
    [tqrAgent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: tqrName,
        description: 'Reviews test quality: coverage gaps, over-mocking, boundary cases, flaky patterns.',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
        enabled: true,
        version: 1,
        createdBy: userId,
      })
      .returning();
  }

  // Attach all 4 skills to the Test Quality Reviewer (idempotent)
  if (tqrAgent && skillIds.length > 0) {
    for (const [i, skillId] of skillIds.entries()) {
      await db
        .insert(t.agentSkills)
        .values({ agentId: tqrAgent.id, skillId, order: i })
        .onConflictDoNothing();
    }
  }

  // ---- pr-self-review skills (frontend TS + backend API conventions) ----
  const psrSkillDefs = [
    {
      name: 'frontend-ts-conventions',
      description: 'Enforces TypeScript and React conventions for client-side code changes.',
      type: 'convention' as const,
      source: 'manual' as const,
      body: [
        '# Frontend TypeScript & React Conventions',
        '',
        'Apply when the diff touches `client/` or any `*.tsx?` file.',
        '',
        '## TypeScript',
        '- No `any` — use `unknown` and narrow, or a proper named type.',
        '- Prop interfaces must be named `<ComponentName>Props`.',
        '- No non-null assertion (`!`) unless provably safe from surrounding code.',
        '',
        '## React',
        '- No `useEffect` for data fetching — use TanStack Query hooks.',
        '- Add `"use client"` only at the lowest possible component boundary.',
        '- Keys in lists must be stable IDs, never array index.',
        '',
        '## Report',
        'Flag each violation with `file:line` and the exact rule broken.',
      ].join('\n'),
    },
    {
      name: 'backend-api-conventions',
      description: 'Enforces Fastify route and repository conventions for server-side code.',
      type: 'convention' as const,
      source: 'manual' as const,
      body: [
        '# Backend API Conventions',
        '',
        'Apply when the diff touches `server/` files.',
        '',
        '## Routes',
        '- Every handler that needs workspace context MUST call `getContext()`.',
        '- Route handlers must not contain business logic — delegate to the service.',
        '- Business errors must be thrown as `AppError` (or its subclasses), never plain `Error`.',
        '',
        '## Repository',
        '- Every query MUST filter by `workspace_id` — no exceptions.',
        '- Never return raw DB rows — map to DTO in the service layer.',
        '',
        '## Secrets',
        '- Never read from `process.env` directly — use `SecretsProvider`.',
        '',
        '## Report',
        'Flag each violation with `file:line` and the exact rule broken.',
      ].join('\n'),
    },
  ];

  const psrSkillIds: string[] = [];
  for (const s of psrSkillDefs) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (existing) {
      psrSkillIds.push(existing.id);
    } else {
      const [inserted] = await db
        .insert(t.skills)
        .values({ workspaceId, ...s, enabled: true, version: 1 })
        .returning();
      await db.insert(t.skillVersions).values({ skillId: inserted!.id, version: 1, body: s.body });
      psrSkillIds.push(inserted!.id);
    }
  }

  // ---- pr-self-review agent (auto-call disabled; full-stack conventions) ----
  const psrName = 'pr-self-review';
  let [psrAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, psrName)));
  if (!psrAgent) {
    [psrAgent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: psrName,
        description: 'Full-stack self-review: TypeScript, React, Fastify, and API conventions across client and server.',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        systemPrompt: [
          'You are a senior engineer performing a self-review of a pull request in the DevDigest repository.',
          'Your job is to catch issues before the PR goes to human reviewers.',
          'Focus on correctness, adherence to project conventions, and anything that will be flagged in code review.',
          'Return at most 8 high-signal findings, each citing an exact file:line.',
        ].join('\n'),
        enabled: false,
        version: 1,
        createdBy: userId,
      })
      .returning();
  }

  if (psrAgent && psrSkillIds.length > 0) {
    for (const [i, skillId] of psrSkillIds.entries()) {
      await db
        .insert(t.agentSkills)
        .values({ agentId: psrAgent.id, skillId, order: i })
        .onConflictDoNothing();
    }
  }

  // ---- API Contract Reviewer skills ----
  const acrSkillDefs = [
    {
      name: 'breaking-change',
      description: 'Flags any change that removes, renames, or narrows a public API contract.',
      type: 'convention' as const,
      source: 'manual' as const,
      body: `# breaking-change

Flag any change that breaks the existing public API contract for callers who have not updated their code.
A "breaking change" is one that forces clients to change their code to avoid a runtime error or behaviour change.

Flag the offending \`file:line\` and explain exactly what the contract was and what it became.

## Examples

### ❌ Bad — silently breaks callers

\`\`\`diff
- export async function getUser(id: string): Promise<User>
+ export async function getUser(id: string, includeDeleted = false): Promise<User | null>
\`\`\`

Return type changed from \`User\` to \`User | null\`. All callers that wrote \`const u = await getUser(id); u.name\`
will throw at runtime. This is a **breaking change** — flag it.

### ✅ Good — backwards-compatible addition

\`\`\`diff
- export async function getUser(id: string): Promise<User>
+ export async function getUser(id: string, options?: { includeDeleted?: boolean }): Promise<User>
\`\`\`

Optional parameter, return type unchanged. Existing callers are unaffected.

## Rules

1. Any removal of a public export, route, or method is breaking.
2. Any narrowing of an accepted parameter type is breaking (e.g. \`string | number\` → \`string\`).
3. Any widening of a return type is breaking unless callers are guarded (\`User | null\` where \`User\` was expected).
4. A route path change (rename, reorder of segments) is breaking.
5. A required-parameter addition is breaking.
6. Status code change on a success path (200 → 201, 200 → 204) is breaking if clients branch on it.`,
    },
    {
      name: 'response-schema',
      description: 'Flags changes to API response shape: renamed fields, removed fields, type changes.',
      type: 'convention' as const,
      source: 'manual' as const,
      body: `# response-schema

Flag any change to the shape of an API response that could cause a client to fail when deserialising or accessing fields.
"Shape" means: field names, field types, nullability, optionality, nesting depth.

Flag the offending \`file:line\`, show the before/after schema diff, and state which clients are at risk.

## Examples

### ❌ Bad — field renamed

\`\`\`diff
- { "userId": "abc123" }
+ { "user_id": "abc123" }
\`\`\`

\`userId\` is now \`user_id\`. Any client reading \`.userId\` gets \`undefined\` — silent data loss.

### ❌ Bad — field removed

\`\`\`diff
- { "id": "1", "email": "a@b.com", "role": "admin" }
+ { "id": "1", "email": "a@b.com" }
\`\`\`

\`role\` removed. Clients that branch on \`user.role\` will behave incorrectly.

### ✅ Good — additive field

\`\`\`diff
  { "id": "1", "email": "a@b.com"
+ , "avatar_url": "https://..." }
\`\`\`

New optional field. Existing clients ignore it; new clients can use it.

## Rules

1. Renaming any field in a response body is breaking — even if the old name was "wrong".
2. Removing a field that clients currently read is breaking.
3. Changing a field type (e.g. \`string\` → \`number\`, \`string\` → \`string[]\`) is breaking.
4. Making a nullable field non-nullable (or vice versa) is breaking.
5. Changing the nesting level of an existing field is breaking.
6. Reordering array elements in a stable response is breaking when clients index by position.`,
    },
    {
      name: 'semver-discipline',
      description: 'Flags breaking changes shipped without a major version bump.',
      type: 'convention' as const,
      source: 'manual' as const,
      body: `# semver-discipline

Flag when a change to the API requires a semver major version bump but one has not been made,
or when the commit message / PR title suggests a "minor" or "patch" change that is actually a major.

## When a major bump is required

A major bump (X.0.0) is required whenever a published API has a **breaking change** (see \`breaking-change\` skill).
Specifically in this codebase:

- Any route removal or rename → **major**
- Any response field removal or rename → **major**
- Any narrowing of accepted input (required param added, type narrowed) → **major**
- Any authentication/authorization model change (removing a public endpoint, adding mandatory auth) → **major**

## When a minor bump is enough

- New optional query params or request body fields are added.
- New routes are added.
- New optional response fields are added.
- Behaviour is extended in a backwards-compatible way.

## When a patch is enough

- Bug fixes that restore documented behaviour.
- Performance improvements with no visible contract change.
- Documentation or comment changes only.

## Rule

If a PR contains even ONE breaking change (per \`breaking-change\` rules), the semver bump must be major.
Flag the inconsistency with the exact breaking change and the incorrect version label.`,
    },
    {
      name: 'deprecation-policy',
      description: 'Flags API elements removed without a prior deprecation marker and grace period.',
      type: 'convention' as const,
      source: 'manual' as const,
      body: `# deprecation-policy

Flag when a public API element (route, field, param, export) is silently removed or changed without first being
marked as deprecated and given a migration period.

Deprecation must be observable to callers before removal happens. Silent removal is always a breaking change.

## Required deprecation lifecycle

1. **Mark deprecated** — add a response header (\`Deprecation: true\`, \`Sunset: <date>\`) and/or a \`deprecated: true\`
   field in the response body, and document the replacement.
2. **Communicate** — the PR that introduces the deprecation must update API docs / changelog with the sunset date.
3. **Grace period** — at least one minor release must exist between the deprecation marker and removal.
4. **Remove** — only after the grace period and a major version bump.

## Examples

### ❌ Bad — silent removal in same PR

Route removed without deprecation header or grace period. Callers will receive 404 with no warning.

### ❌ Bad — field removed with a comment but no deprecation marker

Comment-only deprecation is not machine-observable. Clients have no programmatic way to detect it.

### ✅ Good — HTTP header

\`\`\`
Deprecation: true
Sunset: Sat, 01 Mar 2025 00:00:00 GMT
Link: <https://docs.example.com/migration>; rel="deprecation"
\`\`\`

RFC 8594-compliant deprecation signal.

## Rule

Any removal or renaming of a public API surface MUST be preceded by a deprecation marker in an earlier release.
If this PR removes or renames something that was never marked deprecated, flag it as a policy violation.`,
    },
  ];

  const acrSkillIds: string[] = [];
  for (const s of acrSkillDefs) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (existing) {
      acrSkillIds.push(existing.id);
    } else {
      const [inserted] = await db
        .insert(t.skills)
        .values({ workspaceId, ...s, enabled: true, version: 1 })
        .returning();
      await db.insert(t.skillVersions).values({ skillId: inserted!.id, version: 1, body: s.body });
      acrSkillIds.push(inserted!.id);
    }
  }

  // ---- API Contract Reviewer agent (with attached skills) ----
  const acrName = 'API Contract Reviewer';
  let [acrAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, acrName)));
  if (!acrAgent) {
    [acrAgent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: acrName,
        description: 'Detects breaking API contract changes: renamed/removed fields, semver violations, missing deprecation markers.',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
        enabled: true,
        version: 1,
        createdBy: userId,
      })
      .returning();
  }

  if (acrAgent && acrSkillIds.length > 0) {
    for (const [i, skillId] of acrSkillIds.entries()) {
      await db
        .insert(t.agentSkills)
        .values({ agentId: acrAgent.id, skillId, order: i })
        .onConflictDoNothing();
    }
  }

  // ---- demo eval cases for the General Reviewer (idempotent) ----
  // L06 eval pipeline: 5 hand-authored cases against the primary demo agent
  // (General Reviewer — the first-listed built-in reviewer, reviews for bugs/
  // correctness/clarity). Each `input_diff` is a small, valid unified diff
  // so the diff-parser and citation-grounding gate both have real hunks to
  // work against; every expectation's file/line has been hand-traced through
  // `parseUnifiedDiff`'s new-side numbering rule (server/src/adapters/git/
  // diff-parser.ts): a hunk's new-side cursor starts at `@@ -a,b +c,d @@`'s
  // `c`, advances by 1 for every context line AND every added (`+`) line, and
  // does NOT advance for deleted (`-`) lines. Every expectation below falls
  // inside its hunk's new-side line numbers under that rule.
  // Fixed UUID literals + `.onConflictDoNothing()` keyed on `id` keep re-runs
  // of `pnpm db:seed` from duplicating rows (AC-39).
  //
  // These 5 cases are the demo-repo half of AC-38's >=8-case bar for the
  // primary agent. The other half ("at least 3 authored from real
  // accept/dismiss decisions") is satisfied at demo time via the FindingCard
  // accept/dismiss action against real seeded PR findings — not by this
  // script; do not expect this seed alone to reach 8 cases.
  let [generalReviewer] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'General Reviewer')));
  if (generalReviewer) {
    const evalCaseSeeds: Array<typeof t.evalCases.$inferInsert> = [
      {
        id: '11111111-1111-4111-a111-000000000001',
        workspaceId,
        ownerKind: 'agent',
        ownerId: generalReviewer.id,
        name: 'missing await drops usage report',
        inputDiff: `diff --git a/src/jobs/sync-usage.ts b/src/jobs/sync-usage.ts
--- a/src/jobs/sync-usage.ts
+++ b/src/jobs/sync-usage.ts
@@ -10,7 +10,7 @@ export async function syncUsage(workspaceId: string): Promise<void> {
   const rows = await repo.listUsageRows(workspaceId);
   for (const row of rows) {
-    await billingClient.reportUsage(row);
+    billingClient.reportUsage(row);
   }
   logger.info('usage sync complete');
 }
`,
        expectedOutput: [
          {
            type: 'must_find',
            file: 'src/jobs/sync-usage.ts',
            line_start: 12,
            line_end: 12,
            severity: 'CRITICAL',
            category: 'bug',
            kind: 'finding',
          },
        ],
        notes: 'Dropped `await` turns the loop fire-and-forget: unhandled rejections and no guaranteed completion before the sync is logged as done.',
      },
      {
        id: '11111111-1111-4111-a111-000000000002',
        workspaceId,
        ownerKind: 'agent',
        ownerId: generalReviewer.id,
        name: 'N+1 query in notification fan-out',
        inputDiff: `diff --git a/src/modules/notifications/service.ts b/src/modules/notifications/service.ts
--- a/src/modules/notifications/service.ts
+++ b/src/modules/notifications/service.ts
@@ -20,8 +20,10 @@ export async function fanOutNotifications(userIds: string[]): Promise<void> {
-  const users = await db.select().from(t.users).where(inArray(t.users.id, userIds));
-  for (const user of users) {
+  for (const userId of userIds) {
+    const [user] = await db.select().from(t.users).where(eq(t.users.id, userId));
+    if (!user) continue;
     await notifyClient.send(user.email, 'digest_ready');
   }
 }
`,
        expectedOutput: [
          {
            type: 'must_find',
            file: 'src/modules/notifications/service.ts',
            line_start: 20,
            line_end: 22,
            severity: 'WARNING',
            category: 'perf',
            kind: 'finding',
          },
        ],
        notes: 'Replacing a single batched query with one query per user in the loop introduces an N+1 that scales with fan-out size.',
      },
      {
        id: '11111111-1111-4111-a111-000000000003',
        workspaceId,
        ownerKind: 'agent',
        ownerId: generalReviewer.id,
        name: 'safe guard clause addition (must not flag)',
        inputDiff: `diff --git a/src/modules/settings/service.ts b/src/modules/settings/service.ts
--- a/src/modules/settings/service.ts
+++ b/src/modules/settings/service.ts
@@ -14,6 +14,9 @@ export async function updateTheme(workspaceId: string, theme: string): Promise<void> {
+  if (!ALLOWED_THEMES.includes(theme)) {
+    throw new ValidationError('invalid theme');
+  }
   await repo.setSetting(workspaceId, 'theme', theme);
 }
`,
        expectedOutput: [
          {
            type: 'must_not_flag',
            file: 'src/modules/settings/service.ts',
            line_start: 14,
            line_end: 16,
            severity: null,
            kind: null,
          },
        ],
        notes: 'Zero-must_find-denominator path: only a must_not_flag expectation, exercising precision scoring when there is nothing to recall.',
      },
      {
        id: '11111111-1111-4111-a111-000000000004',
        workspaceId,
        ownerKind: 'agent',
        ownerId: generalReviewer.id,
        name: 'SQL string concat plus safe rename',
        inputDiff: `diff --git a/src/modules/search/repository.ts b/src/modules/search/repository.ts
--- a/src/modules/search/repository.ts
+++ b/src/modules/search/repository.ts
@@ -8,7 +8,7 @@ export async function findByTitle(term: string) {
-  const query = 'SELECT * FROM documents WHERE title = ?';
+  const query = "SELECT * FROM documents WHERE title = '" + term + "'";
   return db.execute(query);
 }
@@ -20,6 +20,6 @@ export async function countDocuments(): Promise<number> {
-  const totalCount = await db.select({ count: sql\`count(*)\` }).from(t.documents);
-  return totalCount[0].count;
+  const documentCount = await db.select({ count: sql\`count(*)\` }).from(t.documents);
+  return documentCount[0].count;
 }
`,
        expectedOutput: [
          {
            type: 'must_find',
            file: 'src/modules/search/repository.ts',
            line_start: 8,
            line_end: 8,
            severity: 'CRITICAL',
            category: 'security',
            kind: 'finding',
          },
          {
            type: 'must_not_flag',
            file: 'src/modules/search/repository.ts',
            line_start: 20,
            line_end: 21,
            severity: null,
            kind: null,
          },
        ],
        notes: 'Mixed case: SQL injection via string concatenation (must_find) alongside a purely cosmetic local variable rename in an unrelated hunk (must_not_flag).',
      },
      {
        id: '11111111-1111-4111-a111-000000000005',
        workspaceId,
        ownerKind: 'agent',
        ownerId: generalReviewer.id,
        name: 'clean diff — comment-only change',
        inputDiff: `diff --git a/src/modules/health/routes.ts b/src/modules/health/routes.ts
--- a/src/modules/health/routes.ts
+++ b/src/modules/health/routes.ts
@@ -5,6 +5,7 @@ export async function healthRoutes(app: FastifyInstance) {
   app.get('/health', async () => {
+    // liveness probe: no DB dependency, always cheap
     return { status: 'ok' };
   });
 }
`,
        expectedOutput: [],
        notes: 'AC-9 empty-set path: a clean diff with no expectations at all — scoring must treat this as a valid case, not a special-cased branch.',
      },
    ];

    for (const c of evalCaseSeeds) {
      await db.insert(t.evalCases).values(c).onConflictDoNothing({ target: t.evalCases.id });
    }

    // Provenance backfill (Option A): seed a fixture PR + findings and link each
    // finding-derived case's PR-meta to a real finding. A plain UPDATE (not the
    // onConflictDoNothing insert above) so a re-seed backfills EXISTING rows too.
    // The clean-diff case (…0005) has no source finding by definition and stays
    // hand-authored. Findings: accepted → must_find case; dismissed → must_not_flag.
    const EVAL_FIXTURE_PR = 9001;
    const genF = {
      c1: 'aa000000-0000-4000-8000-000000000011',
      c2: 'aa000000-0000-4000-8000-000000000012',
      c3: 'aa000000-0000-4000-8000-000000000013',
      c4: 'aa000000-0000-4000-8000-000000000014',
    };
    await seedEvalProvenance(db, {
      workspaceId,
      repoId,
      agentId: generalReviewer.id,
      prNumber: EVAL_FIXTURE_PR,
      prTitle: 'Eval fixtures (provenance)',
      reviewId: 'aa000000-0000-4000-8000-000000000001',
      findings: [
        { id: genF.c1, file: 'src/jobs/sync-usage.ts', startLine: 12, endLine: 12, severity: 'CRITICAL', category: 'bug', title: 'missing await drops usage report', rationale: 'Dropped `await` makes the loop fire-and-forget.', decision: 'accepted' },
        { id: genF.c2, file: 'src/modules/notifications/service.ts', startLine: 20, endLine: 22, severity: 'WARNING', category: 'perf', title: 'N+1 query in notification fan-out', rationale: 'One query per user issued inside the loop.', decision: 'accepted' },
        { id: genF.c3, file: 'src/modules/settings/service.ts', startLine: 14, endLine: 16, severity: 'WARNING', category: 'style', title: 'guard clause flagged as over-restrictive', rationale: 'Raised, then dismissed — the added guard is safe input validation, not an issue.', decision: 'dismissed' },
        { id: genF.c4, file: 'src/modules/search/repository.ts', startLine: 8, endLine: 8, severity: 'CRITICAL', category: 'security', title: 'SQL injection via string concatenation', rationale: 'User input concatenated directly into the SQL string.', decision: 'accepted' },
      ],
    });
    const genLinks: Array<[string, string]> = [
      ['11111111-1111-4111-a111-000000000001', genF.c1],
      ['11111111-1111-4111-a111-000000000002', genF.c2],
      ['11111111-1111-4111-a111-000000000003', genF.c3],
      ['11111111-1111-4111-a111-000000000004', genF.c4],
    ];
    for (const [caseId, findingId] of genLinks) {
      await db
        .update(t.evalCases)
        .set({ inputMeta: { source: 'finding', source_finding_id: findingId, source_pr_number: EVAL_FIXTURE_PR } })
        .where(eq(t.evalCases.id, caseId));
    }
  }

  // ---- demo eval cases for the Security Reviewer (idempotent) ----
  // Same shape/rules as the General Reviewer set above (hand-traced new-side
  // line numbers, fixed UUIDs + onConflictDoNothing), but themed to this
  // agent's domain — secrets, injection, SSRF (see its description). Structure
  // mirrors the General set: 2x must_find, 1x must_not_flag, 1x mixed, 1x
  // clean-diff. New `2222…` UUIDs → a plain `pnpm db:seed` inserts these
  // without touching the existing General cases.
  const [securityReviewer] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
  if (securityReviewer) {
    const securityEvalCaseSeeds: Array<typeof t.evalCases.$inferInsert> = [
      {
        id: '22222222-2222-4222-a222-000000000001',
        workspaceId,
        ownerKind: 'agent',
        ownerId: securityReviewer.id,
        name: 'hardcoded Stripe secret key in config',
        inputDiff: `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,4 +10,5 @@
 export const config = {
   port: Number(process.env.PORT ?? 3000),
+  stripeKey: "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc",
   redisUrl: process.env.REDIS_URL,
 };
`,
        expectedOutput: [
          {
            type: 'must_find',
            file: 'src/config.ts',
            line_start: 12,
            line_end: 12,
            severity: 'CRITICAL',
            category: 'security',
            kind: 'secret_leak',
          },
        ],
        notes: 'A literal `sk_live_` Stripe secret committed in plaintext — must be flagged and the key rotated. Mirrors the seeded PR #482 finding.',
      },
      {
        id: '22222222-2222-4222-a222-000000000002',
        workspaceId,
        ownerKind: 'agent',
        ownerId: securityReviewer.id,
        name: 'SSRF via unvalidated webhook URL',
        inputDiff: `diff --git a/src/modules/webhooks/service.ts b/src/modules/webhooks/service.ts
--- a/src/modules/webhooks/service.ts
+++ b/src/modules/webhooks/service.ts
@@ -15,3 +15,6 @@ export async function deliverWebhook(payload: WebhookPayload): Promise<void> {
   const target = payload.callbackUrl;
+  // POST the payload to whatever URL the caller supplied
+  const res = await fetch(target, { method: 'POST', body: JSON.stringify(payload) });
+  if (!res.ok) throw new Error('delivery failed');
   logger.info('webhook delivered', { target });
 }
`,
        expectedOutput: [
          {
            type: 'must_find',
            file: 'src/modules/webhooks/service.ts',
            line_start: 16,
            line_end: 18,
            severity: 'CRITICAL',
            category: 'security',
            kind: 'finding',
          },
        ],
        notes: 'User-controlled callbackUrl passed straight to fetch() → server-side request forgery; the destination must be validated / allow-listed.',
      },
      {
        id: '22222222-2222-4222-a222-000000000003',
        workspaceId,
        ownerKind: 'agent',
        ownerId: securityReviewer.id,
        name: 'parameterized query is safe (must not flag)',
        inputDiff: `diff --git a/src/modules/auth/repository.ts b/src/modules/auth/repository.ts
--- a/src/modules/auth/repository.ts
+++ b/src/modules/auth/repository.ts
@@ -22,3 +22,7 @@ export async function findUserByEmail(email: string) {
   const normalized = email.trim().toLowerCase();
+  const rows = await db
+    .select()
+    .from(users)
+    .where(eq(users.email, normalized));
   return rows[0] ?? null;
 }
`,
        expectedOutput: [
          {
            type: 'must_not_flag',
            file: 'src/modules/auth/repository.ts',
            line_start: 23,
            line_end: 26,
            severity: null,
            kind: null,
          },
        ],
        notes: 'A bound-parameter query via eq() is NOT injection — the Security Reviewer must not raise a false positive here (exercises precision).',
      },
      {
        id: '22222222-2222-4222-a222-000000000004',
        workspaceId,
        ownerKind: 'agent',
        ownerId: securityReviewer.id,
        name: 'command injection plus safe rename',
        inputDiff: `diff --git a/src/modules/export/service.ts b/src/modules/export/service.ts
--- a/src/modules/export/service.ts
+++ b/src/modules/export/service.ts
@@ -8,3 +8,3 @@ export async function exportReport(name: string): Promise<string> {
-  const file = await renderReport(name);
+  const file = execSync('generate-report --name ' + name).toString();
   return file;
 }
@@ -30,3 +30,3 @@ export function reportPath(id: string): string {
-  const dir = resolveBaseDir();
-  return join(dir, id + '.pdf');
+  const baseDir = resolveBaseDir();
+  return join(baseDir, id + '.pdf');
 }
`,
        expectedOutput: [
          {
            type: 'must_find',
            file: 'src/modules/export/service.ts',
            line_start: 8,
            line_end: 8,
            severity: 'CRITICAL',
            category: 'security',
            kind: 'finding',
          },
          {
            type: 'must_not_flag',
            file: 'src/modules/export/service.ts',
            line_start: 30,
            line_end: 31,
            severity: null,
            kind: null,
          },
        ],
        notes: 'Mixed case: unsanitized input concatenated into execSync (command injection, must_find) alongside a purely cosmetic dir→baseDir rename in an unrelated hunk (must_not_flag).',
      },
      {
        id: '22222222-2222-4222-a222-000000000005',
        workspaceId,
        ownerKind: 'agent',
        ownerId: securityReviewer.id,
        name: 'clean diff — auth comment only',
        inputDiff: `diff --git a/src/modules/auth/middleware.ts b/src/modules/auth/middleware.ts
--- a/src/modules/auth/middleware.ts
+++ b/src/modules/auth/middleware.ts
@@ -12,4 +12,5 @@ export function requireAuth(req: Request, res: Response, next: Next) {
   const token = req.headers.authorization?.split(' ')[1];
+  // NOTE: tokens are verified in verifyJwt below; nothing sensitive is logged here
   if (!token) return res.status(401).end();
   return verifyJwt(token, req, res, next);
 }
`,
        expectedOutput: [],
        notes: 'AC-9 empty-set path for the Security Reviewer: a comment-only change with no security impact — any finding here would be a false positive.',
      },
    ];

    for (const c of securityEvalCaseSeeds) {
      await db.insert(t.evalCases).values(c).onConflictDoNothing({ target: t.evalCases.id });
    }

    // Provenance backfill (Option A) — mirrors the General block; shares the
    // same fixture PR (9001), its own review + findings. Clean-diff case (…0005)
    // stays hand-authored (no source finding).
    const SEC_FIXTURE_PR = 9001;
    const secF = {
      c1: 'bb000000-0000-4000-8000-000000000011',
      c2: 'bb000000-0000-4000-8000-000000000012',
      c3: 'bb000000-0000-4000-8000-000000000013',
      c4: 'bb000000-0000-4000-8000-000000000014',
    };
    await seedEvalProvenance(db, {
      workspaceId,
      repoId,
      agentId: securityReviewer.id,
      prNumber: SEC_FIXTURE_PR,
      prTitle: 'Eval fixtures (provenance)',
      reviewId: 'bb000000-0000-4000-8000-000000000001',
      findings: [
        { id: secF.c1, file: 'src/config.ts', startLine: 12, endLine: 12, severity: 'CRITICAL', category: 'security', kind: 'secret_leak', title: 'hardcoded Stripe secret key in config', rationale: 'A literal `sk_live_` secret committed in plaintext.', decision: 'accepted' },
        { id: secF.c2, file: 'src/modules/webhooks/service.ts', startLine: 16, endLine: 18, severity: 'CRITICAL', category: 'security', title: 'SSRF via unvalidated webhook URL', rationale: 'User-controlled callbackUrl passed straight to fetch().', decision: 'accepted' },
        { id: secF.c3, file: 'src/modules/auth/repository.ts', startLine: 23, endLine: 26, severity: 'WARNING', category: 'security', title: 'possible SQL injection in user lookup', rationale: 'Raised, then dismissed — the query is parameterized via eq(), not injectable.', decision: 'dismissed' },
        { id: secF.c4, file: 'src/modules/export/service.ts', startLine: 8, endLine: 8, severity: 'CRITICAL', category: 'security', title: 'command injection via execSync', rationale: 'Unsanitized input concatenated into a shell command.', decision: 'accepted' },
      ],
    });
    const secLinks: Array<[string, string]> = [
      ['22222222-2222-4222-a222-000000000001', secF.c1],
      ['22222222-2222-4222-a222-000000000002', secF.c2],
      ['22222222-2222-4222-a222-000000000003', secF.c3],
      ['22222222-2222-4222-a222-000000000004', secF.c4],
    ];
    for (const [caseId, findingId] of secLinks) {
      await db
        .update(t.evalCases)
        .set({ inputMeta: { source: 'finding', source_finding_id: findingId, source_pr_number: SEC_FIXTURE_PR } })
        .where(eq(t.evalCases.id, caseId));
    }
  }

  // ---- demo skill-eval cases for `flaky-test-detector` (idempotent) ----
  // Skill-eval pipeline (docs/plans/2026-07-06-skill-eval-pipeline.md, Step 10).
  //
  // CHOSEN SKILL: `flaky-test-detector` (one of the 5 Test Quality Reviewer
  // skills seeded above, ~seed.ts:421-441). WHY: its body enumerates concrete,
  // literal antipattern keywords — "Hardcoded Date.now() or new Date()",
  // "Math.random() without seeding", "setTimeout/setInterval without fake
  // timers", "Array/object order assumptions", "External network calls" — each
  // of which is a natural, unambiguous `grounding[]` substring that a real
  // review finding about that antipattern would be expected to literally
  // contain (e.g. a finding calling out a flaky test would say "Date.now()" or
  // "Math.random()" by name, not a paraphrase). This makes the grounding gate
  // meaningfully checkable rather than a vague semantic match. The skill's
  // "Reporting rule" ("report the exact line ... explain what triggers the
  // intermittent failure") is equally well-suited to `practices[]` statements
  // a judge can verify against real review output with a verbatim quote (e.g.
  // "review output explains why the assertion is non-deterministic"). This
  // skill-eval scoring (`patternMatch` + `judgePractices`, see
  // skills/eval-scoring.ts) is UNRELATED to reviewer-core's `groundFindings()`
  // citation gate, which remains mandatory and untouched inside
  // `reviewPullRequest()` itself — see the Constraints section of the plan
  // above for the full naming-collision note.
  //
  // `no-mock-overuse` was the other strong candidate (clear keyword:
  // "mocking the system under test") but `flaky-test-detector` has MORE
  // distinct, independently-citable antipattern keywords, giving more natural
  // spread across the 5 required edge-case shapes below.
  //
  // Every `inputDiff` below is a small, valid unified diff — hand-traced to
  // parse correctly via `parseUnifiedDiff` (server/src/adapters/git/
  // diff-parser.ts); this feature's `grounding[]` is a substring check against
  // review OUTPUT TEXT, not diff line ranges, so the new-side line-numbering
  // pitfall documented elsewhere in this file does not apply here — the only
  // requirement is that the fixture parses without throwing.
  //
  // Fixed UUID literals + `.onConflictDoNothing()` keyed on `id` keep re-runs
  // of `pnpm db:seed` from duplicating rows (AC-38). `ownerKind: 'skill'`,
  // `ownerId: <flaky-test-detector's id>`, resolved via the same
  // `SELECT ... WHERE workspace_id = $1 AND name = $2` pattern already used
  // above for agents (here against `t.skills`, guarded so this whole section
  // no-ops if the skill lookup fails on a partial/customized seed run).
  //
  // Edge-case coverage (AC-20–AC-24, AC-27, AC-37):
  //   1. hardcoded-date-now-flake        — practices[] + grounding[] (both populated)
  //   2. math-random-flake               — practices[] + grounding[] (both populated)
  //   3. array-order-assumption-grounding — grounding[] only, practices[] empty
  //   4. boundary-empty-input-well-tested  — practices[] only, grounding[] empty
  //   5. network-call-fails-grounding      — deliberately fails the grounding gate
  const [flakyTestDetectorSkill] = await db
    .select()
    .from(t.skills)
    .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, 'flaky-test-detector')));
  if (flakyTestDetectorSkill) {
    const skillEvalCaseSeeds: Array<typeof t.evalCases.$inferInsert> = [
      {
        id: '33333333-3333-4333-a333-000000000001',
        workspaceId,
        ownerKind: 'skill',
        ownerId: flakyTestDetectorSkill.id,
        name: 'hardcoded Date.now() assertion',
        inputDiff: `diff --git a/src/modules/billing/invoice.test.ts b/src/modules/billing/invoice.test.ts
--- a/src/modules/billing/invoice.test.ts
+++ b/src/modules/billing/invoice.test.ts
@@ -8,6 +8,10 @@ describe('generateInvoice', () => {
   it('stamps the invoice with the current period', () => {
     const invoice = generateInvoice(customer, plan);
     expect(invoice.total).toBe(4200);
+  });
+
+  it('stamps the invoice with today\\'s date', () => {
+    const invoice = generateInvoice(customer, plan);
+    expect(invoice.issuedAt).toBe(Date.now());
   });
 });
`,
        expectedOutput: {
          practices: [
            'review output explains why asserting on Date.now() makes the test non-deterministic',
          ],
          grounding: ['Date.now()'],
          threshold: 0.6,
        },
        notes: 'Full two-tier case: grounding requires the literal "Date.now()" keyword; practices asks the judge to verify the review actually explains the flakiness, not just names the call.',
      },
      {
        id: '33333333-3333-4333-a333-000000000002',
        workspaceId,
        ownerKind: 'skill',
        ownerId: flakyTestDetectorSkill.id,
        name: 'unseeded Math.random() in assertion',
        inputDiff: `diff --git a/src/modules/pricing/discount.test.ts b/src/modules/pricing/discount.test.ts
--- a/src/modules/pricing/discount.test.ts
+++ b/src/modules/pricing/discount.test.ts
@@ -12,6 +12,11 @@ describe('applyPromoDiscount', () => {
     const result = applyPromoDiscount(100, 'SAVE10');
     expect(result).toBe(90);
   });
+
+  it('applies a random bonus discount', () => {
+    const bonus = Math.random() * 5;
+    const result = applyPromoDiscount(100, 'SAVE10', bonus);
+    expect(result).toBeLessThan(90);
+  });
 });
`,
        expectedOutput: {
          practices: [
            'review output explains that the assertion result depends on an unseeded random value',
          ],
          grounding: ['Math.random()'],
          threshold: 0.6,
        },
        notes: 'Full two-tier case: grounding requires the literal "Math.random()" keyword; practices verifies the judge can confirm the review connects the random value to assertion flakiness.',
      },
      {
        id: '33333333-3333-4333-a333-000000000003',
        workspaceId,
        ownerKind: 'skill',
        ownerId: flakyTestDetectorSkill.id,
        name: 'array order assumption without ORDER BY',
        inputDiff: `diff --git a/src/modules/audit/log.test.ts b/src/modules/audit/log.test.ts
--- a/src/modules/audit/log.test.ts
+++ b/src/modules/audit/log.test.ts
@@ -15,6 +15,10 @@ describe('listAuditEvents', () => {
     const events = await listAuditEvents(workspaceId);
     expect(events.length).toBe(2);
+  });
+
+  it('returns the most recent event first', async () => {
+    const events = await listAuditEvents(workspaceId);
+    expect(events[0].action).toBe('workspace.created');
   });
 });
`,
        expectedOutput: {
          practices: [],
          grounding: ['Array/object order assumptions', 'ORDER BY'],
          threshold: 0.6,
        },
        notes: 'Grounding-only case (AC-20/AC-22 edge case): no practices configured, so a pass/fail is determined entirely by the substring gate and the judge is never invoked — the query behind listAuditEvents has no ORDER BY, so asserting events[0] is a real order-assumption flake.',
      },
      {
        id: '33333333-3333-4333-a333-000000000004',
        workspaceId,
        ownerKind: 'skill',
        ownerId: flakyTestDetectorSkill.id,
        name: 'well-covered boundary input, no flakiness to report',
        inputDiff: `diff --git a/src/modules/pricing/discount.ts b/src/modules/pricing/discount.ts
--- a/src/modules/pricing/discount.ts
+++ b/src/modules/pricing/discount.ts
@@ -4,6 +4,9 @@ export function applyPromoDiscount(amount: number, code: string, bonus = 0): number {
+  if (amount <= 0) {
+    return 0;
+  }
   const base = code === 'SAVE10' ? amount * 0.9 : amount;
   return Math.max(0, base - bonus);
 }
diff --git a/src/modules/pricing/discount.test.ts b/src/modules/pricing/discount.test.ts
--- a/src/modules/pricing/discount.test.ts
+++ b/src/modules/pricing/discount.test.ts
@@ -1,5 +1,9 @@
 describe('applyPromoDiscount', () => {
+  it('returns zero for a zero amount', () => {
+    expect(applyPromoDiscount(0, 'SAVE10')).toBe(0);
+  });
+
+  it('returns zero for a negative amount', () => {
+    expect(applyPromoDiscount(-5, 'SAVE10')).toBe(0);
+  });
   it('applies the SAVE10 discount', () => {
     expect(applyPromoDiscount(100, 'SAVE10')).toBe(90);
   });
`,
        expectedOutput: {
          practices: [
            'review output does not flag any flaky-test pattern in this diff',
          ],
          grounding: [],
          threshold: 0.6,
        },
        notes: 'Practices-only case (AC-20/AC-22 edge case): no grounding requirement (empty array, vacuously satisfied), so the outcome is decided purely by the judge — a clean, deterministic boundary-case addition with no timing/randomness/ordering/network antipattern.',
      },
      {
        id: '33333333-3333-4333-a333-000000000005',
        workspaceId,
        ownerKind: 'skill',
        ownerId: flakyTestDetectorSkill.id,
        name: 'unstubbed network call (deliberately fails grounding)',
        inputDiff: `diff --git a/src/modules/webhooks/dispatch.test.ts b/src/modules/webhooks/dispatch.test.ts
--- a/src/modules/webhooks/dispatch.test.ts
+++ b/src/modules/webhooks/dispatch.test.ts
@@ -6,6 +6,11 @@ describe('dispatchWebhook', () => {
     const result = await dispatchWebhook(event);
     expect(result.delivered).toBe(true);
+  });
+
+  it('dispatches to the configured external endpoint', async () => {
+    const result = await fetch('https://webhook.example.com/health');
+    expect(result.status).toBe(200);
   });
 });
`,
        expectedOutput: {
          // Deliberately mismatched against the skill's realistic output for
          // this diff: a real flaky-test-detector review of an unstubbed
          // `fetch()` call would cite "External network calls" (the skill's
          // own vocabulary for this antipattern, ~seed.ts:436), NOT the string
          // below — demonstrating `failed_grounding` as a status distinct
          // from `failed_judge` (AC-21/AC-30): the gate fails and the judge
          // (which would otherwise assess the practices statement) is never
          // invoked.
          practices: [
            'review output explains that the test depends on a live external service',
          ],
          grounding: ['fake timers'],
          threshold: 0.6,
        },
        notes: 'Deliberate grounding-gate failure (AC-21/AC-30): the diff\'s real antipattern is an unstubbed network call, but the grounding substring asks for "fake timers" (a setTimeout/setInterval-specific phrase from the skill body that a real review of THIS diff would not use) — the gate fails and the judge is skipped entirely, producing a distinct failed_grounding outcome.',
      },
    ];

    for (const c of skillEvalCaseSeeds) {
      await db.insert(t.evalCases).values(c).onConflictDoNothing({ target: t.evalCases.id });
    }
  }

  return { workspaceId, userId };
}

// CLI entrypoint (cross-platform: compare native paths, not a hand-built file:// URL,
// which never matches on Windows where argv[1] uses backslashes).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
