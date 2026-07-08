/**
 * Route tests for `POST /pulls/:id/brief` (Step 5 — Prompt template + routes
 * wiring). Hermetic: no Postgres, no Docker.
 *
 * Strategy mirrors `test/onboarding-routes.test.ts` / `test/blast-routes.test.ts`:
 * build a real app via `buildApp` with `MockAuthProvider` (known workspaceId),
 * patch `app.container.db` with a fake that routes by requested column keys /
 * call order (same convention as `test/brief-generator-service.test.ts`), and
 * patch the lazily-constructed `blast`/`contextDocs` Container getters
 * directly on the built container instance (per `server/insights.md`'s
 * "any new Container getter requires auditing hermetic tests that fake the
 * whole container" pattern).
 *
 * The 429-on-4th-call assertion is NOT run as a live rate-limit window here —
 * `@fastify/rate-limit` is disabled entirely when `nodeEnv==='test'` (see
 * `onboarding-routes.test.ts`'s own comment on this same constraint). Instead
 * this file asserts the route is REGISTERED with `BRIEF_GENERATE_RATE_LIMIT`
 * (max: 3, timeWindow: '1 minute') and a defined per-workspace `keyGenerator`,
 * deferring the live-window assertion to Step 10's integration test.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { PrBrief } from '@devdigest/shared';
import { MockAuthProvider, MockLLMProvider } from '../src/adapters/mocks.js';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../src/platform/container.js';
import type { BlastResponse } from '@devdigest/shared';
import reviewsRoutes from '../src/modules/reviews/routes.js';

const WS_ID = '22222222-2222-2222-2222-222222222222';
const PR_ID = '11111111-1111-1111-1111-111111111111';
const REPO_ID = '33333333-3333-3333-3333-333333333333';

const PULL_ROW = {
  id: PR_ID,
  workspaceId: WS_ID,
  repoId: REPO_ID,
  number: 42,
  title: 'Add rate limiting to public API',
  author: 'marisa.koch',
  branch: 'feat/rate-limit',
  base: 'main',
  headSha: 'deadbeef',
  lastReviewedSha: null,
  additions: 40,
  deletions: 5,
  filesCount: 2,
  status: 'needs_review',
  body: 'Adds a rate limiter middleware.',
  openedAt: null,
  updatedAt: null,
};

const REPO_ROW = {
  id: REPO_ID,
  workspaceId: WS_ID,
  owner: 'acme',
  name: 'api',
  fullName: 'acme/api',
  defaultBranch: 'main',
  clonePath: '/mock/clones/acme/api',
  lastPolledAt: null,
  createdBy: null,
  createdAt: null,
  contextFolders: null,
};

const NARRATIVE_FIXTURE = {
  what: 'Adds a rate limiter middleware to public endpoints.',
  why: 'Prevents abuse of unauthenticated endpoints.',
  risk_level: 'medium',
  risks: [],
  review_focus: [],
};

function makeBlastResponse(): BlastResponse {
  return {
    available: true,
    blast: { changed_symbols: [], downstream: [], summary: '0 symbols changed' },
    history: { history: [] },
    index: { status: 'full', degraded: false, reason: null },
    link: { owner: 'acme', repo: 'api', head_sha: 'deadbeef' },
  };
}

function makeChain(resolve: () => Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(resolve()),
    for: () => chain,
    then: (onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onF, onR),
    catch: (onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).catch(onR),
  };
  return chain;
}

/**
 * Fake db routing pull.repo.ts's calls by column-key sniffing plus call-order
 * for the four no-column-map selects (getPull, getRepo, getIntent,
 * getPrFiles) — same convention as `test/brief-generator-service.test.ts`.
 */
function makeFakeDb(opts: { pullRow?: Record<string, unknown> | null; briefRow?: Record<string, unknown> | null }) {
  const pullRow = 'pullRow' in opts ? opts.pullRow : PULL_ROW;
  const repoRow = REPO_ROW;
  let briefRow = 'briefRow' in opts ? opts.briefRow : null;
  let noColsCallIndex = 0;

  return {
    select: (cols?: Record<string, unknown>) => {
      if (!cols) {
        const myIndex = noColsCallIndex++;
        return makeChain(() => {
          if (myIndex === 0) return pullRow ? [pullRow] : [];
          if (myIndex === 1) return repoRow ? [repoRow] : [];
          if (myIndex === 2) return []; // getIntent — none cached
          return []; // getPrFiles
        });
      }
      if ('json' in cols && Object.keys(cols).length === 1) {
        return makeChain(() => (briefRow ? [briefRow] : []));
      }
      if ('title' in cols && 'rationale' in cols && 'severity' in cols) {
        return makeChain(() => []); // getLatestFindings
      }
      if ('key' in cols && 'value' in cols) {
        return makeChain(() => []); // resolveFeatureModel settings read
      }
      return makeChain(() => []);
    },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => makeChain(() => (briefRow ? [briefRow] : [])),
        insert: () => ({
          values: (row: { json: unknown }) => {
            briefRow = { json: row.json };
            return { onConflictDoUpdate: (arg: { set: { json: unknown } }) => {
              briefRow = { json: arg.set.json };
              return Promise.resolve();
            } };
          },
        }),
        update: () => ({
          set: (arg: { json: unknown }) => {
            briefRow = { json: arg.json };
            return { where: () => Promise.resolve() };
          },
        }),
      };
      return cb(tx);
    },
  };
}

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

async function buildBriefApp(opts: {
  pullRow?: Record<string, unknown> | null;
  briefRow?: Record<string, unknown> | null;
} = {}): Promise<FastifyInstance> {
  // 'risk_brief' defaults to the 'openai' provider (contracts/platform.ts's
  // FEATURE_MODELS) — the mock must be registered under that provider key or
  // container.llm(provider) falls through to a real (non-mocked) adapter.
  const llm = new MockLLMProvider('openai', { structured: NARRATIVE_FIXTURE });
  const mockAuth = new MockAuthProvider(
    { id: 'u1', email: 'you@local', name: 'You' },
    { id: WS_ID, name: 'default' },
  );

  const app = await buildApp({
    config,
    overrides: { auth: mockAuth, llm: { openai: llm } },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app.container as any).db = makeFakeDb(opts);

  // blast/contextDocs are lazily-constructed real services exposed as
  // getter-only Container properties — patch them directly on the built
  // instance before the first request via defineProperty (a plain assignment
  // throws, since these are getter-only accessors), per server/insights.md's
  // "audit hermetic tests that fake the whole container" pattern for any new
  // Container getter a service under test depends on.
  Object.defineProperty(app.container, 'blast', {
    value: { getBlast: vi.fn().mockResolvedValue(makeBlastResponse()) },
    configurable: true,
  });
  Object.defineProperty(app.container, 'contextDocs', {
    value: {
      getContextFolders: vi.fn().mockResolvedValue([]),
      listDocuments: vi.fn().mockResolvedValue([]),
      getDocumentContent: vi.fn().mockResolvedValue(undefined),
    },
    configurable: true,
  });

  return app;
}

describe('POST /pulls/:id/brief — nonexistent PR (404)', () => {
  it('returns 404 when the PR does not exist / is cross-workspace', async () => {
    const app = await buildBriefApp({ pullRow: null });
    const res = await app.inject({ method: 'POST', url: `/pulls/${PR_ID}/brief` });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /pulls/:id/brief — success', () => {
  it('returns 200 with a PrBrief-shaped body including llm', async () => {
    const app = await buildBriefApp({});
    const res = await app.inject({ method: 'POST', url: `/pulls/${PR_ID}/brief` });
    await app.close();

    expect(res.statusCode).toBe(200);
    const parsed = PrBrief.safeParse(res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.llm).not.toBeNull();
      expect(parsed.data.llm?.what).toBe(NARRATIVE_FIXTURE.what);
    }
  });
});

describe('GET /pulls/:id/brief — existing behavior unmodified (AC-17 regression)', () => {
  it('returns null when no brief was ever composed', async () => {
    const app = await buildBriefApp({ briefRow: null });
    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_ID}/brief` });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('returns 404 for a nonexistent PR', async () => {
    const app = await buildBriefApp({ pullRow: null });
    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_ID}/brief` });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /pulls/:id/brief', () => {
  it('clears an existing llm field back to null, preserving other brief fields', async () => {
    const briefRow = {
      json: {
        intent: { intent: 'x', in_scope: [], out_of_scope: [] },
        blast: { changed_symbols: [], downstream: [], summary: '0 symbols changed' },
        risks: { risks: [] },
        history: { history: [] },
        llm: {
          what: NARRATIVE_FIXTURE.what,
          why: NARRATIVE_FIXTURE.why,
          risk_level: NARRATIVE_FIXTURE.risk_level,
          review_focus: [],
          generated_at: new Date().toISOString(),
          cost_usd: 0.01,
          tokens_in: 100,
          tokens_out: 50,
        },
      },
    };
    const app = await buildBriefApp({ briefRow });
    const res = await app.inject({ method: 'DELETE', url: `/pulls/${PR_ID}/brief` });
    await app.close();

    expect(res.statusCode).toBe(200);
    const parsed = PrBrief.safeParse(res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.llm).toBeNull();
      expect(parsed.data.blast.summary).toBe('0 symbols changed');
      expect(parsed.data.intent.intent).toBe('x');
    }
  });

  it('returns 404 for a nonexistent / cross-workspace PR', async () => {
    const app = await buildBriefApp({ pullRow: null });
    const res = await app.inject({ method: 'DELETE', url: `/pulls/${PR_ID}/brief` });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it('returns null (no crash) for a PR with no brief row yet', async () => {
    const app = await buildBriefApp({ briefRow: null });
    const res = await app.inject({ method: 'DELETE', url: `/pulls/${PR_ID}/brief` });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });
});

describe('POST /pulls/:id/brief — registered rate-limit config (static assertion)', () => {
  it('the route config shows { max: 3, timeWindow: "1 minute" } and a defined per-workspace keyGenerator', async () => {
    // A real 429 CANNOT be produced hermetically — @fastify/rate-limit is
    // disabled when nodeEnv==='test' (same constraint documented in
    // onboarding-routes.test.ts). Inspect the route's OWN registered config
    // via the `onRoute` hook instead, which fires synchronously at
    // registration time regardless of whether the global plugin is active.
    const raw = Fastify();
    raw.setValidatorCompiler(validatorCompiler);
    raw.setSerializerCompiler(serializerCompiler);
    raw.decorate('container', {
      db: { select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }) },
    } as unknown as Container);

    let capturedConfig: Record<string, unknown> | undefined;
    raw.addHook('onRoute', (routeOptions) => {
      if (routeOptions.method === 'POST' && routeOptions.url === '/pulls/:id/brief') {
        capturedConfig = routeOptions.config as Record<string, unknown>;
      }
    });

    await raw.register(reviewsRoutes);
    await raw.ready();
    await raw.close();

    expect(capturedConfig).toBeDefined();
    const rateLimit = capturedConfig?.rateLimit as
      | { max: number; timeWindow: string; keyGenerator: unknown }
      | undefined;
    expect(rateLimit).toBeDefined();
    expect(rateLimit?.max).toBe(3);
    expect(rateLimit?.timeWindow).toBe('1 minute');
    expect(typeof rateLimit?.keyGenerator).toBe('function');
  });
});
