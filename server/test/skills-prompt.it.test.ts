import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { hermeticOverrides } from './helpers/overrides.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills-prompt] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'ok',
  score: 90,
  findings: [],
};

const ENABLED_BODY = 'ENABLED-SKILL-BODY: always check the uncovered branch.';
const DISABLED_BODY = 'DISABLED-SKILL-BODY: this must never reach the model.';

/**
 * THE point of L02: a linked, enabled skill body reaches the model inside the
 * user message's `## Skills / rules` section — and a disabled one does not.
 *
 * Asserted against the actual request the provider received (MockLLMProvider
 * records every call), not against an intermediate structure, so this fails if
 * anything between the link table and the wire drops or reorders the bodies.
 */
d('skills → review prompt', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(llm: MockLLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: hermeticOverrides({
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm },
      }),
    });
  }

  async function setupPr() {
    const name = `skills-prompt-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 483,
        title: 'Add tiered discount calculation',
        author: 'dan.whitfield',
        branch: 'feat/tiered',
        base: 'main',
        headSha: 'b7c8d9e0',
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
    return pr!;
  }

  /** The user message the provider actually received for the structured call. */
  function userMessage(llm: MockLLMProvider): string {
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    expect(call, 'expected a structured completion call').toBeTruthy();
    const req = call!.req as { messages: { role: string; content: string }[] };
    const user = req.messages.find((m) => m.role === 'user');
    expect(user, 'expected a user message').toBeTruthy();
    return user!.content;
  }

  async function runReview(app: Awaited<ReturnType<typeof buildApp>>, prId: string, agentId: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/review`,
      payload: { agentId },
    });
    expect(res.statusCode).toBe(200);
    await waitForPrRuns(pg.handle.db, prId, { expected: 1 });
    return res.json();
  }

  async function makeAgent(app: Awaited<ReturnType<typeof buildApp>>, name: string) {
    return (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'reviewer' },
      })
    ).json();
  }

  it('omits the section entirely when no skills are linked (byte-identical baseline)', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await appWith(llm);
    const pr = await setupPr();
    const agent = await makeAgent(app, 'No Skills Agent');

    await runReview(app, pr.id, agent.id);

    expect(userMessage(llm)).not.toContain('## Skills / rules');
    await app.close();
  });

  it('injects an enabled skill body and EXCLUDES a disabled one', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await appWith(llm);
    const pr = await setupPr();
    const agent = await makeAgent(app, 'Skilled Agent');

    const enabled = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'enabled-rule', body: ENABLED_BODY },
      })
    ).json();
    const disabled = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'disabled-rule', body: DISABLED_BODY, enabled: false },
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [enabled.id, disabled.id] },
    });

    await runReview(app, pr.id, agent.id);

    const msg = userMessage(llm);
    expect(msg).toContain('## Skills / rules');
    expect(msg).toContain(ENABLED_BODY);
    // The gate: linked but globally disabled must never reach the model.
    expect(msg).not.toContain(DISABLED_BODY);

    // Trusted instructions, NOT delimiter-wrapped data — the whole reason the
    // Step-1 i18n copy had to change. If someone starts wrapping skills, this
    // fails and the UI copy becomes a lie.
    const section = msg.slice(msg.indexOf('## Skills / rules'));
    expect(section.slice(0, section.indexOf(ENABLED_BODY))).not.toContain('<untrusted');

    await app.close();
  });

  it('injects bodies in LINK order, and reordering reorders the prompt', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await appWith(llm);
    const pr = await setupPr();
    const agent = await makeAgent(app, 'Ordered Agent');

    const first = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'aaa-first', body: 'BODY-ALPHA' },
      })
    ).json();
    const second = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'zzz-second', body: 'BODY-OMEGA' },
      })
    ).json();

    // Link them in REVERSE alphabetical order, so a name-sorted implementation
    // would produce the opposite result and fail here.
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [second.id, first.id] },
    });

    await runReview(app, pr.id, agent.id);

    const msg = userMessage(llm);
    expect(msg.indexOf('BODY-OMEGA')).toBeLessThan(msg.indexOf('BODY-ALPHA'));
    await app.close();
  });

  it('writes the skills block into the persisted run trace, so the drawer renders it', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await appWith(llm);
    const pr = await setupPr();
    const agent = await makeAgent(app, 'Traced Agent');

    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'traced-rule', body: ENABLED_BODY },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const body = await runReview(app, pr.id, agent.id);
    const runId = body.runs[0].run_id;

    const [row] = await pg.handle.db
      .select()
      .from(t.runTraces)
      .where(eq(t.runTraces.runId, runId));

    // run_traces stores ONE jsonb document (the RunTrace contract), not columns.
    const trace = row!.trace as {
      prompt_assembly: { skills: string | null };
      log: unknown;
    };
    expect(trace.prompt_assembly.skills).toContain(ENABLED_BODY);

    // …and the live log tells the operator what happened, without leaking bodies.
    const log = JSON.stringify(trace.log);
    expect(log).toContain('Skills: 1/1 enabled');
    expect(log).not.toContain(ENABLED_BODY);

    await app.close();
  });
});
