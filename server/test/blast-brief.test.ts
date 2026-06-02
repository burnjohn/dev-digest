import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockEmbedder,
  MockGitClient,
  MockLLMProvider,
} from '../src/adapters/mocks.js';
import { RipgrepCodeIndex } from '../src/adapters/codeindex/ripgrep.js';
import * as t from '../src/db/schema.js';
import type { BlastRadius, PrBrief, Onboarding, Risks } from '@devdigest/shared';
import type { WhyTimeline } from '@devdigest/shared/contracts/why';
import type { GitClient } from '@devdigest/shared';
import blastRoutes from '../src/modules/blast/routes.js';
import briefRoutes from '../src/modules/brief/routes.js';
import onboardingRoutes from '../src/modules/onboarding/routes.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// A risks structured response for the brief LLM call.
const RISKS_FIXTURE: Risks = {
  risks: [
    {
      kind: 'security',
      title: 'Rate-limit bypass risk',
      explanation: 'The change touches the public rate limiter.',
      severity: 'high',
      file_refs: ['src/mw/ratelimit.ts'],
    },
  ],
};

let repoSeq = 0;

d('A3 blast / brief / why / onboarding / context (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let cloneRoot: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    cloneRoot = await mkdtemp(join(tmpdir(), 'dd-blast-'));
  });
  afterAll(async () => {
    await rm(cloneRoot, { recursive: true, force: true }).catch(() => {});
    await pg?.stop();
  });

  /** Create a repo+PR whose clone contains a changed symbol + a downstream caller. */
  async function setup() {
    const name = `payments-api-${repoSeq++}`;
    const clonePath = join(cloneRoot, name);
    // changed file declares rateLimit(); a caller file references it.
    await mkdir(join(clonePath, 'src', 'mw'), { recursive: true });
    await mkdir(join(clonePath, 'src', 'api'), { recursive: true });
    await mkdir(join(clonePath, '.devdigest', 'specs'), { recursive: true });
    await writeFile(
      join(clonePath, 'src', 'mw', 'ratelimit.ts'),
      `export function rateLimit(req) {\n  return true;\n}\n`,
    );
    await writeFile(
      join(clonePath, 'src', 'api', 'public.ts'),
      `import { rateLimit } from '../mw/ratelimit';\nexport function handler(req) {\n  if (!rateLimit(req)) return 429;\n  return 200;\n}\napp.get('/public/data', handler);\n`,
    );
    await writeFile(
      join(clonePath, '.devdigest', 'specs', 'overview.md'),
      `# Overview\n\nThis service rate-limits the public API.\n\n## Architecture\n\nMiddleware fronts the routes.\n`,
    );

    const db = pg.handle.db;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting to public API',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 3,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/mw/ratelimit.ts',
      additions: 3,
      deletions: 0,
      patch: '@@ -0,0 +1,3 @@\n+export function rateLimit(req) {\n+  return true;\n+}',
    });
    return { repo: repo!, pr: pr!, clonePath };
  }

  /** App wired with a real CodeIndex over `cloneRoot` + mock git/llm/embedder. */
  function appWith(structured?: unknown) {
    // GitClient whose clonePathFor maps owner/name → cloneRoot/<name>
    const git: GitClient = new MockGitClient();
    (git as unknown as { clonePathFor: (r: { name: string }) => string }).clonePathFor = (r) =>
      join(cloneRoot, r.name);
    const codeIndex = new RipgrepCodeIndex({ clonePathFor: git.clonePathFor.bind(git) });
    const app = buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git,
        codeIndex,
        llm: { openai: new MockLLMProvider('openai', { structured }) },
      },
    });
    return app;
  }

  it('GET /pulls/:id/blast finds downstream callers + endpoints', async () => {
    const { pr } = await setup();
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const blast = res.json() as BlastRadius;
    expect(blast.changed_symbols.map((s) => s.name)).toContain('rateLimit');
    const ds = blast.downstream.find((x) => x.symbol === 'rateLimit');
    expect(ds).toBeTruthy();
    expect(ds!.callers.length).toBeGreaterThan(0);
    expect(ds!.callers[0]!.file).toContain('src/api/public.ts');
    expect(ds!.endpoints_affected).toContain('GET /public/data');
    await app.close();
  });

  it('GET /pulls/:id/brief has all 4 blocks and persists', async () => {
    const { pr } = await setup();
    const app = await appWith(RISKS_FIXTURE);
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief?refresh=1` });
    expect(res.statusCode).toBe(200);
    const brief = res.json() as PrBrief;
    expect(brief.intent).toBeTruthy();
    expect(brief.blast).toBeTruthy();
    expect(brief.risks.risks.length).toBeGreaterThan(0);
    expect(Array.isArray(brief.history.history)).toBe(true);

    // persisted in pr_brief
    const [row] = await pg.handle.db
      .select()
      .from(t.prBrief)
      .where((await import('drizzle-orm')).eq(t.prBrief.prId, pr.id));
    expect(row).toBeTruthy();
    await app.close();
  });

  it('GET /pulls/:id/why returns a WhyTimeline', async () => {
    const { pr } = await setup();
    const app = await appWith();
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/why?file=src/mw/ratelimit.ts&line=1`,
    });
    expect(res.statusCode).toBe(200);
    const why = res.json() as WhyTimeline;
    expect(why.file).toBe('src/mw/ratelimit.ts');
    expect(why.line).toBe(1);
    // MockGitClient.blame returns one line → blame head present
    expect(why.blame ?? why.events[0]).toBeTruthy();
    await app.close();
  });

  it('why requires file & line (422)', async () => {
    const { pr } = await setup();
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/why` });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('context reindex shows percentage progress and indexes specs', async () => {
    const { repo } = await setup();
    // context module is already registered by buildApp (F1 registry) — do not re-register.
    const app = await appWith();

    const reindex = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/reindex`,
    });
    expect(reindex.statusCode).toBe(200);
    expect(reindex.json().pct).toBeGreaterThanOrEqual(0);

    // wait for the job to drain
    await app.container.jobs.onIdle();

    const status = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/status`,
    });
    expect(status.statusCode).toBe(200);
    const body = status.json();
    expect(body.status).toBe('done');
    expect(body.pct).toBe(100);
    expect(body.chunks_indexed).toBeGreaterThan(0);

    // specs landed in code_chunks(source='spec') → flow into prompts
    const { eq, and } = await import('drizzle-orm');
    const chunks = await pg.handle.db
      .select()
      .from(t.codeChunks)
      .where(and(eq(t.codeChunks.repoId, repo.id), eq(t.codeChunks.source, 'spec')));
    expect(chunks.length).toBeGreaterThan(0);
    await app.close();
  });

  it('PUT /context/:path writes a spec (and rejects traversal)', async () => {
    const { repo } = await setup();
    const app = await appWith();

    const ok = await app.inject({
      method: 'PUT',
      url: `/context/.devdigest/specs/new.md`,
      payload: { repoId: repo.id, content: '# New spec\n\nhello' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().path).toBe('.devdigest/specs/new.md');

    // A path that reaches the handler but is outside .devdigest/specs/ → rejected.
    const bad = await app.inject({
      method: 'PUT',
      url: `/context/etc/passwd.md`,
      payload: { repoId: repo.id, content: 'x' },
    });
    expect([400, 422]).toContain(bad.statusCode);
    await app.close();
  });

  it('POST /repos/:id/onboarding/generate yields 5 sections; GET returns them', async () => {
    const { repo } = await setup();
    // onboarding structured section write — MockLLM returns this for each section
    const sectionFixture = {
      kind: 'overview',
      title: 'Overview',
      body: 'This is the overview.',
      diagram: null,
      links: [{ label: 'README', path: 'README.md' }],
    };
    const app = await appWith(sectionFixture);

    const gen = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/onboarding/generate`,
    });
    expect(gen.statusCode).toBe(200);
    const onboarding = gen.json() as Onboarding;
    expect(onboarding.sections.length).toBe(5);
    // canonical kinds enforced
    expect(onboarding.sections.map((s) => s.kind)).toEqual([
      'overview',
      'architecture',
      'modules',
      'getting-started',
      'conventions',
    ]);

    const get = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(get.statusCode).toBe(200);
    expect((get.json() as Onboarding).sections.length).toBe(5);
    await app.close();
  });
});
