# Examples — before / after for the four archetypes

Every "before" is real code from `server/src` as of **2026-08-15**, trimmed for length. Every
"after" is the shape this skill prescribes.

1. [Routes-with-SQL → routes + service + repository](#1-routes-with-sql--routes--service--repository)
2. [`Container` → `Deps`, call sites unchanged](#2-container--deps-call-sites-unchanged)
3. [`typeof schema.x.$inferSelect` → `db/rows.ts`](#3-typeof-schemax_inferselect--dbrowsts)
4. [Cross-module constant → kernel](#4-cross-module-constant--kernel)

---

## 1. Routes-with-SQL → routes + service + repository

Source: `modules/pulls/routes.ts` — 381 lines, ~18 inline `container.db` calls.

### Before

```ts
// modules/pulls/routes.ts
import { and, desc, eq, inArray, isNull, sum } from 'drizzle-orm';   // ← R5 importing R4
import * as t from '../../db/schema.js';                              // ← R5 importing R4

export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
    const { workspaceId } = await getContext(container, req);
    const [repo] = await container.db
      .select().from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
    if (!repo) throw new NotFoundError('Repo not found');

    let gh: GitHubClient | null = null;
    try { gh = await container.github(); } catch (err) { app.log.warn(...); }

    if (gh) {
      try {
        const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
        for (const pr of pulls) {
          await container.db.insert(t.pullRequests).values({ /* 13 fields */ })
            .onConflictDoUpdate({ target: [...], set: { /* 4 fields */ } });
        }
      } catch (err) { app.log.warn(...); }
    }

    const rows = await container.db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repo.id));

    // ~30 lines: diff-stat backfill loop, capped at 10 detail fetches
    // ~15 lines: latest-review score per PR (IN-query + JS grouping)
    // ~10 lines: cost rollup (SUM over agent_runs)
    // ~35 lines: findings dedup across runs + severity tally
    // ~25 lines: row → PrMeta object literal
  });
  // ... 3 more handlers, same shape
}
```

Three things are wrong and none of them are about the code *inside* a function:

- The HTTP handler is the repository. `drizzle-orm` and `db/schema` are imported at R5.
- **"Import PRs from GitHub" has no name.** It cannot be called by the poller, scheduled as a job,
  or tested without booting Fastify.
- The row→DTO mapping is inline, so nothing enforces that the response is a `PrMeta`.

### After

```ts
// modules/pulls/repository.ts  ← R3, the only file here that may say `drizzle-orm`
import { and, desc, eq, inArray, isNull, sum } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import type { Db } from '../../db/client.js';
import type { PullRow, RepoRow } from '../../db/rows.js';

export class PullsRepository {
  constructor(private db: Db) {}

  getRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> { /* … */ }
  listByRepo(repoId: string): Promise<PullRow[]> { /* … */ }
  upsertFromGitHub(workspaceId: string, repoId: string, pr: PrMeta): Promise<void> { /* … */ }
  updateDiffStats(prId: string, s: { additions: number; deletions: number; filesCount: number }): Promise<void> { /* … */ }
  latestReviewScores(prIds: string[]): Promise<{ prId: string; score: number | null }[]> { /* … */ }
  costByPr(prIds: string[]): Promise<{ prId: string; cost: number }[]> { /* … */ }
  findingsForPrs(prIds: string[]): Promise<FindingTallyRow[]> { /* … */ }
}
```

```ts
// modules/pulls/service.ts  ← R2, no drizzle-orm, no fastify
import type { Db } from '../../db/client.js';
import type { GitHubClient, PrMeta } from '@devdigest/shared';
import { PullsRepository } from './repository.js';
import { toPrMeta } from './helpers.js';
import { BACKFILL_LIMIT } from './constants.js';

export interface PullsServiceDeps {
  db: Db;
  github: () => Promise<GitHubClient>;   // resolver, not a resolved client — boot-with-no-keys
}

export class PullsService {
  private repo: PullsRepository;
  constructor(private deps: PullsServiceDeps) {
    this.repo = new PullsRepository(deps.db);
  }

  /** Local-first: sync from GitHub when a token exists, never fail the read. */
  async listForRepo(workspaceId: string, repoId: string): Promise<PrMeta[]> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const gh = await this.tryGitHub();
    if (gh) await this.syncFromGitHub(gh, workspaceId, repo);

    const rows = await this.repo.listByRepo(repo.id);
    if (gh) await this.backfillDiffStats(gh, repo, rows);   // capped at BACKFILL_LIMIT

    const [scores, costs, findings] = await this.rollups(rows.map((r) => r.id));
    return rows.map((r) => toPrMeta(r, scores, costs, findings));
  }
}
```

```ts
// modules/pulls/routes.ts  ← R5, ~60 lines
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PrMeta } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PullsService } from './service.js';

export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PullsService(app.container);   // resolved in the plugin body, not the handler

  app.get(
    '/repos/:id/pulls',
    { schema: { params: IdParams, response: { 200: z.array(PrMeta) } } },   // ← the outward DTO gate
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listForRepo(workspaceId, req.params.id);
    },
  );
}
```

Note `new PullsService(app.container)` — `Container` structurally satisfies `PullsServiceDeps`, so
the composition root needs no edit.

**What moved rings:** `drizzle-orm` + `db/schema` R5 → R3. The four handlers went from ~95 lines
each to 4. `listForRepo` is now callable from the poller and testable with a fake repository.

**Compare with the module that already does this:** `modules/repos/routes.ts` is 48 lines with zero
`container.db` calls. It is the shape to copy.

---

## 2. `Container` → `Deps`, call sites unchanged

Source: `modules/repos/service.ts`. This exact edit was applied and type-checked — see the README.

### Before

```ts
import type { Container } from '../../platform/container.js';

export class RepoService {
  private repo: RepoRepository;

  constructor(private container: Container) {
    this.repo = new RepoRepository(container.db);
  }

  registerCloneJobHandler(): void {
    this.container.jobs.register(CLONE_JOB_KIND, async (payload) => { /* … */ });
  }

  async runCloneJob(payload: CloneJobPayload): Promise<void> {
    const token = await this.container.secrets.get(GITHUB_TOKEN_SECRET);
    const { path } = await this.container.git.clone({ owner, name }, cloneUrl, { depth: CLONE_DEPTH });
    // …
  }
}
```

The signature says the service depends on *everything*. Nothing tells a reader — or a test — that
it actually uses four things.

### After

```ts
import type { GitClient, SecretsProvider, Repo } from '@devdigest/shared';
import type { Db } from '../../db/client.js';                  // type-only: the R2 carve-out
import type { JobRunner } from '../../platform/infra/jobs.js';

export interface RepoServiceDeps {
  db: Db;
  jobs: JobRunner;
  git: GitClient;
  secrets: SecretsProvider;
}

export class RepoService {
  private repo: RepoRepository;

  constructor(private deps: RepoServiceDeps) {
    this.repo = new RepoRepository(deps.db);
  }

  registerCloneJobHandler(): void {
    this.deps.jobs.register(CLONE_JOB_KIND, async (payload) => { /* … */ });
  }

  async runCloneJob(payload: CloneJobPayload): Promise<void> {
    const token = await this.deps.secrets.get(GITHUB_TOKEN_SECRET);
    const { path } = await this.deps.git.clone({ owner, name }, cloneUrl, { depth: CLONE_DEPTH });
    // …
  }
}
```

### The call site — **unchanged**

```ts
// modules/repos/routes.ts — not edited
const service = new RepoService(app.container);
```

`Container` has public `db`, `jobs`, `secrets` and a `git` getter, so it structurally satisfies
`RepoServiceDeps`. TypeScript accepts it; the extra members are irrelevant.

### And the test that becomes possible

```ts
// BEFORE — the only way to test a service today (test/repo-intel-facade-degraded.test.ts)
const container = { config: { repoIntelEnabled: false }, db: {} as never, codeIndex: {…} as never } as never;
const svc = new RepoIntelService(container);
(svc as unknown as { repo: Record<string, unknown> }).repo = { getRepoBasics: async () => null, … };

// AFTER — an object literal the compiler checks
const svc = new RepoIntelService({
  config: { repoIntelEnabled: false },
  db: fakeDb,
  codeIndex: new MockCodeIndex(),
  repo: { getRepoBasics: async () => null, tryGetIndexState: async () => null, … },
});
```

Three `as never` casts and a private-field write disappear. That is the payoff — not tidiness.

---

## 3. `typeof schema.x.$inferSelect` → `db/rows.ts`

Source: `modules/repos/helpers.ts:2,50` — and the same pattern at
`modules/reviews/run-executor.ts:58,141` and `modules/reviews/diff-loader.ts:17`.

### Before

```ts
// modules/repos/helpers.ts  ← R2 importing the whole Drizzle schema…
import * as t from '../../db/schema.js';

/** Map a persisted repo row to the API `Repo` DTO. */
export function toRepoDto(row: typeof t.repos.$inferSelect): Repo {
  return { id: row.id, workspace_id: row.workspaceId, /* … */ };
}
```

…to read **one type**. No query is being built — the file does not import `drizzle-orm` at all. But
the import edge is real, a linter cannot tell the difference, and the next person to need "just one
more table" reaches for the same namespace.

### After

```ts
// db/rows.ts — one new line
export type RepoRow = typeof t.repos.$inferSelect;
```

```ts
// modules/repos/helpers.ts
import type { RepoRow } from '../../db/rows.js';

/** Map a persisted repo row to the API `Repo` DTO. */
export function toRepoDto(row: RepoRow): Repo {
  return { id: row.id, workspace_id: row.workspaceId, /* … */ };
}
```

**Growing `db/rows.ts` is the correct fix, not a workaround.** The file already exists with exactly
this rationale in its header: shared row types live next to the schema so cross-cutting consumers
can name a row shape *without importing another module's data layer*.

The rule this enforces, from SKILL §1: **a Drizzle row type never enters `vendor/shared`, and a
contract type never enters a `repository.ts` signature.** `toRepoDto` is the hinge — `RepoRow` in,
`Repo` out, R2, pure.

---

## 4. Cross-module constant → kernel

Source: `modules/repos/service.ts:12-14`.

### Before

```ts
// modules/repos/service.ts
import { CLONE_JOB_KIND, CLONE_DEPTH, GITHUB_TOKEN_SECRET } from './constants.js';
import { INDEX_JOB_KIND, REFRESH_JOB_KIND } from '../repo-intel/constants.js';   // ← module → module
```

`repos` enqueues a job that `repo-intel` handles. The constant is genuinely shared, so it got
imported across the boundary — and now `repos` cannot be understood, moved, or deleted without
reading `repo-intel`.

The tempting fixes are both wrong: duplicating the string invites silent drift (an enqueue with no
handler fails at runtime, not at compile time), and a `shared/` module just relocates the problem.

### After

```ts
// platform/job-kinds.ts  ← R1 kernel: no imports at all
/**
 * Job kinds are contracts BETWEEN modules — the enqueuer and the handler never
 * live in the same module — so they belong to the kernel, not to either side.
 */
export const CLONE_JOB_KIND = 'clone';
export const INDEX_JOB_KIND = 'repo-intel-index';
export const REFRESH_JOB_KIND = 'repo-intel-refresh';
export const RESYNC_JOB_KIND = 'repo-intel-resync';
```

```ts
// modules/repos/service.ts       — enqueuer
import { CLONE_JOB_KIND, INDEX_JOB_KIND, REFRESH_JOB_KIND } from '../../platform/job-kinds.js';

// modules/repo-intel/service.ts  — handler
import { INDEX_JOB_KIND, REFRESH_JOB_KIND, RESYNC_JOB_KIND } from '../../platform/job-kinds.js';
```

Both modules now point *inward* at the kernel instead of sideways at each other. Two constants,
three files.

### The general rule

> **A constant used by two modules is a contract, and a contract does not live inside a module.**

Where it goes depends on what it is:

| The constant is… | Goes to |
|---|---|
| a queue/job identifier | `platform/job-kinds.ts` (R1) |
| part of the wire shape the client sees | `vendor/shared/contracts/` (R0) |
| a property of an adapter's own behaviour | that adapter's `constants.ts` (R4) — the V8 case |
| genuinely used by one module | stays in `modules/<m>/constants.ts` |

If none of the four fit, the two modules are probably one module.
