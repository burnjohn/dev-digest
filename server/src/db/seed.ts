import "dotenv/config";
import { createDb, type Db } from "./client.js";
import * as t from "./schema.js";
import { eq, and } from "drizzle-orm";

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the two built-in agents (General + Security).
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = "default";
export const SYSTEM_USER_EMAIL = "you@local";

export async function seed(
  db: Db,
): Promise<{ workspaceId: string; userId: string }> {
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

  let [user] = await db
    .select()
    .from(t.users)
    .where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: "You" })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: "owner" })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: "dark",
    density: "regular",
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
    .where(
      and(
        eq(t.repos.workspaceId, workspaceId),
        eq(t.repos.fullName, "acme/payments-api"),
      ),
    );
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: "acme",
        name: "payments-api",
        fullName: "acme/payments-api",
        defaultBranch: "main",
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
    .where(
      and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)),
    );
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: "Add rate limiting to public API endpoints",
        author: "marisa.koch",
        branch: "feat/rate-limit-public",
        base: "main",
        headSha: "a1b2c3d4e5f6",
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: "needs_review",
        body: "Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.",
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      {
        prId: pr!.id,
        path: "src/middleware/ratelimit.ts",
        additions: 84,
        deletions: 0,
      },
      {
        prId: pr!.id,
        path: "src/api/public/webhooks.ts",
        additions: 31,
        deletions: 6,
      },
      { prId: pr!.id, path: "src/config.ts", additions: 4, deletions: 0 },
      { prId: pr!.id, path: "src/api/users.ts", additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: "a1b2c3d4e5f6",
      message: "Add token-bucket rate limiter",
      author: "marisa.koch",
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: "review",
        verdict: "request_changes",
        summary:
          "Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.",
        score: 61,
        model: "seed",
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: "src/config.ts",
        startLine: 12,
        endLine: 12,
        severity: "CRITICAL",
        category: "security",
        title: "Hardcoded Stripe secret key in commit",
        rationale: "Line 12 contains a literal `sk_live_` Stripe secret key.",
        suggestion: "Move to env var and rotate the key immediately.",
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: "src/api/users.ts",
        startLine: 45,
        endLine: 52,
        severity: "WARNING",
        category: "perf",
        title: "N+1 query in user list endpoint",
        rationale: "Loop issues one query per user → N+1.",
        suggestion: "Use a single IN query and group in memory.",
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the two starter presets) ----
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: "General Reviewer",
      description: "Reviews a PR diff for bugs, correctness, and clarity.",
      provider: "openai",
      model: "gpt-4.1",
      systemPrompt:
        "You are a pragmatic pull-request reviewer. Examine the diff for bugs, correctness issues, missing edge cases, and unclear code. Return at most 5 high-value findings ranked by severity. Cite exact file:line.",
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: "Security Reviewer",
      description:
        "Flags secrets, injection, and untrusted-input sinks before merge.",
      provider: "openai",
      model: "gpt-4.1",
      systemPrompt:
        "You are a security-focused PR reviewer. Examine the diff for hardcoded secrets, injection, SSRF, and untrusted input reaching a dangerous sink. Return at most 5 findings ranked by severity. Cite exact file:line.",
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: "Test Quality Reviewer",
      description:
        "Checks test coverage, corner cases, excessive mocking, and flaky patterns.",
      provider: "openai",
      model: "gpt-4.1",
      systemPrompt:
        "You are a test-quality PR reviewer. Examine the diff for uncovered branches, missing corner cases, excessive mocking that hides real behaviour, and flaky test patterns (time-dependent, random, order-dependent). Return at most 5 findings ranked by severity. Cite exact file:line.",
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(
        and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)),
      );
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- skills (6 reusable instruction blocks) ----
  const seedSkills: Array<{
    slug: string;
    values: typeof t.skills.$inferInsert;
  }> = [
    {
      slug: "pr-quality-rubric",
      values: {
        workspaceId,
        name: "PR Quality Rubric",
        description:
          "General PR quality rubric covering clarity, correctness, and edge cases.",
        type: "rubric",
        source: "manual",
        body: `# PR Quality Rubric

Score the pull request on the following dimensions:

1. **Clarity** — Is the code readable without needing the author to explain it?
2. **Correctness** — Are there obvious bugs, off-by-one errors, or logic issues?
3. **Edge cases** — Does the code handle null/undefined, empty collections, and boundary values?
4. **Naming** — Are variables, functions, and types named to reveal intent?
5. **Size** — Is the PR small enough to review meaningfully in one sitting (< 400 lines changed)?

Flag any dimension that scores below 3/5.`,
        enabled: true,
        version: 1,
      },
    },
    {
      slug: "no-then-chains",
      values: {
        workspaceId,
        name: "No .then() Chains",
        description: "Forbid .then() chaining — require async/await instead.",
        type: "convention",
        source: "manual",
        body: `# Convention: No .then() Chains

**Rule:** Do not use \`.then()\` / \`.catch()\` / \`.finally()\` chains. Use \`async/await\` instead.

**Why:** Promise chains obscure control flow, make error handling error-prone, and complicate debugging.

**Flag any diff line that:**
- Calls \`.then(\` on a promise
- Chains \`.catch(\` without \`try/catch\`
- Nests \`.then(\` inside another \`.then(\`

**Correct pattern:**
\`\`\`ts
// ✅ Good
const result = await fetchUser(id);

// ❌ Bad
fetchUser(id).then(result => { ... });
\`\`\``,
        enabled: true,
        version: 1,
      },
    },
    {
      slug: "secret-leakage-gate",
      values: {
        workspaceId,
        name: "Secret Leakage Gate",
        description:
          "Detect hardcoded secrets, API keys, and credentials in the diff.",
        type: "security",
        source: "manual",
        body: `# Security: Secret Leakage Gate

**Critical check:** Scan the diff for hardcoded secrets.

Flag as CRITICAL if the diff contains:
- API keys (patterns: \`sk_live_\`, \`pk_live_\`, \`AKIA\`, \`ghp_\`, \`ghs_\`)
- Passwords or tokens in string literals assigned to variables named \`password\`, \`secret\`, \`token\`, \`key\`, \`credential\`
- Private keys (PEM headers: \`-----BEGIN RSA PRIVATE KEY-----\`)
- Database connection strings with embedded credentials
- JWT secrets hardcoded in source

**Action:** If found, mark severity CRITICAL and suggest moving to environment variable or secrets manager.`,
        enabled: true,
        version: 1,
      },
    },
    {
      slug: "lethal-trifecta",
      values: {
        workspaceId,
        name: "Lethal Trifecta",
        description:
          "Detect private data + untrusted input + exfiltration path in same change.",
        type: "security",
        source: "manual",
        body: `# Security: Lethal Trifecta

The "lethal trifecta" is when a single change touches all three of:
1. **Private data** — PII, credentials, financial data, internal IDs
2. **Untrusted input** — user-supplied query params, request body, headers, file uploads
3. **Exfiltration path** — HTTP response, log statement, file write, external API call

**Flag as CRITICAL** if the diff introduces or modifies code where all three elements are reachable in the same data-flow path.

**Examples:**
- Reading \`req.body.userId\` and returning it in an error message that includes DB row data
- Logging user input alongside internal system state
- Passing URL query params directly to an external HTTP call that returns sensitive data`,
        enabled: true,
        version: 1,
      },
    },
    {
      slug: "phantom-api-gate",
      values: {
        workspaceId,
        name: "Phantom API Gate",
        description:
          "Detect undocumented or phantom API calls introduced in the diff.",
        type: "security",
        source: "manual",
        body: `# Security: Phantom API Gate

**Rule:** Every external HTTP call must be intentional, documented, and scoped.

Flag as WARNING or CRITICAL if the diff:
- Introduces a \`fetch()\`, \`axios()\`, \`http.get()\`, or similar call to a URL not previously present
- Passes user-controlled data as part of the URL or request body to an external endpoint
- Adds a new outbound endpoint not listed in the API contract or architecture docs
- Calls an internal service endpoint that bypasses authentication middleware

**Ask:** Is this call documented? Is the destination URL allowlisted? Does it leak internal data?`,
        enabled: true,
        version: 1,
      },
    },
    {
      slug: "test-coverage-nudge",
      values: {
        workspaceId,
        name: "Test Coverage Nudge",
        description:
          "Flag missing test coverage for changed branches and new functions.",
        type: "custom",
        source: "manual",
        body: `# Test Coverage Nudge

For every new function, method, or branch introduced in the diff, check whether a corresponding test exists.

**Flag as WARNING if:**
- A new \`if\` / \`else\` / \`switch\` branch has no test covering the alternate path
- A new exported function has no test file or test case referencing it
- An error path (\`catch\`, early \`return\`, \`throw\`) is reachable but not tested
- A public API route has no integration test

**Do not flag:**
- Trivial getters/setters with no logic
- Generated code or migrations
- Test files themselves

Suggest adding a test case with the specific scenario that would exercise the uncovered path.`,
        enabled: true,
        version: 1,
      },
    },
  ];

  const skillIdBySlug = new Map<string, string>();
  for (const { slug, values } of seedSkills) {
    let [existing] = await db
      .select()
      .from(t.skills)
      .where(
        and(
          eq(t.skills.workspaceId, workspaceId),
          eq(t.skills.name, values.name),
        ),
      );
    if (!existing) {
      [existing] = await db.insert(t.skills).values(values).returning();
      // snapshot version 1 into skill_versions
      await db
        .insert(t.skillVersions)
        .values({ skillId: existing!.id, version: 1, body: values.body })
        .onConflictDoNothing();
    }
    skillIdBySlug.set(slug, existing!.id);
  }

  // ---- agent–skill links ----
  // Security Reviewer: pr-quality-rubric, secret-leakage-gate, lethal-trifecta
  // Test Quality Reviewer: pr-quality-rubric, test-coverage-nudge, no-then-chains, phantom-api-gate
  const agentSkillLinks: Array<{ agentName: string; skillSlugs: string[] }> = [
    {
      agentName: "Security Reviewer",
      skillSlugs: [
        "pr-quality-rubric",
        "secret-leakage-gate",
        "lethal-trifecta",
      ],
    },
    {
      agentName: "Test Quality Reviewer",
      skillSlugs: [
        "pr-quality-rubric",
        "test-coverage-nudge",
        "no-then-chains",
        "phantom-api-gate",
      ],
    },
  ];

  for (const { agentName, skillSlugs } of agentSkillLinks) {
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.agents.name, agentName),
        ),
      );
    if (!agent) continue;
    for (let i = 0; i < skillSlugs.length; i++) {
      const skillId = skillIdBySlug.get(skillSlugs[i]!);
      if (!skillId) continue;
      await db
        .insert(t.agentSkills)
        .values({ agentId: agent.id, skillId, order: i })
        .onConflictDoNothing();
    }
  }

  // ---- API Contract Reviewer skills ----
  const apiSkillDefs = [
    {
      slug: "breaking-change",
      name: "breaking-change",
      description:
        "Detects removal or renaming of public API contracts without version bump.",
      type: "security" as const,
      source: "manual" as const,
      body: `# Breaking Change Gate

Flag any diff that removes, renames, or changes the type of a public API element without a version bump.

**Flag as CRITICAL if the diff:**
- Removes a public endpoint without prior deprecation notice
- Renames a field in a request or response body
- Changes a field from optional to required
- Changes a field's type (string → number, array → object)
- Removes a query or path parameter

**Good — additive change (safe):**
\`\`\`ts
type UserResponse = { id: string; name: string; email?: string }
\`\`\`

**Bad — breaking removal:**
\`\`\`ts
type UserResponse = { id: string }  // removed name and email
\`\`\`

Cite file:line and explain what downstream callers will break.`,
    },
    {
      slug: "response-schema",
      name: "response-schema",
      description:
        "Enforces backwards-compatible response schema changes only.",
      type: "convention" as const,
      source: "manual" as const,
      body: `# Response Schema Discipline

Enforce that response schemas only change in backwards-compatible ways.

**Allowed without version bump:**
- Adding new OPTIONAL fields to a response
- Making a required field optional (wider)

**NOT allowed without version bump — flag as WARNING:**
- Removing existing fields from a response
- Making an optional field required (narrower)
- Changing a field's type
- Changing a field from nullable to non-nullable

**Check:** TypeScript interface/type changes in files under src/api/, src/routes/, or any file exporting a response schema.`,
    },
    {
      slug: "semver-discipline",
      name: "semver-discipline",
      description:
        "Flags breaking API changes without a corresponding major version bump.",
      type: "convention" as const,
      source: "manual" as const,
      body: `# SemVer Discipline

Flag when a breaking API change is merged without a major version bump.

**MAJOR bump required:** Any breaking change to a public endpoint, removal of endpoint, change in auth scheme.
**MINOR bump sufficient:** New optional endpoints or fields.
**PATCH sufficient:** Bug fixes that don't change API shape.

**How to check:** Look for changes in package.json version field, openapi.yaml, or API version constants. If there is a breaking change but no major version bump — flag as WARNING.`,
    },
    {
      slug: "deprecation-policy",
      name: "deprecation-policy",
      description:
        "Enforces deprecate-first policy before removing any public API element.",
      type: "convention" as const,
      source: "manual" as const,
      body: `# Deprecation Policy

Never silently remove a public API element. Always deprecate first, then remove in a future major version.

**Correct cycle:** v1.x → Add @deprecated JSDoc + runtime warning log → v2.0 → Remove

**Flag as WARNING if the diff:**
- Removes an endpoint without a prior @deprecated marker in the codebase
- Removes a field without documenting the removal in CHANGELOG
- Deletes a route handler without a redirect or 410 Gone response

**Good pattern:**
\`\`\`ts
/** @deprecated Use /v2/users instead. Scheduled for removal in v3.0. */
app.get('/v1/users', deprecationMiddleware('/v2/users'), handler);
\`\`\``,
    },
  ];

  const apiSkillIds = new Map<string, string>();
  for (const s of apiSkillDefs) {
    let [existing] = await db
      .select()
      .from(t.skills)
      .where(
        and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)),
      );
    if (!existing) {
      [existing] = await db
        .insert(t.skills)
        .values({
          workspaceId,
          name: s.name,
          description: s.description,
          type: s.type,
          source: s.source,
          body: s.body,
          enabled: true,
          version: 1,
        })
        .returning();
      await db
        .insert(t.skillVersions)
        .values({ skillId: existing!.id, version: 1, body: s.body })
        .onConflictDoNothing();
    }
    apiSkillIds.set(s.slug, existing!.id);
  }

  // ---- API Contract Reviewer agent ----
  const [existingApiAgent] = await db
    .select()
    .from(t.agents)
    .where(
      and(
        eq(t.agents.workspaceId, workspaceId),
        eq(t.agents.name, "API Contract Reviewer"),
      ),
    );

  if (!existingApiAgent) {
    const [apiAgent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: "API Contract Reviewer",
        description:
          "Detects breaking API changes, schema violations, and versioning issues before merge.",
        provider: "openai",
        model: "gpt-4.1",
        systemPrompt: `You are an API contract expert reviewing pull requests. Your job is to detect changes that could break API consumers.

Focus on:
1. Breaking changes to public API signatures (renamed fields, removed endpoints, changed types)
2. Response schema mutations (new required fields, changed nullability, type widening/narrowing)
3. Versioning discipline violations (breaking change without major bump)
4. Missing deprecation notices (silent removal vs. proper deprecation → removal cycle)

For each finding cite the exact file:line and suggest a backwards-compatible alternative. Return at most 5 high-signal findings ranked by severity.`,
        enabled: true,
        version: 1,
        createdBy: userId,
      })
      .returning();

    const slugOrder = [
      "breaking-change",
      "response-schema",
      "semver-discipline",
      "deprecation-policy",
    ];
    for (let i = 0; i < slugOrder.length; i++) {
      const skillId = apiSkillIds.get(slugOrder[i]!);
      if (skillId) {
        await db
          .insert(t.agentSkills)
          .values({ agentId: apiAgent!.id, skillId, order: i })
          .onConflictDoNothing();
      }
    }
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log("✓ seeded", r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("✗ seed failed:", err);
      await handle.close();
      process.exit(1);
    });
}
