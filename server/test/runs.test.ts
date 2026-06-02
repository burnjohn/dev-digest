import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';
import { MemoryCurator } from '../src/modules/runs/curator.js';
import { computeConflicts } from '../src/modules/runs/conflicts.js';
import { scanTrifecta } from '../src/modules/runs/trifecta.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import runsRoutes from '../src/modules/runs/routes.js';

/**
 * The `runs` module is registered by the orchestrator in modules/index.ts at
 * integration. For these tests we register it directly on the built app so the
 * A5 endpoints are mounted without touching the shared wiring file.
 */
async function buildAppWithRuns(opts: Parameters<typeof buildApp>[0]) {
  // `runs` is registered via the canonical module registry (src/modules/index.ts)
  // since orchestrator integration, so buildApp already mounts it.
  return buildApp(opts);
}
void runsRoutes;

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** One valid finding (line 11), one hallucinated (line 999 → grounding drops). */
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

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `obs-api-${repoSeq++}`;
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
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

// ----------------------------- pure-unit tests -----------------------------

describe('A5 conflict detection (pure)', () => {
  it('flags a location one agent flags and another ignores', () => {
    const conflicts = computeConflicts([
      {
        agentId: 'a',
        agentName: 'Security',
        reviewed: true,
        findings: [{ file: 'x.ts', start_line: 10, title: 'Magic number', severity: 'SUGGESTION' }],
      },
      { agentId: 'b', agentName: 'Perf', reviewed: true, findings: [] },
    ]);
    expect(conflicts).toHaveLength(1);
    const takes = conflicts[0]!.takes;
    expect(takes.find((t) => t.agent_id === 'a')!.verdict).toBe('SUGGESTION');
    expect(takes.find((t) => t.agent_id === 'b')!.verdict).toBe('ignored');
  });

  it('no conflict when all reviewing agents agree on the same severity', () => {
    const conflicts = computeConflicts([
      { agentId: 'a', agentName: 'A', reviewed: true, findings: [{ file: 'x.ts', start_line: 1, title: 't', severity: 'WARNING' }] },
      { agentId: 'b', agentName: 'B', reviewed: true, findings: [{ file: 'x.ts', start_line: 1, title: 't', severity: 'WARNING' }] },
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it('flags divergent severities on the same line', () => {
    const conflicts = computeConflicts([
      { agentId: 'a', agentName: 'A', reviewed: true, findings: [{ file: 'x.ts', start_line: 1, title: 't', severity: 'CRITICAL' }] },
      { agentId: 'b', agentName: 'B', reviewed: true, findings: [{ file: 'x.ts', start_line: 1, title: 't', severity: 'SUGGESTION' }] },
    ]);
    expect(conflicts).toHaveLength(1);
  });
});

describe('A5 lethal-trifecta scan (pure)', () => {
  it('emits a finding when all three legs appear in one file', () => {
    const diff = parseUnifiedDiff(
      `diff --git a/src/h.ts b/src/h.ts
--- a/src/h.ts
+++ b/src/h.ts
@@ -1,1 +1,4 @@
+const token = process.env.API_KEY;
+const url = req.body.callback_url;
+await fetch(url, { headers: { authorization: token } });
 keep`,
    );
    const { findings } = scanTrifecta(diff);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('lethal_trifecta');
    expect(findings[0]!.trifecta_components!.sort()).toEqual(
      ['exfil_path', 'private_data_access', 'untrusted_input'].sort(),
    );
    expect(findings[0]!.evidence!.length).toBe(3);
  });

  it('emits nothing when a leg is missing', () => {
    const diff = parseUnifiedDiff(
      `diff --git a/src/h.ts b/src/h.ts
--- a/src/h.ts
+++ b/src/h.ts
@@ -1,1 +1,2 @@
+const token = process.env.API_KEY;
 keep`,
    );
    expect(scanTrifecta(diff).findings).toHaveLength(0);
  });
});

// --------------------------- DB-backed route tests --------------------------

d('A5 runs / observability (Testcontainers pg)', () => {
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

  function appWith(structured: unknown) {
    return buildAppWithRuns({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured }) },
      },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof buildApp>>, name: string) {
    return (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
  }

  it('multi-agent run: N agents → N agent_runs + N run_traces docs (one doc per run), parallel via p-queue', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'MA-1');
    const a2 = await createAgent(app, 'MA-2');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agentIds: [a1.id, a2.id], includeTrifecta: false },
    });
    expect(res.statusCode).toBe(200);
    const run = res.json();
    expect(run.agent_count).toBe(2);
    expect(run.columns).toHaveLength(2);

    // Two agent_runs rows + two run_traces docs for THIS pr (one document each).
    const runs = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, pr.id));
    const llmRuns = runs.filter((r) => r.model === 'gpt-4.1');
    expect(llmRuns).toHaveLength(2);
    for (const r of llmRuns) {
      const traces = await pg.handle.db
        .select()
        .from(t.runTraces)
        .where(eq(t.runTraces.runId, r.id));
      expect(traces).toHaveLength(1); // exactly ONE document per run
      const trace = traces[0]!.trace as { log: unknown[]; stats: { grounding: string } };
      expect(Array.isArray(trace.log)).toBe(true);
      expect(trace.stats.grounding).toBe('1/2 passed');
    }

    // a multi_agent_runs row was persisted
    const mar = await pg.handle.db
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.prId, pr.id));
    expect(mar.length).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it('includes the built-in Lethal-Trifecta detector as an extra column with its own trace', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    // A diff with all three trifecta legs so the detector fires.
    const triDiff = `diff --git a/src/hook.ts b/src/hook.ts
--- a/src/hook.ts
+++ b/src/hook.ts
@@ -1,1 +1,4 @@
+const token = process.env.SECRET_TOKEN;
+const dest = req.body.callback_url;
+await fetch(dest, { headers: { authorization: token } });
 keep`;
    const triApp = await buildAppWithRuns({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: triDiff }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(triApp, 'Tri-1');
    const run = (
      await triApp.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agentIds: [a1.id], includeTrifecta: true },
      })
    ).json();
    const triCol = run.columns.find((c: { model: string | null }) => c.model === 'lethal-trifecta');
    expect(triCol).toBeTruthy();
    expect(triCol.findings.some((f: { kind?: string }) => f.kind === 'lethal_trifecta')).toBe(true);
    await app.close();
    await triApp.close();
  });

  it('per-agent stats: accept-rate aggregate is correct', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'StatsAgent');

    // Run a single review → 1 kept finding.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const findingId = body.reviews[0].findings[0].id;

    // Before any action: pending=1, accept_rate=null (no acted findings).
    let stats = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats` })).json();
    expect(stats.findings_total).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.accept_rate).toBeNull();
    expect(stats.runs).toBeGreaterThanOrEqual(1);

    // Accept the finding → accept_rate = 1/1 = 1.
    await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` });
    stats = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats` })).json();
    expect(stats.accepted).toBe(1);
    expect(stats.dismissed).toBe(0);
    expect(stats.accept_rate).toBe(1);
    expect(stats.dismiss_rate).toBe(0);
    expect(stats.findings_by_severity.CRITICAL).toBe(1);

    await app.close();
  });

  it('multi-agent SSE: each agent run streams events on its own channel', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'Sse-1');
    const run = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agentIds: [a1.id], includeTrifecta: false },
      })
    ).json();
    const runId = run.columns[0].run_id;
    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('latest multi-agent run is retrievable via GET /pulls/:id/multi-agent with conflicts', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'Get-1');
    const a2 = await createAgent(app, 'Get-2');
    await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agentIds: [a1.id, a2.id], includeTrifecta: false },
    });
    const latest = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
    expect(latest.statusCode).toBe(200);
    const run = latest.json();
    expect(run.agent_count).toBe(2);
    expect(Array.isArray(run.conflicts)).toBe(true);
    await app.close();
  });

  it('memory curator dedupes near-duplicate rows (same embedding) and merges provenance', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    // Two memory rows with IDENTICAL embeddings (MockEmbedder is deterministic
    // per content; we insert identical content twice → identical vectors).
    const content = 'Always rate-limit public endpoints behind the gateway.';
    const make = () =>
      app.inject({
        method: 'POST',
        url: '/memory',
        payload: { content, scope: 'global', kind: 'learning', confidence: 0.7 },
      });
    const m1 = (await make()).json();
    const m2 = (await make()).json();
    expect(m1.id).not.toBe(m2.id);

    const before = (await app.inject({ method: 'GET', url: '/memory?kind=learning' })).json();
    const beforeCount = before.filter((m: { content: string }) => m.content === content).length;
    expect(beforeCount).toBeGreaterThanOrEqual(2);

    // Run the curator directly (also exposed via POST /memory/curate).
    const curator = new MemoryCurator((app as unknown as { container: never }).container);
    const result = await curator.curate(workspaceId, { threshold: 0.99 });
    expect(result.merges.length).toBeGreaterThanOrEqual(1);
    expect(result.removed).toBeGreaterThanOrEqual(1);

    const after = (await app.inject({ method: 'GET', url: '/memory?kind=learning' })).json();
    const afterCount = after.filter((m: { content: string }) => m.content === content).length;
    expect(afterCount).toBeLessThan(beforeCount);

    await app.close();
  });

  it('curator endpoint supports dry-run (no mutations)', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const content = 'Prefer the shared Redis singleton over new connections.';
    for (let i = 0; i < 2; i++) {
      await app.inject({
        method: 'POST',
        url: '/memory',
        payload: { content, scope: 'global', kind: 'learning', confidence: 0.7 },
      });
    }
    const res = await app.inject({
      method: 'POST',
      url: '/memory/curate',
      payload: { threshold: 0.99, dryRun: true },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.dry_run).toBe(true);
    expect(result.removed).toBe(0);
    const after = (await app.inject({ method: 'GET', url: '/memory?kind=learning' })).json();
    expect(after.filter((m: { content: string }) => m.content === content).length).toBe(2);
    await app.close();
  });
});
