import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { MockCiActionsClient } from '../src/modules/ci/actions-client.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review, Conformance } from '@devdigest/shared';

// A4's modules are wired by the orchestrator in modules/index.ts at the
// checkpoint; until then the tests register the plugins directly onto the app
// instance (buildApp does not call .ready(), so post-registration is allowed).
import evalRoutes from '../src/modules/eval/routes.js';
import composeRoutes from '../src/modules/compose/routes.js';
import ciRoutes from '../src/modules/ci/routes.js';
import conformanceRoutes from '../src/modules/conformance/routes.js';
import hooksRoutes from '../src/modules/hooks/routes.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

const CONFORMANCE_FIXTURE: Conformance = {
  spec_id: 'rate-limiting.prd.md',
  spec_title: 'Rate Limiting',
  items: [
    {
      requirement: 'All public endpoints must be rate-limited',
      status: 'implemented',
      evidence_file: 'src/middleware/ratelimit.ts:25',
      notes: 'Token-bucket limiter applied',
    },
    {
      requirement: '429 responses must include Retry-After',
      status: 'missing',
      evidence_file: null,
      notes: 'Only status is set',
    },
    {
      requirement: 'Webhook forwarding',
      status: 'out_of_scope',
      evidence_file: 'src/api/public/webhooks.ts:61',
      notes: 'Scope creep',
    },
  ],
  completeness_pct: 50,
};

let seq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${seq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A4 eval / compose / ci / conformance / hooks (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function appWith(opts: {
    structured?: unknown;
    github?: MockGitHubClient;
    ciActions?: MockCiActionsClient;
  } = {}) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: opts.github ?? new MockGitHubClient(),
        llm: { openai: new MockLLMProvider('openai', { structured: opts.structured ?? REVIEW_FIXTURE }) },
      },
    });
    if (opts.ciActions) {
      (app as unknown as { ciActionsClient: MockCiActionsClient }).ciActionsClient = opts.ciActions;
    }
    // eval/compose/ci/conformance/hooks are registered via the canonical module
    // registry (src/modules/index.ts) since orchestrator integration.
    void [evalRoutes, composeRoutes, ciRoutes, conformanceRoutes, hooksRoutes];
    return app;
  }

  async function makeAgent(app: FastifyInstance, name: string) {
    return (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();
  }

  // ---- Eval ---------------------------------------------------------------

  it('eval case: actual-vs-expected metrics (perfect match → recall=precision=1, pass)', async () => {
    const app = await appWith();
    const agent = await makeAgent(app, 'EvalAgent');

    // expected = the valid finding the model returns (after grounding)
    const created = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'stripe-key-leak',
        input_diff: DIFF,
        expected_output: [
          { severity: 'CRITICAL', category: 'security', title: 'Hardcoded Stripe secret key', file: 'src/config.ts', start_line: 11 },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const ec = created.json();

    const runRes = await app.inject({ method: 'POST', url: `/eval-cases/${ec.id}/run` });
    expect(runRes.statusCode).toBe(200);
    const body = runRes.json();
    expect(body.result.recall).toBe(1); // the expected finding was found
    expect(body.result.precision).toBe(1); // grounding dropped the line-999 extra → no false positives
    expect(body.result.citation_accuracy).toBeCloseTo(0.5, 5); // 1 of 2 model findings survived grounding
    expect(body.result.traces_passed).toBe(1);
    expect(body.result.per_trace[0].pass).toBe(true);

    // persisted eval_runs row
    const rows = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, ec.id));
    expect(rows.length).toBe(1);
    expect(rows[0]!.pass).toBe(true);

    await app.close();
  });

  it('eval dashboard aggregates + run-all for an agent', async () => {
    const app = await appWith();
    const agent = await makeAgent(app, 'DashAgent');
    const mk = (name: string, expected: unknown) =>
      app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: { owner_kind: 'agent', owner_id: agent.id, name, input_diff: DIFF, expected_output: expected },
      });
    await mk('case-a', [{ file: 'src/config.ts', start_line: 11, title: 'Hardcoded Stripe secret key' }]);
    await mk('case-b', []); // model returns 1 grounded finding → precision 0 → fail

    const all = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval/run-all` });
    expect(all.statusCode).toBe(200);
    const agg = all.json();
    expect(agg.traces_total).toBe(2);

    const dash = (await app.inject({ method: 'GET', url: `/eval/dashboard?owner_kind=agent&owner_id=${agent.id}` })).json();
    expect(dash.cases_total).toBe(2);
    expect(dash.current.traces_total).toBe(2);
    expect(Array.isArray(dash.trend)).toBe(true);
    expect(dash.recent_runs.length).toBeGreaterThanOrEqual(2);

    await app.close();
  });

  // ---- Compose Review -----------------------------------------------------

  it('compose-review posts to GitHub (mock) and persists github_review_id', async () => {
    const github = new MockGitHubClient();
    const app = await appWith({ github });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await makeAgent(app, 'ComposeAgent');

    // run a review to produce findings to compose from
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/compose-review`,
      payload: { verdict: 'request_changes', inline_comments: true },
    });
    expect(res.statusCode).toBe(200);
    const composed = res.json();
    expect(composed.github_review_id).toBe('mock-review-482');
    expect(composed.posted_at).not.toBeNull();
    expect(composed.body).toContain('DevDigest Review');

    // posted to GitHub via the mock client
    expect(github.posted.length).toBe(1);
    expect(github.posted[0]!.review.event).toBe('REQUEST_CHANGES');
    expect((github.posted[0]!.review.comments ?? []).length).toBeGreaterThan(0); // inline on

    // persisted composed_reviews row
    const rows = await pg.handle.db.select().from(t.composedReviews).where(eq(t.composedReviews.prId, pr.id));
    expect(rows.length).toBe(1);
    expect(rows[0]!.githubReviewId).toBe('mock-review-482');

    await app.close();
  });

  it('compose-review/preview composes a body without posting', async () => {
    const github = new MockGitHubClient();
    const app = await appWith({ github });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const preview = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/compose-review/preview`, payload: { verdict: 'comment' } })
    ).json();
    expect(preview.verdict).toBe('comment');
    expect(typeof preview.body).toBe('string');
    expect(github.posted.length).toBe(0); // no side-effect
    await app.close();
  });

  // ---- Export-to-CI + CI ingestion ---------------------------------------

  it('export-ci generates artifacts, opens a PR (mock), persists installation', async () => {
    const github = new MockGitHubClient();
    const app = await appWith({ github });
    const agent = await makeAgent(app, 'CiAgent');

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: { repo: 'acme/payments-api', target: 'gha', action: 'open_pr' },
    });
    expect(res.statusCode).toBe(201);
    const out = res.json();
    expect(out.pr_url).toBe('https://github.com/mock/mock/pull/1');
    expect(out.files.some((f: { path: string }) => f.path === '.github/workflows/devdigest-review.yml')).toBe(true);
    expect(out.files.some((f: { path: string }) => f.path.startsWith('.devdigest/agents/'))).toBe(true);
    expect(github.openedPrs.length).toBe(1);
    expect(github.openedPrs[0]!.title).toBe('Add DevDigest CI review');

    const installs = (await app.inject({ method: 'GET', url: '/ci-installations' })).json();
    expect(installs.some((i: { repo: string }) => i.repo === 'acme/payments-api')).toBe(true);

    await app.close();
  });

  it('ci-runs ingests from the (mock) Actions API and persists ci_runs', async () => {
    const ciActions = new MockCiActionsClient({
      runs: [
        {
          id: 2002,
          pr_number: 482,
          status: 'completed',
          conclusion: 'success',
          created_at: '2026-06-01T12:00:00Z',
          html_url: 'https://github.com/acme/payments-api/actions/runs/2002',
        },
      ],
      artifacts: {
        2002: {
          findings_count: 2,
          critical: 1,
          warning: 1,
          suggestion: 0,
          cost_usd: 0.03,
          duration_ms: 7000,
          agent: 'security-reviewer',
          version: '1',
          pr_number: 482,
        },
      },
    });
    const app = await appWith({ ciActions });
    const agent = await makeAgent(app, 'IngestAgent');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: { repo: 'acme/payments-api', target: 'gha', action: 'files' },
    });

    const runs = (await app.inject({ method: 'GET', url: '/ci-runs' })).json();
    const mine = runs.find((r: { github_url: string | null }) => r.github_url?.includes('2002'));
    expect(mine).toBeTruthy();
    expect(mine.status).toBe('succeeded');
    expect(mine.findings_count).toBe(2);
    expect(mine.pr_number).toBe(482);
    expect(mine.source).toBe('github_actions');

    // ingestion is idempotent on github_url
    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    const again = (await app.inject({ method: 'GET', url: '/ci-runs?ingest=false' })).json();
    const dupes = again.filter((r: { github_url: string | null }) => r.github_url?.includes('2002'));
    expect(dupes.length).toBe(1);

    await app.close();
  });

  // ---- Conformance --------------------------------------------------------

  it('conformance returns a 3-column report + completeness_pct, persists', async () => {
    const app = await appWith({ structured: CONFORMANCE_FIXTURE });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // seed a spec chunk for the repo
    await pg.handle.db.insert(t.codeChunks).values({
      workspaceId,
      repoId: pr.repoId,
      path: '.devdigest/specs/rate-limiting.prd.md',
      content: '# Rate Limiting\n- All public endpoints must be rate-limited\n- 429 must include Retry-After',
      source: 'spec',
    });

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/conformance`, payload: {} });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.report.items.length).toBe(3);
    const statuses = out.report.items.map((i: { status: string }) => i.status).sort();
    expect(statuses).toEqual(['implemented', 'missing', 'out_of_scope']);
    // completeness recomputed: 1 implemented / (1 implemented + 1 missing) = 50
    expect(out.report.completeness_pct).toBe(50);

    // persisted + readable
    const latest = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/conformance` })).json();
    expect(latest.report.completeness_pct).toBe(50);

    await app.close();
  });

  it('conformance 400s when no spec is indexed', async () => {
    const app = await appWith({ structured: CONFORMANCE_FIXTURE });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/conformance`, payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  // ---- Hooks --------------------------------------------------------------

  it('hooks detect secret leak + phantom API and emit grounding-exempt findings', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/hooks/scan`, payload: {} });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.review_id).toBeTruthy();
    // the diff carries a live stripe key on line 11 → secret_leak finding
    const secret = out.findings.find((f: { kind: string }) => f.kind === 'secret_leak');
    expect(secret).toBeTruthy();
    expect(secret.severity).toBe('CRITICAL');
    expect(secret.file).toBe('src/config.ts');

    await app.close();
  });

  it('hooks phantom detector flags a NotImplemented stub', async () => {
    const app = await appWith();
    const name = `phantom-repo-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 'WIP',
        author: 'x',
        branch: 'b',
        base: 'main',
        headSha: 'h',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/pay.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -1,2 +1,3 @@\n function charge() {\n+  throw new Error("not implemented");\n }',
    });

    // MockGitClient returns the stripe DIFF by default; use a git override that
    // returns no diff so the service falls back to pr_files for THIS repo.
    const appNoGit = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: '' }),
        github: new MockGitHubClient(),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
    // hooks registered via canonical registry; no per-test registration needed.

    const out = (await appNoGit.inject({ method: 'POST', url: `/pulls/${pr!.id}/hooks/scan`, payload: { secret: false } })).json();
    const phantom = out.findings.find((f: { kind: string }) => f.kind === 'phantom');
    expect(phantom).toBeTruthy();
    expect(phantom.file).toBe('src/pay.ts');

    await appNoGit.close();
    await app.close();
  });
});
