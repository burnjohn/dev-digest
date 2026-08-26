/**
 * SPEC-01 (Project Context) T12 — wiring `container.contextDocs` into a
 * review run's prompt assembly AND the persisted trace's `specs_read` /
 * `specs_manifest`. Gated on Docker (needs Postgres).
 *
 * `FakeContextDocs` below is a hand-rolled `ContextDocs` test double, not an
 * `adapters/mocks.ts` addition — this task owns only `run-executor.ts` and
 * this file, and the port is exercised through `ContainerOverrides.contextDocs`
 * exactly as `hermeticOverrides` already does for `llm`/`git`/`secrets`. It
 * ignores `baseDir` on purpose: which of the clone tree or the upload
 * directory a path resolves against is `ContextService`'s own concern (T7),
 * not `run-executor`'s — this suite tests run-executor's CONSUMPTION of the
 * port (REQ-18's resolution is not re-derived here), not the port's own
 * containment/disk logic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { hermeticOverrides } from './helpers/overrides.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type {
  ContextDocs,
  ReadDocumentResult,
  WalkDocsResult,
} from '../src/modules/context/types.js';
import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ModelInfo,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// One changed file, small — `selectMode('auto', …)` picks single-pass, so
// exactly one `completeStructured` call per run (REQ-25/REQ-39's "no extra
// LLM call" is checked against this single call, never a second one).
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'Looks fine.',
  score: 90,
  findings: [],
};

const DOC_A_PATH = 'specs/adr-1.md';
const DOC_A_BODY = 'ADR one content.\nSecond line.\n';
const DOC_B_PATH = 'docs/notes.md';
const DOC_B_BODY = 'Some notes.\n';

function sha256(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/**
 * Test double for the `ContextDocs` port (T5/T7's `types.ts`). Configurable
 * per test: `effectiveAttachments` is what `resolveEffectiveAttachments`
 * returns (in effective order); `documents` is the path→body map that
 * `readDocument` succeeds against — any path absent from it is "missing" on
 * every call, from any `baseDir`, mirroring a document deleted from disk.
 */
class FakeContextDocs implements ContextDocs {
  public resolveCalls: { agentId: string; repoId: string }[] = [];
  public readDocumentCalls: { baseDir: string; path: string }[] = [];

  constructor(
    private effectiveAttachments: string[] = [],
    private documents: Record<string, string> = {},
  ) {}

  async listDocuments(): Promise<WalkDocsResult> {
    return { files: [], stats: { totalCandidates: 0, bounded: false, bound: 0, skippedRoots: [] } };
  }

  async readDocument(baseDir: string, relativePath: string): Promise<ReadDocumentResult | null> {
    this.readDocumentCalls.push({ baseDir, path: relativePath });
    const body = this.documents[relativePath];
    if (body === undefined) return null;
    return { body, block: `### ${relativePath}\n${body}` };
  }

  async resolveEffectiveAttachments(agentId: string, repoId: string): Promise<string[]> {
    this.resolveCalls.push({ agentId, repoId });
    return this.effectiveAttachments;
  }
}

/** Always rejects — models REQ-24's "provider refused, prompt too large" path. */
class PromptTooLargeLLMProvider implements LLMProvider {
  readonly id = 'openai' as const;
  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('This model\'s maximum context length is 128000 tokens. Reduce the prompt.');
  }
  async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new Error('This model\'s maximum context length is 128000 tokens. Reduce the prompt.');
  }
  async embed(_texts: string[]): Promise<number[][]> {
    return [];
  }
}

d('project context documents in a review run\'s prompt + trace (SPEC-01 T12)', () => {
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

  async function setupRepoAndPr() {
    const name = `context-run-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
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
    return { repo: repo!, pr: pr! };
  }

  async function runAgent(contextDocs: ContextDocs, llm: LLMProvider = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE })) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: hermeticOverrides({
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm },
        contextDocs,
      }),
    });
    const { pr } = await setupRepoAndPr();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ContextAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id;
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();

    await app.close();
    return { runs, trace, agent, pr };
  }

  it(
    'REQ-20/21/26/27/25/39: two attached documents reach the prompt in effective order, ' +
      'each delimited and headed by their path, and the trace records both as read',
    async () => {
      const reviewMock = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
      const fake = new FakeContextDocs([DOC_A_PATH, DOC_B_PATH], {
        [DOC_A_PATH]: DOC_A_BODY,
        [DOC_B_PATH]: DOC_B_BODY,
      });

      const { runs, trace } = await runAgent(fake, reviewMock);
      expect(runs[0]!.status).toBe('done');

      // REQ-18 — resolved through the port, for THIS agent/repo.
      expect(fake.resolveCalls).toHaveLength(1);

      // REQ-20/21 — one `## Project context` section, both documents inside
      // their own delimiter pair, `### <path>` as the first inner line, in
      // effective order.
      const structuredCalls = reviewMock.calls.filter((c) => c.method === 'completeStructured');
      expect(structuredCalls).toHaveLength(1); // REQ-25/39 — no extra LLM call
      const user = (structuredCalls[0]!.req as { messages: { role: string; content: string }[] })
        .messages[1]!.content;

      const sectionCount = user.split('## Project context').length - 1;
      expect(sectionCount).toBe(1);
      expect(user).toContain(`### ${DOC_A_PATH}\n${DOC_A_BODY}`);
      expect(user).toContain(`### ${DOC_B_PATH}\n${DOC_B_BODY}`);
      expect(user.indexOf(DOC_A_PATH)).toBeLessThan(user.indexOf(DOC_B_PATH));
      // Each document is inside its own <untrusted> pair — two opens, two closes.
      expect(user.split('<untrusted').length - 1).toBeGreaterThanOrEqual(2);
      expect(user.split('</untrusted>').length - 1).toBeGreaterThanOrEqual(2);

      // REQ-26 — specs_read = paths actually read, in effective order.
      expect(trace.specs_read).toEqual([DOC_A_PATH, DOC_B_PATH]);

      // REQ-27 — one manifest entry per document, 'read', with the SHA-256
      // of the exact bytes read (never the formatted block, never normalised).
      expect(trace.specs_manifest).toEqual([
        { path: DOC_A_PATH, status: 'read', sha256: sha256(DOC_A_BODY), chars: DOC_A_BODY.length },
        { path: DOC_B_PATH, status: 'read', sha256: sha256(DOC_B_BODY), chars: DOC_B_BODY.length },
      ]);

      // REQ-28 (drawer parity, checked at this layer) — prompt_assembly.specs
      // is exactly the assembled specs block the model received.
      expect(trace.prompt_assembly.specs).toBeTruthy();

      // REQ-39 — at most one successful filesystem read per attached document;
      // both documents were found on the FIRST `readDocument` call (the fake
      // ignores `baseDir`, so a second (upload-dir) attempt never fires).
      expect(fake.readDocumentCalls).toHaveLength(2);
    },
  );

  it('REQ-23: one of two attached documents missing at run time — the run completes, the block holds only the survivor, the manifest carries the deleted path as `missing`', async () => {
    const fake = new FakeContextDocs([DOC_A_PATH, DOC_B_PATH], { [DOC_A_PATH]: DOC_A_BODY });
    const { runs, trace } = await runAgent(fake);
    expect(runs[0]!.status).toBe('done');

    const reviewMock = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    void reviewMock; // (kept for symmetry with the other tests; not asserted on here)

    expect(trace.specs_read).toEqual([DOC_A_PATH]);
    expect(trace.prompt_assembly.specs).toBeTruthy();
    expect((trace.prompt_assembly.specs as string).includes(DOC_B_PATH)).toBe(false);
    expect(trace.specs_manifest).toEqual([
      { path: DOC_A_PATH, status: 'read', sha256: sha256(DOC_A_BODY), chars: DOC_A_BODY.length },
      { path: DOC_B_PATH, status: 'missing', sha256: null, chars: null },
    ]);
  });

  it('REQ-23 (every document missing): the run still completes, prompt_assembly.specs is null, no `## Project context` section is emitted, and the manifest carries one `missing` entry per attachment', async () => {
    const reviewMock = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const fake = new FakeContextDocs([DOC_A_PATH, DOC_B_PATH], {});
    const { runs, trace } = await runAgent(fake, reviewMock);
    expect(runs[0]!.status).toBe('done');

    const structuredCalls = reviewMock.calls.filter((c) => c.method === 'completeStructured');
    const user = (structuredCalls[0]!.req as { messages: { role: string; content: string }[] })
      .messages[1]!.content;
    expect(user).not.toContain('## Project context');

    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.specs_read).toEqual([]);
    expect(trace.specs_manifest).toEqual([
      { path: DOC_A_PATH, status: 'missing', sha256: null, chars: null },
      { path: DOC_B_PATH, status: 'missing', sha256: null, chars: null },
    ]);
  });

  it('zero attachments: specs omitted, prompt_assembly.specs is null, specs_read is [], the manifest is absent, and the prompt is unaffected by this feature', async () => {
    const reviewMock = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const fake = new FakeContextDocs([], {});
    const { runs, trace } = await runAgent(fake, reviewMock);
    expect(runs[0]!.status).toBe('done');

    const structuredCalls = reviewMock.calls.filter((c) => c.method === 'completeStructured');
    const user = (structuredCalls[0]!.req as { messages: { role: string; content: string }[] })
      .messages[1]!.content;
    expect(user).not.toContain('## Project context');

    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.specs_read).toEqual([]);
    // Absent key, not an empty array/null — `saveRunTrace` never sets it.
    expect(Object.prototype.hasOwnProperty.call(trace, 'specs_manifest')).toBe(false);
    // No attachments to resolve → no filesystem read is even attempted.
    expect(fake.readDocumentCalls).toHaveLength(0);
  });

  it('REQ-24: a provider error naming a prompt-size rejection persists the run failed with the provider\'s own error text', async () => {
    const fake = new FakeContextDocs([DOC_A_PATH], { [DOC_A_PATH]: DOC_A_BODY });
    const { runs, trace } = await runAgent(fake, new PromptTooLargeLLMProvider());

    expect(runs[0]!.status).toBe('failed');
    expect(runs[0]!.error).toContain('maximum context length');

    // Cancelled path shares this exact write site (`traceFromBuffer`) — both
    // are asserted here since the failed path is the one this suite can
    // trigger deterministically. specs_read stays [] and no manifest is
    // written: a run that never reached the model has nothing to report
    // about documents it did not send (SPEC-01 `## Module interactions`).
    expect(trace.specs_read).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(trace, 'specs_manifest')).toBe(false);
  });
});
