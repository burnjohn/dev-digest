import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
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

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
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

  // ---- skill catalog ----
  const skillCatalog = [
    {
      name: 'pr-quality-rubric',
      description: 'Structured rubric for evaluating overall PR quality — correctness, testing, docs.',
      type: 'rubric' as const,
      source: 'manual' as const,
      body: `# PR Quality Rubric

Evaluate the PR against these dimensions and flag any dimension that scores below threshold.

## Correctness (weight: 40%)
- Logic errors, off-by-one, wrong comparisons, operator precedence.
- Missing null/undefined guards at system boundaries.
- Race conditions in async code.

## Testing (weight: 30%)
- Changed code has corresponding tests.
- Tests exercise the failure path, not just the happy path.
- No mock-only tests that hide real failures.

## Documentation (weight: 15%)
- Public API surface has JSDoc or inline comments for non-obvious behavior.
- CHANGELOG / migration guide updated for breaking changes.

## Code clarity (weight: 15%)
- Variable and function names are unambiguous.
- Functions are at a single level of abstraction.
- Magic numbers are named constants.`,
      enabled: true,
      version: 1,
    },
    {
      name: 'no-then-chains',
      description: 'Flag .then()/.catch() chains; prefer async/await for readability.',
      type: 'convention' as const,
      source: 'manual' as const,
      body: `# No Promise.then() Chains

Flag any .then()/.catch() chain that can be replaced by async/await.

## Rule
- WARN on .then() chains longer than 1 hop.
- WARN on .catch() handlers that suppress errors without logging.
- CRITICAL on .then() inside a .then() (nested promise chains).

## Good
\`\`\`ts
const data = await fetchUser(id);
const enriched = await enrich(data);
\`\`\`

## Bad
\`\`\`ts
fetchUser(id).then(data => enrich(data)).then(enriched => save(enriched));
\`\`\``,
      enabled: true,
      version: 1,
    },
    {
      name: 'secret-leakage-gate',
      description: 'Detect hardcoded secrets, API keys, and credentials committed to source.',
      type: 'security' as const,
      source: 'manual' as const,
      body: `# Secret Leakage Gate

Scan every changed file for hardcoded credentials.

## Patterns to flag as CRITICAL
- String literals matching: sk_live_, sk_test_, AKIA, ghp_, ghs_, xoxb-, xoxp-
- Assignments like password = "...", secret = "...", api_key = "..."
- Base64-encoded blobs of 20+ chars in string literals
- PEM headers (-----BEGIN PRIVATE KEY-----)

## Patterns to flag as WARNING
- Hard-coded localhost URLs with embedded credentials
- .env files accidentally staged

## Exception
Test fixtures with clearly fake keys (e.g. test_key_abc123) are INFO only.`,
      enabled: true,
      version: 1,
    },
    {
      name: 'lethal-trifecta',
      description: 'Flags the deadly combo: deserialization + privilege escalation + command execution.',
      type: 'security' as const,
      source: 'manual' as const,
      body: `# Lethal Trifecta Gate

Flag any code path that combines all three:
1. Deserialization of untrusted input (JSON.parse, eval, vm.runInNewContext)
2. Privilege escalation (sudo, setuid, os.exec with elevated context)
3. Dynamic command construction from that input

## Severity
CRITICAL when all three are present in a traceable data flow.
WARNING when two are present and the third is plausible.

## Examples of CRITICAL
- JSON.parse(userInput) fed into exec()
- YAML.load(req.body) with constructor gadget in scope`,
      enabled: true,
      version: 1,
    },
    {
      name: 'test-coverage-nudge',
      description: 'Nudge reviewers to flag changed code without corresponding test changes.',
      type: 'rubric' as const,
      source: 'manual' as const,
      body: `# Test Coverage Nudge

For every non-trivial source file changed in the PR, verify a corresponding test file was also touched.

## Rule
- WARN when a src/ file is changed but no test/ or *.test.* file was touched.
- INFO when the changed code is configuration-only (no logic branches).
- Exempt: migrations, generated files, type-only changes.`,
      enabled: true,
      version: 1,
    },
    {
      name: 'uncovered-branches',
      description: 'Flag conditional branches with no corresponding test assertions.',
      type: 'rubric' as const,
      source: 'manual' as const,
      body: `# Uncovered Branch Detector

Review each conditional in the diff and check whether the test suite exercises both sides.

## CRITICAL
- Error handler catch block with no test that triggers the error path.
- Guard clause (early return) with no test for the guard condition.

## WARNING
- Ternary with no test for the false branch.
- Default parameter with no test that omits the argument.

## How to check
Look for describe/it/test blocks in the diff for corresponding assertions.
If no test file exists for a changed source file, escalate to WARNING.`,
      enabled: true,
      version: 1,
    },
    {
      name: 'edge-case-coverage',
      description: 'Check for missing edge-case tests: empty, null, zero, max boundary.',
      type: 'rubric' as const,
      source: 'manual' as const,
      body: `# Edge Case Coverage Checker

Look for common missing edge cases in the test diff.

## Empty / zero / null
- Array inputs: is there a test with [] input?
- String inputs: is there a test with '' input?
- Numeric inputs: is there a test with 0 and negative values?

## Boundary
- Off-by-one: n-1, n, n+1 around known limits.
- Pagination: first page, last page, page beyond end.

## Async / concurrency
- Parallel mutations without a test that races two operations.
- Timeout / retry: is there a test that simulates the timeout path?`,
      enabled: true,
      version: 1,
    },
    {
      name: 'mock-overuse-gate',
      description: 'Detect excessive mocking that makes tests meaningless.',
      type: 'custom' as const,
      source: 'manual' as const,
      body: `# Mock Overuse Gate

Flag tests where mocking undermines the test's validity.

## CRITICAL
- The module under test is itself mocked.
- Every dependency is mocked, leaving no real code path exercised.
- A mock is set up but never asserted upon when the test's purpose is exactly that interaction.

## WARNING
- Database mocked with a static return — the real DB would reject the input.
- jest.spyOn used to silence real I/O without restoring it (test pollution).`,
      enabled: false,
      version: 1,
    },
  ];

  // Seed skills idempotently
  const skillIds: Record<string, string> = {};
  for (const sk of skillCatalog) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, sk.name)));
    if (!existing) {
      const [row] = await db.insert(t.skills).values({ workspaceId, ...sk }).returning();
      skillIds[sk.name] = row!.id;
      // Seed initial version snapshot
      await db.insert(t.skillVersions).values({ skillId: row!.id, version: 1, body: sk.body }).onConflictDoNothing();
    } else {
      skillIds[sk.name] = existing.id;
    }
  }

  // ---- Link skills to existing agents ----
  // Find Security Reviewer and Performance Reviewer agents
  const [secAgent] = await db.select().from(t.agents).where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
  const [perfAgent] = await db.select().from(t.agents).where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Performance Reviewer')));

  if (secAgent && skillIds['secret-leakage-gate']) {
    await db.insert(t.agentSkills).values({ agentId: secAgent.id, skillId: skillIds['secret-leakage-gate']!, order: 0 }).onConflictDoNothing();
    await db.insert(t.agentSkills).values({ agentId: secAgent.id, skillId: skillIds['lethal-trifecta']!, order: 1 }).onConflictDoNothing();
  }
  if (perfAgent && skillIds['pr-quality-rubric']) {
    await db.insert(t.agentSkills).values({ agentId: perfAgent.id, skillId: skillIds['pr-quality-rubric']!, order: 0 }).onConflictDoNothing();
    await db.insert(t.agentSkills).values({ agentId: perfAgent.id, skillId: skillIds['test-coverage-nudge']!, order: 1 }).onConflictDoNothing();
  }

  // ---- Test Quality Reviewer + linked skills ----
  const [testAgent] = await db.select().from(t.agents).where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Test Quality Reviewer')));
  if (!testAgent) {
    const [tqRow] = await db.insert(t.agents).values({
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Reviews PRs for test coverage gaps, mock overuse, and flaky patterns.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    }).returning();
    // Link 3 skills (4th will be imported live in demo)
    const tqSkillsToLink = ['uncovered-branches', 'edge-case-coverage', 'mock-overuse-gate'];
    for (const [i, name] of tqSkillsToLink.entries()) {
      if (skillIds[name]) {
        await db.insert(t.agentSkills).values({ agentId: tqRow!.id, skillId: skillIds[name]!, order: i }).onConflictDoNothing();
      }
    }
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
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
