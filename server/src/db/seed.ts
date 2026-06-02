import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';

/**
 * Seed from data.jsx / data2.jsx fixtures (§13). Idempotent: re-running upserts
 * the default workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, sample findings,
 * skills, agents, conventions, memory — for dev/demo/eval.
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
    automatic_reviews: false,
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

    // pr_intent
    await db.insert(t.prIntent).values({
      prId: pr!.id,
      intent:
        'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      inScope: [
        'Add middleware for rate limiting',
        'Apply to /api/public/* routes',
        'Return 429 with Retry-After header',
      ],
      outOfScope: [
        'Authentication changes',
        'Adding new endpoints',
        'Logging / observability for the limiter',
      ],
    });

    // pr_files (subset from data.jsx DIFF groups)
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

    // a seed review + findings (the data.jsx FINDINGS f1/f2/f3)
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
        kind: 'secret_leak',
      },
      {
        reviewId: review!.id,
        file: 'src/api/public/webhooks.ts',
        startLine: 61,
        endLine: 74,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Lethal trifecta: untrusted input reaches exfil path',
        rationale:
          'Untrusted callback_url + private API token + outbound fetch — all three trifecta legs.',
        suggestion: 'Allow-list callback_url; strip credentials before outbound requests.',
        confidence: 0.79,
        kind: 'lethal_trifecta',
        trifectaComponents: ['private_data_access', 'untrusted_input', 'exfil_path'],
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

  // ---- skills (data.jsx SKILLS) ----
  const seedSkills: Array<typeof t.skills.$inferInsert> = [
    {
      workspaceId,
      name: 'pr-quality-rubric',
      description:
        'Rubric for evaluating overall PR quality across correctness, tests, and clarity.',
      type: 'rubric',
      source: 'manual',
      body: '# PR Quality Rubric\nEvaluate correctness, security, tests, scope. Aim for ~5 high-signal findings.',
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: 'secret-leakage-gate',
      description: 'Detects sk_live, service_role, and NEXT_PUBLIC_ secret patterns in diffs.',
      type: 'security',
      source: 'community',
      body: 'Detect sk_live, service_role, NEXT_PUBLIC_ secret patterns.',
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: 'lethal-trifecta',
      description:
        'Flags PRs combining private data access, untrusted input, and an exfil path.',
      type: 'security',
      source: 'community',
      body: 'Flag the lethal trifecta: private data + untrusted input + exfil path.',
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: 'phantom-api-gate',
      description: "Detects imports of functions/modules that don't exist in resolved deps.",
      type: 'security',
      source: 'imported_url',
      body: 'Detect imports of nonexistent functions/modules (phantom APIs).',
      enabled: false,
      version: 1,
    },
  ];
  for (const s of seedSkills) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (!existing) await db.insert(t.skills).values(s);
  }

  // ---- agents (data2.jsx AGENTS, as enabled agents for demo) ----
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt:
        'You are a security-focused PR reviewer. Examine the diff for hardcoded secrets, untrusted input reaching a sink, and the lethal trifecta. Return at most 5 findings ranked by severity. Cite exact file:line.',
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: 'openai',
      model: 'gpt-4o',
      systemPrompt: 'You review pull requests for performance regressions.',
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

  // ---- conventions (data.jsx CONVENTIONS candidates) ----
  const seedConventions: Array<typeof t.conventions.$inferInsert> = [
    {
      workspaceId,
      repoId,
      rule: 'Always use async/await instead of .then() chains',
      evidencePath: 'src/api/users.ts:23-31',
      evidenceSnippet: 'const user = await db.users.find(id);',
      confidence: 0.91,
      accepted: false,
    },
    {
      workspaceId,
      repoId,
      rule: 'Redis access goes through src/lib/redis.ts singleton',
      evidencePath: 'src/lib/redis.ts:1-9',
      evidenceSnippet: 'export const redis = new Redis(config.redisUrl);',
      confidence: 0.85,
      accepted: false,
    },
  ];
  // conventions have no natural unique key in schema; only seed if none exist for repo
  const existingConv = await db
    .select()
    .from(t.conventions)
    .where(eq(t.conventions.repoId, repoId));
  if (existingConv.length === 0) {
    await db.insert(t.conventions).values(seedConventions);
  }

  // ---- memory (data.jsx MEMORY learnings; embeddings left null — A5 fills) ----
  const existingMem = await db
    .select()
    .from(t.memory)
    .where(eq(t.memory.workspaceId, workspaceId));
  if (existingMem.length === 0) {
    await db.insert(t.memory).values([
      {
        workspaceId,
        repoId,
        scope: 'repo',
        kind: 'learning',
        content:
          "Don't flag try/catch around JSON.parse — it's intentional defensive parsing in this repo.",
        confidence: 0.93,
        sources: [{ pr: 482, context: 'learned from a dismissed finding' }],
      },
      {
        workspaceId,
        scope: 'global',
        kind: 'preference',
        content:
          'Prefer Vitest over Jest assertions; this org standardized on it.',
        confidence: 0.95,
        sources: [{ pr: 277, context: 'org standard' }],
      },
    ]);
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
