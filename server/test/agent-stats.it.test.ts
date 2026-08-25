import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

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

const REVIEW: Review = {
  verdict: 'request_changes',
  summary: 's',
  score: 50,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'r',
      confidence: 0.9,
    },
  ],
};
// review_intent defaults to openrouter (Intent Layer) independent of the
// review agent's own provider — mock it too, or intent-classification
// pre-work falls through to a REAL provider construction.
const MOCK_INTENT = {
  intent: 'test PR',
  in_scope: [],
  out_of_scope: [],
  confidence: 'high' as const,
  source: 'description' as const,
};

d('agent stats (Testcontainers pg)', () => {
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

  it('aggregates runs + findings for the agent over the window', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          openai: new MockLLMProvider('openai', { structured: REVIEW }),
          openrouter: new MockLLMProvider('openrouter', { structured: MOCK_INTENT }),
        },
      },
    });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Stats Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'stats-repo', fullName: 'acme/stats-repo' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'x',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });

    await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr!.id, { expected: 1 });

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats` });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.runs).toBe(1);
    expect(stats.findings_total).toBe(1);
    expect(stats.findings_by_severity.CRITICAL).toBe(1);
    expect(stats.findings_by_category).toEqual([{ category: 'security', count: 1 }]);
    expect(stats.run_history).toHaveLength(1);
    expect(stats.run_history[0].pr_number).toBe(7);
    expect(stats.accept_rate).toBeNull(); // finding not yet accepted/dismissed

    await app.close();
  });

  it('resolves a real agent_skills link into most_used_skills with the correct name and pct (Plan A wiring)', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          openai: new MockLLMProvider('openai', { structured: REVIEW }),
          openrouter: new MockLLMProvider('openrouter', { structured: MOCK_INTENT }),
        },
      },
    });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Skill Stats Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();

    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'Corner Cases',
          description: 'Checks corner cases',
          body: 'Look for corner cases.',
          enabled: true,
        },
      })
    ).json();

    const linkRes = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_id: skill.id },
    });
    expect(linkRes.statusCode).toBe(200);

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'skill-stats-repo', fullName: 'acme/skill-stats-repo' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 9,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'x',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });

    await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr!.id, { expected: 1 });

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats` });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.runs).toBe(1);
    expect(stats.most_used_skills).toEqual([{ skill_id: skill.id, name: 'Corner Cases', pct: 1 }]);

    await app.close();
  });

  it('an explicit since/until window excludes an older run while the default (no params) still includes it', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          openai: new MockLLMProvider('openai', { structured: REVIEW }),
          openrouter: new MockLLMProvider('openrouter', { structured: MOCK_INTENT }),
        },
      },
    });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Range Stats Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'range-stats-repo', fullName: 'acme/range-stats-repo' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 11,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'x',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });

    // Run #1 — created "today" via the real review flow.
    await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr!.id, { expected: 1 });

    // Run #2 — a second, older run inserted directly 5 days in the past.
    // Within the default trailing-30-day window, but outside a 1-day
    // since/until range ending now — the concrete proof that an explicit
    // range narrows the result while an omitted one keeps the historic
    // 30-day default (Stats tab stays unaffected).
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      agentId: agent.id,
      prId: pr!.id,
      ranAt: fiveDaysAgo,
      status: 'done',
      source: 'local',
      costUsd: 0.01,
      durationMs: 1000,
      findingsCount: 0,
      skillIds: [],
    });

    const defaultRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats` });
    expect(defaultRes.statusCode).toBe(200);
    expect(defaultRes.json().runs).toBe(2);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const until = new Date().toISOString();
    const rangedRes = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/stats?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`,
    });
    expect(rangedRes.statusCode).toBe(200);
    expect(rangedRes.json().runs).toBe(1);

    // Partial range: only `since` passed, no `until`. `service.getStats` must
    // resolve the missing `until` to "now" itself — this is the concrete
    // regression test for the fix that moved default-resolution out of the
    // route (which previously computed this fallback inline) and into the
    // service, the one place that's allowed to decide the default window.
    const sinceOnlyRes = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/stats?since=${encodeURIComponent(since)}`,
    });
    expect(sinceOnlyRes.statusCode).toBe(200);
    expect(sinceOnlyRes.json().runs).toBe(1);

    // Symmetric case: only `until` passed, no `since`. `since` must default
    // to the trailing 30-day window (not, say, "now" — which would silently
    // exclude everything) — the 5-day-old run falls inside that resolved
    // window, so both runs are counted, matching the no-params default.
    const untilOnlyRes = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/stats?until=${encodeURIComponent(until)}`,
    });
    expect(untilOnlyRes.statusCode).toBe(200);
    expect(untilOnlyRes.json().runs).toBe(2);

    await app.close();
  });

  it('404s for an unknown agent', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), embedder: new MockEmbedder() },
    });
    const res = await app.inject({ method: 'GET', url: `/agents/00000000-0000-0000-0000-000000000000/stats` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
