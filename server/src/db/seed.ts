import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { SEED_SKILLS, SEED_AGENT_SKILLS } from './seed-skills.js';
import { EVAL_FIXTURE_PR, EVAL_FIXTURE_CASES } from './seed-eval-cases.js';
import { synthesizeFrozenDiff } from '../modules/eval/frozen-input.js';
import type { EvalCaseMeta, EvalExpectation } from '@devdigest/shared';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, the five built-in agents (General + Security +
 * Performance + Test Quality + API Contract), all on the default
 * openrouter/deepseek-v4-flash provider+model, and the L02/specs-03 skill
 * catalogue with its agent links.
 *
 * Course lessons populate the remaining tables (conventions, memory, eval, …)
 * once their features are built — they start empty here.
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

  // ---- fixture PR #491 (specs/12-eval-pipeline.md D22/Q4) ----
  // A second PR on the SAME demo repo, with REAL `pr_files.patch` text
  // (unlike PR #482, whose patch is null on every row) — the prerequisite
  // for the seven fixture eval cases below, each of which needs a real hunk
  // to ground its expectation against (AC-6).
  let [evalPr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, EVAL_FIXTURE_PR.number)));
  if (!evalPr) {
    [evalPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: EVAL_FIXTURE_PR.number,
        title: EVAL_FIXTURE_PR.title,
        author: EVAL_FIXTURE_PR.author,
        branch: EVAL_FIXTURE_PR.branch,
        base: EVAL_FIXTURE_PR.base,
        headSha: EVAL_FIXTURE_PR.headSha,
        additions: EVAL_FIXTURE_PR.files.reduce((n, f) => n + f.additions, 0),
        deletions: EVAL_FIXTURE_PR.files.reduce((n, f) => n + f.deletions, 0),
        filesCount: EVAL_FIXTURE_PR.files.length,
        status: 'needs_review',
        body: EVAL_FIXTURE_PR.body,
      })
      .returning();

    await db.insert(t.prFiles).values(
      EVAL_FIXTURE_PR.files.map((f) => ({
        prId: evalPr!.id,
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      })),
    );
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
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description:
        'Reviews the tests in a PR: uncovered branches, missed corner cases, over-mocking, flakes.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description:
        'Reviews public API contracts in a PR: breaking route/param/response changes, semver discipline.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
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

  // ---- skill catalogue (L02 + specs/03) ----
  // Bodies live in ./seed-skills.ts. Deliberately NOT seeded: `api-contract-guard`
  // and `deprecation-policy`, both imported through the UI's preview-then-confirm
  // flow so the import path is exercised end to end.
  //
  // No run history is fabricated here. A fresh install shows every stats tile as
  // "—" (unmeasured, not zero) and the numbers arrive only once real runs happen
  // — which is the point of the control experiment, not a gap in the seed.
  for (const s of SEED_SKILLS) {
    await db
      .insert(t.skills)
      .values({
        workspaceId,
        name: s.name,
        description: s.description,
        type: s.type,
        source: s.source,
        body: s.body,
        enabled: s.enabled,
        version: 1,
      })
      .onConflictDoNothing();
  }

  // ---- agent ↔ skill links ----
  // `order` is the order of blocks in the assembled prompt. Links are seeded
  // enabled; the per-agent gate (`agent_skills.enabled`) is what the editor's
  // checkbox toggles, and it survives being switched off so `order` is kept.
  const skillRows = await db
    .select({ id: t.skills.id, name: t.skills.name })
    .from(t.skills)
    .where(eq(t.skills.workspaceId, workspaceId));
  const skillIdByName = new Map(skillRows.map((r) => [r.name, r.id]));

  for (const [agentName, skillNames] of Object.entries(SEED_AGENT_SKILLS)) {
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
    if (!agent) continue;
    for (const [order, skillName] of skillNames.entries()) {
      const skillId = skillIdByName.get(skillName);
      if (!skillId) continue;
      await db
        .insert(t.agentSkills)
        .values({ agentId: agent.id, skillId, order, enabled: true })
        .onConflictDoNothing();
    }
  }

  // ---- eval cases (specs/12-eval-pipeline.md D22/Q4) ----
  // Seven fixture cases for the Security Reviewer, both expectation types
  // represented. `source_finding_id` is null — these are fixtures, not
  // derived from a triaged finding, which leaves the LIVE 8th case free to
  // be created on camera during the AC-1…AC-7 demonstration. No `eval_runs`
  // are seeded, consistent with this file's "no run history is fabricated
  // here" posture above (AC-47's empty state).
  const [securityReviewer] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
  if (securityReviewer) {
    const existingCases = await db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, securityReviewer.id),
        ),
      );
    if (existingCases.length === 0) {
      const patchByPath = new Map(EVAL_FIXTURE_PR.files.map((f) => [f.path, f.patch]));
      await db.insert(t.evalCases).values(
        EVAL_FIXTURE_CASES.map((c) => {
          const patch = patchByPath.get(c.file)!;
          const expectation: EvalExpectation = {
            type: c.type,
            file: c.file,
            start_line: c.start_line,
            end_line: c.end_line,
            severity: c.severity,
            category: c.category,
            title: c.title,
          };
          const inputMeta: EvalCaseMeta = {
            pr_number: EVAL_FIXTURE_PR.number,
            title: EVAL_FIXTURE_PR.title,
            body: EVAL_FIXTURE_PR.body,
          };
          return {
            workspaceId,
            ownerKind: 'agent' as const,
            ownerId: securityReviewer.id,
            name: c.name,
            inputDiff: synthesizeFrozenDiff(c.file, patch),
            inputFiles: [c.file],
            inputMeta,
            expectedOutput: expectation,
            notes: null,
            sourceFindingId: null,
          };
        }),
      );
    }
  }

  // ---- skill-owned eval cases (specs/15-skill-eval-cases.md AC-30/AC-31, R2) ----
  // Owner: `secret-leakage-gate` — already linked to `Security Reviewer`
  // (`SEED_AGENT_SKILLS`), the carrier for AC-31's demonstration (delete the
  // `sk_live_` bullet from the skill body, re-run, watch recall lift fall).
  // Four of the seven fixture cases over the SAME fixture PR #491, satisfying
  // AC-30's "at least four, at least one of each expectation type" with two
  // of each. `source_finding_id: null`, no `eval_runs` seeded — same
  // no-fabricated-history / empty-state posture as the agent-owned block above.
  const [secretLeakageGate] = await db
    .select()
    .from(t.skills)
    .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, 'secret-leakage-gate')));
  if (secretLeakageGate) {
    const existingSkillCases = await db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'skill'),
          eq(t.evalCases.ownerId, secretLeakageGate.id),
        ),
      );
    if (existingSkillCases.length === 0) {
      const SKILL_FIXTURE_CASE_NAMES = new Set([
        'hardcoded-session-signing-secret',
        'refresh-token-payload-logged-in-plaintext',
        'crypto-import-is-clean',
        'rate-limiter-addition-is-clean',
      ]);
      const patchByPath = new Map(EVAL_FIXTURE_PR.files.map((f) => [f.path, f.patch]));
      const skillFixtureCases = EVAL_FIXTURE_CASES.filter((c) => SKILL_FIXTURE_CASE_NAMES.has(c.name));
      await db.insert(t.evalCases).values(
        skillFixtureCases.map((c) => {
          const patch = patchByPath.get(c.file)!;
          const expectation: EvalExpectation = {
            type: c.type,
            file: c.file,
            start_line: c.start_line,
            end_line: c.end_line,
            severity: c.severity,
            category: c.category,
            title: c.title,
          };
          const inputMeta: EvalCaseMeta = {
            pr_number: EVAL_FIXTURE_PR.number,
            title: EVAL_FIXTURE_PR.title,
            body: EVAL_FIXTURE_PR.body,
          };
          return {
            workspaceId,
            ownerKind: 'skill' as const,
            ownerId: secretLeakageGate.id,
            name: c.name,
            inputDiff: synthesizeFrozenDiff(c.file, patch),
            inputFiles: [c.file],
            inputMeta,
            expectedOutput: expectation,
            notes: null,
            sourceFindingId: null,
          };
        }),
      );
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
