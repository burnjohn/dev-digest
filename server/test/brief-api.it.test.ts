/**
 * `POST /pulls/:id/brief` — the PR Risk Brief endpoint end to end (server/specs/SPEC-02-pr-risk-brief.md,
 * plan 08-pr-risk-brief.md T6). Driven through `buildApp` + `app.inject`, real Postgres via
 * Testcontainers — the service/repository/route wiring, schema validation and the
 * `pr_brief` upsert, none of which the hermetic `brief-service.test.ts` can prove.
 *
 * `risk_brief` is registered `defaultProvider: 'openai'` / `defaultModel: 'gpt-4.1'`
 * (`vendor/shared/contracts/platform.ts:65-71`) — `hermeticOverrides()` alone only closes the
 * `openrouter` channel (the intent feature's default), so EVERY `buildApp()` call below injects
 * its own `openai`-keyed `MockLLMProvider` explicitly, and at least one assertion below checks
 * that mock's `calls` array is non-empty — proof a silent fall-through to a real, billed OpenAI
 * call would fail the test rather than pass it (server/INSIGHTS.md, 2026-08-21).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { GitHubClient, IssueMeta, RiskBriefResponse } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { hermeticOverrides } from './helpers/overrides.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { ContainerOverrides } from '../src/platform/container.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider, MockBlastProvider } from '../src/adapters/mocks.js';
import { RISK_BRIEF_SCHEMA_NAME } from '../src/modules/reviews/brief-generator.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

type Db = PgFixture['handle']['db'];

const GENERATION_FIXTURE = {
  what: 'Adds retry to the payments webhook handler.',
  why: 'Transient webhook failures currently drop the event.',
  risk_level: 'medium' as const,
  risks: [
    {
      title: 'Retry could double-charge',
      explanation: 'A retried webhook may re-trigger the charge if idempotency is not enforced.',
      severity: 'medium' as const,
      file: 'src/payments.ts',
      endpoint: null,
    },
  ],
  review_focus: [{ file: 'src/payments.ts', reason: 'Verify idempotency key handling.' }],
};

function briefLlm(fixture: unknown = GENERATION_FIXTURE): MockLLMProvider {
  return new MockLLMProvider('openai', { structuredBySchema: { [RISK_BRIEF_SCHEMA_NAME]: fixture } });
}

function rejectingGitHub(): GitHubClient {
  const notUsed = async () => {
    throw new Error('not used');
  };
  return {
    listPullRequests: notUsed,
    getPullRequest: notUsed,
    postReview: notUsed,
    listReviewComments: notUsed,
    createReviewComment: notUsed,
    openPullRequest: notUsed,
    commitFiles: notUsed,
    findOpenPr: notUsed,
    getIssue: async (): Promise<IssueMeta> => {
      throw new Error('getIssue failed');
    },
    currentLogin: async () => 'mock-user',
  } as unknown as GitHubClient;
}

let repoSeq = 0;
async function setupRepoAndPr(db: Db, workspaceId: string, body: string | null = null) {
  const name = `brief-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: repoSeq,
      title: `PR #${repoSeq}`,
      author: 'octocat',
      branch: `feat/${repoSeq}`,
      base: 'main',
      headSha: `sha${repoSeq}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
      body,
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/payments.ts',
    additions: 5,
    deletions: 1,
    patch: '@@ -1,2 +1,3 @@\n context',
  });
  return { repo: repo!, pr: pr! };
}

d('POST /pulls/:id/brief (Testcontainers pg)', () => {
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

  function appWith(llm: MockLLMProvider, extra: ContainerOverrides = {}) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: hermeticOverrides({
        git: new MockGitClient(),
        llm: { openai: llm },
        blast: new MockBlastProvider(),
        ...extra,
      }),
    });
  }

  it('REQ-1: a first POST assembles, calls the model exactly once, grounds, writes one row and returns 200', async () => {
    const llm = briefLlm();
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 'Adds retry logic.');

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RiskBriefResponse;

    expect(body.pr_id).toBe(pr.id);
    expect(body.model).toBe('gpt-4.1');
    expect(body.risks).toHaveLength(1);
    expect(body.risks[0]!.file).toBe('src/payments.ts');
    // The real teeth (server/INSIGHTS.md, 2026-08-21): proves the openai mock,
    // not a real provider, actually served this call.
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1);
    expect((rows[0]!.json as RiskBriefResponse).pr_id).toBe(pr.id);

    await app.close();
  });

  it('REQ-2: force absent, then null, then false returns the cached brief — zero further model/GitHub calls', async () => {
    const llm = briefLlm();
    const github = new MockGitHubClient();
    const app = await appWith(llm, { github });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const first = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: {} });
    expect(first.statusCode).toBe(200);
    const callsAfterFirst = llm.calls.length;

    for (const payload of [{}, { force: null }, { force: false }]) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(first.json());
    }

    expect(llm.calls.length).toBe(callsAfterFirst);

    await app.close();
  });

  it('REQ-3: {force:true} regenerates and the stored row is replaced', async () => {
    const llm = briefLlm();
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: {} });
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    const forced = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: { force: true } });
    expect(forced.statusCode).toBe(200);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(2);

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1); // upsert, not a second row

    await app.close();
  });

  it('REQ-5: a PR from another workspace 404s with zero model calls', async () => {
    const llm = briefLlm();
    const app = await appWith(llm);

    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-ws' }).returning();
    const { pr } = await setupRepoAndPr(pg.handle.db, otherWs!.id);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: {} });
    expect(res.statusCode).toBe(404);
    expect(llm.calls).toHaveLength(0);

    await app.close();
  });

  it('REQ-11/REQ-18: a model call that rejects returns 502, writes no row, and leaves a prior row untouched', async () => {
    const goodLlm = briefLlm();
    const app1 = await appWith(goodLlm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const first = await app1.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: {} });
    expect(first.statusCode).toBe(200);
    await app1.close();

    const before = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));

    const badLlm = briefLlm({ risk_level: 'critical' }); // fails schema -> completeStructured throws
    const app2 = await appWith(badLlm);
    const res = await app2.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: { force: true } });
    expect(res.statusCode).toBe(502);

    const after = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(after).toEqual(before); // byte-unchanged

    await app2.close();
  });

  it('REQ-16/REQ-17/REQ-39: no pr_intent row, a throwing blast, and a rejecting getIssue still succeed with "unavailable" sources', async () => {
    const llm = briefLlm();
    const app = await appWith(llm, {
      github: rejectingGitHub(),
      blast: new MockBlastProvider({ error: new Error('blast unavailable') }),
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 'Fixes the retry bug. Closes #7.');

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RiskBriefResponse;

    expect(body.sources.intent).toBe('unavailable'); // no pr_intent row (REQ-16)
    expect(body.sources.blast).toBe('unavailable'); // blast threw (REQ-17)
    expect(body.sources.linked_issue).toBe('unavailable'); // getIssue rejected (REQ-39)

    await app.close();
  });

  it('a stored row that fails RiskBriefResponse parsing is regenerated, not returned', async () => {
    const llm = briefLlm();
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await pg.handle.db.insert(t.prBrief).values({ prId: pr.id, json: { garbage: true } });

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    await app.close();
  });
});
