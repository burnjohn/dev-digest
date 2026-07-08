/**
 * Route tests for GET/POST /repos/:id/onboarding[/generate].
 *
 * Hermetic: no Postgres, no Docker. Follows `test/blast-routes.test.ts`'s
 * strategy — build the app with `MockAuthProvider` (known workspaceId) and a
 * mock `repoIntel`, then patch `app.container.db` before the first request
 * (the service's repository is lazily created, so this is safe).
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { OnboardingTour } from '@devdigest/shared';
import { MockAuthProvider, MockLLMProvider, MockGitHubClient, MockGitClient } from '../src/adapters/mocks.js';
import type { RepoIntel, IndexState } from '../src/modules/repo-intel/types.js';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../src/platform/container.js';
import onboardingRoutes from '../src/modules/onboarding/routes.js';

const WS_ID = '22222222-2222-2222-2222-222222222222';
const REPO_ID = '33333333-3333-3333-3333-333333333333';
const INVALID_ID = 'not-a-uuid';

function makeRepoIntel(opts: { indexState?: Partial<IndexState> } = {}): RepoIntel {
  const defaultIndexState: IndexState = {
    repoId: REPO_ID,
    status: 'full',
    filesIndexed: 100,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: 'sha-abc',
    indexerVersion: 1,
    updatedAt: new Date('2026-07-01'),
    degraded: false,
  };
  return {
    indexRepo: vi.fn(),
    refreshIndex: vi.fn(),
    getIndexState: vi.fn().mockResolvedValue({ ...defaultIndexState, ...opts.indexState }),
    getBlastRadius: vi.fn(),
    getRepoMap: vi.fn(),
    getFileRank: vi.fn(),
    getSymbolsInFiles: vi.fn(),
    getCallerSignatures: vi.fn(),
    getUnresolvedReferences: vi.fn(),
    getConventionSamples: vi.fn(),
    getAllFileFacts: vi.fn().mockResolvedValue([]),
    getTopFilesByRank: vi.fn().mockResolvedValue(['src/core.ts', 'src/index.ts']),
    getCriticalPaths: vi.fn().mockResolvedValue([]),
    getImporters: vi.fn().mockResolvedValue([]),
  } as RepoIntel;
}

function makeDb(opts: { repoRow?: Record<string, unknown> | null; tourRow?: Record<string, unknown> | null }) {
  const selectChain = (resolve: () => Record<string, unknown>[]) => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(resolve()),
      then: (onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
      catch: (onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).catch(onR),
    };
    return chain;
  };
  return {
    // Route by requested column keys — same convention as
    // test/onboarding-service.test.ts's fake db (context-docs-service.test.ts
    // established the pattern for this codebase).
    select: (cols?: Record<string, unknown>) => {
      if (cols && 'key' in cols && 'value' in cols) {
        // resolveFeatureModel's settings read — no workspace override configured.
        return selectChain(() => []);
      }
      if (cols && 'repoId' in cols && 'json' in cols) {
        const row = 'tourRow' in opts ? opts.tourRow : null;
        return selectChain(() => (row ? [row] : []));
      }
      const row = 'repoRow' in opts ? opts.repoRow : null;
      return selectChain(() => (row ? [row] : []));
    },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const repoRow = 'repoRow' in opts ? opts.repoRow : { id: REPO_ID };
      const tx = {
        select: () => selectChain(() => (repoRow ? [{ id: REPO_ID }] : [])),
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: () => ({
              returning: () =>
                Promise.resolve([
                  {
                    repoId: REPO_ID,
                    json: { sections: [] },
                    generatedAt: new Date(),
                    mode: 'full',
                    indexStatus: 'full',
                    degraded: false,
                    degradedReason: null,
                    llmCostCents: 0,
                  },
                ]),
            }),
          }),
        }),
      };
      return cb(tx);
    },
  };
}

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const NARRATIVE_FIXTURE = {
  sections: [
    { kind: 'architecture', title: 'Architecture overview', body: 'x', diagram: null, entries: [], tasks: [], links: [] },
    { kind: 'critical_paths', title: 'Critical paths', body: 'x', diagram: null, entries: [], tasks: [], links: [] },
    { kind: 'how_to_run', title: 'How to run locally', body: 'x', diagram: null, entries: [], tasks: [], links: [] },
    { kind: 'reading_path', title: 'Guided reading path', body: 'x', diagram: null, entries: [], tasks: [], links: [] },
    { kind: 'first_tasks', title: 'First tasks', body: 'x', diagram: null, entries: [], tasks: [], links: [] },
  ],
};

async function buildOnboardingApp(opts: {
  repoRow?: Record<string, unknown> | null;
  tourRow?: Record<string, unknown> | null;
  indexState?: Partial<IndexState>;
} = {}): Promise<FastifyInstance> {
  const repoIntel = makeRepoIntel({ indexState: opts.indexState });
  const llm = new MockLLMProvider('openrouter', { structured: NARRATIVE_FIXTURE });
  const github = new MockGitHubClient();
  const git = new MockGitClient({ files: { 'package.json': '{"name":"demo"}' } });

  const mockAuth = new MockAuthProvider(
    { id: 'u1', email: 'you@local', name: 'You' },
    { id: WS_ID, name: 'default' },
  );

  const app = await buildApp({
    config,
    overrides: { repoIntel, auth: mockAuth, llm: { openrouter: llm }, github, git },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app.container as any).db = makeDb({
    repoRow:
      'repoRow' in opts
        ? opts.repoRow
        : {
            owner: 'acme',
            name: 'api',
            defaultBranch: 'main',
            clonePath: '/mock/clones/acme/api',
            workspaceId: WS_ID,
          },
    tourRow: 'tourRow' in opts ? opts.tourRow : null,
  });

  return app;
}

describe('GET /repos/:id/onboarding — validation', () => {
  it('returns 422 for a non-UUID param', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: `/repos/${INVALID_ID}/onboarding` });
    await app.close();
    expect(res.statusCode).toBe(422);
  });
});

describe('GET /repos/:id/onboarding — never-generated (AC-2/well-formed empty response)', () => {
  it('returns 200 with a well-formed empty tour, not an error', async () => {
    const app = await buildOnboardingApp({ tourRow: null });
    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/onboarding` });
    await app.close();

    expect(res.statusCode).toBe(200);
    const parsed = OnboardingTour.safeParse(res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.generated_at).toBeNull();
      expect(parsed.data.sections).toHaveLength(5);
    }
  });
});

describe('GET /repos/:id/onboarding — cross-workspace / missing repo (404)', () => {
  it('returns 404 when the repo does not belong to the requesting workspace', async () => {
    const app = await buildOnboardingApp({ repoRow: null });
    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/onboarding` });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /repos/:id/onboarding/generate — cross-workspace (404)', () => {
  it('returns 404 when the repo does not belong to the requesting workspace', async () => {
    const app = await buildOnboardingApp({ repoRow: null });
    const res = await app.inject({ method: 'POST', url: `/repos/${REPO_ID}/onboarding/generate` });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /repos/:id/onboarding/generate — success', () => {
  it('returns 200 with a valid OnboardingTour body', async () => {
    const app = await buildOnboardingApp({});
    const res = await app.inject({ method: 'POST', url: `/repos/${REPO_ID}/onboarding/generate` });
    await app.close();

    expect(res.statusCode).toBe(200);
    const parsed = OnboardingTour.safeParse(res.json());
    expect(parsed.success).toBe(true);
  });

  it('passes a child logger derived from req.log through to the service (AC-6 route-to-service wiring)', async () => {
    // The test-mode app runs with `logger: false` (config.logLevel==='silent',
    // app.ts), so there is no real pino instance whose OUTPUT can be captured
    // at this layer — the actual `llm_cost_cents` log-line CONTENT is already
    // asserted hermetically against a directly-injected Logger in
    // onboarding-service.test.ts (AC-6). This test instead proves the ROUTE
    // itself performs the `req.log.child({...})` call and hands a
    // logger-shaped object to the service, closing the wiring gap between the
    // two layers without inventing a new pino-capture pattern.
    const app = await buildOnboardingApp({});

    let sawChildCall: Record<string, unknown> | undefined;
    app.addHook('onRequest', async (req) => {
      if (req.method === 'POST' && req.url === `/repos/${REPO_ID}/onboarding/generate`) {
        const originalChild = req.log.child.bind(req.log);
        req.log.child = ((bindings: Record<string, unknown>, ...rest: unknown[]) => {
          sawChildCall = bindings;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return originalChild(bindings as any, ...(rest as any));
        }) as typeof req.log.child;
      }
    });

    const res = await app.inject({ method: 'POST', url: `/repos/${REPO_ID}/onboarding/generate` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(sawChildCall).toBeDefined();
    expect(sawChildCall).toMatchObject({ route: 'onboarding.generate', repoId: REPO_ID });
  });
});

describe('POST /repos/:id/onboarding/generate — registered rate-limit config (static assertion)', () => {
  it('the route config shows { max: 3, timeWindow: "1 minute" } and a defined keyGenerator', async () => {
    // A real 429 CANNOT be produced hermetically — @fastify/rate-limit is
    // disabled when nodeEnv==='test' (app.ts:121-125). Instead, inspect the
    // route's OWN registered config via the `onRoute` hook, which fires
    // synchronously at registration time regardless of whether the global
    // rate-limit plugin is active.
    const raw = Fastify();
    raw.setValidatorCompiler(validatorCompiler);
    raw.setSerializerCompiler(serializerCompiler);
    raw.decorate('container', {
      db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }) }) },
    } as unknown as Container);

    let capturedConfig: Record<string, unknown> | undefined;
    raw.addHook('onRoute', (routeOptions) => {
      if (routeOptions.method === 'POST' && routeOptions.url === '/repos/:id/onboarding/generate') {
        capturedConfig = routeOptions.config as Record<string, unknown>;
      }
    });

    await raw.register(onboardingRoutes);
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
