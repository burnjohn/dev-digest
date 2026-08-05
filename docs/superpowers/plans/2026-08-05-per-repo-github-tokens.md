# Per-repo GitHub Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user keep several labelled GitHub tokens, managed entirely in the UI, and pick per repo which one authenticates its API calls and clones.

**Architecture:** A new `github_tokens` table holds non-secret metadata (label, `@login`, timestamps); the PAT itself stays in `~/.devdigest/secrets.json` behind the existing `SecretsProvider` under key `GITHUB_TOKEN:<id>`. `repos.github_token_id` is a nullable FK with `ON DELETE SET NULL`, so `NULL` *is* the broken state. `Container.github()` takes a token id and caches one Octokit client per id. The `GITHUB_TOKEN` env path is deleted outright — no fallback, no adoption step.

**Tech Stack:** Fastify 5, Drizzle ORM + Postgres, Zod contracts, Vitest (+ testcontainers for DB tests), Next.js 15 App Router, TanStack Query.

**Spec:** [docs/superpowers/specs/2026-08-05-per-repo-github-tokens-design.md](../specs/2026-08-05-per-repo-github-tokens-design.md)

## Global Constraints

- **Vocabulary is `token` everywhere:** table `github_tokens`, column `repos.github_token_id`, routes `/github-tokens`, error code `token_missing`. Never "credential".
- **Secrets never enter Postgres.** Token values go only through `SecretsProvider`. Migrations carry no secret material.
- **`server/src/vendor/shared/` is canonical; `client/src/vendor/shared/` is a hand-maintained copy, NOT a symlink.** Every contract change must be applied to both, with both barrels updated.
- **Extend contracts, never edit existing contract files.** New types go in a new `contracts/github-tokens.ts`.
- **Do not edit `server/src/db/migrations/`** — drizzle-kit generates it.
- **Only one vendored UI file may be touched:** `client/src/vendor/ui/nav.ts` (two additions: a `NAV` item and a `SETTINGS_SECTIONS` entry). No other file under `client/src/vendor/ui/` changes.
- **`client/messages/en/ci.json:93` must not be touched** — its `GITHUB_TOKEN` is GitHub Actions' own auto-provided token in generated workflows, unrelated to this feature.
- **Validation errors answer 422**, never 400. `token_missing` is 422.
- **Test split:** `server/test/*.it.test.ts` = DB-backed (testcontainers); every other `server/test/*.test.ts` is hermetic. Client tests are colocated `*.test.tsx` with `fetch` mocked.
- **Access probing uses `listPullRequests`.** `GitHubClient` has no `getRepo` method (`server/src/vendor/shared/adapters.ts:149-173`) and adding one would edit an existing contract. `listPullRequests` 404s for a repo the token cannot read, which is precisely the capability DevDigest needs.

---

### Task 1: Unblock the toolchain

`pnpm db:migrate`, `pnpm db:generate`, and `pnpm test` all currently exit 1 before doing anything, because pnpm 11.6.0 refuses to run any script while the project has ignored build scripts. Every later task needs these commands, so this comes first.

**Files:**
- Modify: `server/pnpm-workspace.yaml` (already exists, auto-generated stub, untracked)

**Interfaces:**
- Consumes: nothing
- Produces: working `pnpm db:generate`, `pnpm db:migrate`, `pnpm test`, `pnpm typecheck` in `server/`

- [ ] **Step 1: Reproduce the failure**

```bash
cd server && pnpm db:migrate
```

Expected: exits 1 with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cpu-features@0.0.10, esbuild@..., protobufjs@..., ssh2@...`

- [ ] **Step 2: Fill in the allowBuilds stub**

Replace the whole of `server/pnpm-workspace.yaml` with:

```yaml
allowBuilds:
  cpu-features: true
  esbuild: true
  protobufjs: true
  ssh2: true
```

- [ ] **Step 3: Run the builds**

```bash
cd server && pnpm install
```

Expected: completes without `ERR_PNPM_IGNORED_BUILDS`.

- [ ] **Step 4: Verify the scripts work**

```bash
cd server && pnpm db:migrate && pnpm typecheck
```

Expected: `✓ migrations applied`, then a clean typecheck.

- [ ] **Step 5: Check the client for the same problem**

```bash
cd client && pnpm typecheck
```

If it fails with `ERR_PNPM_IGNORED_BUILDS`, create `client/pnpm-workspace.yaml` with the same `allowBuilds:` block listing exactly the packages that error names, then `pnpm install`. If it passes, create nothing.

- [ ] **Step 6: Commit**

```bash
git add server/pnpm-workspace.yaml client/pnpm-workspace.yaml 2>/dev/null; git add -u
git commit -m "chore: approve dependency build scripts so pnpm can run scripts

pnpm 11.6.0 refuses to run ANY script while builds are ignored, so
db:migrate and test both exited 1 before doing any work."
```

---

### Task 2: Schema and migration

**Files:**
- Create: `server/src/db/schema/github-tokens.ts`
- Modify: `server/src/db/schema/repos.ts` (add `githubTokenId`)
- Modify: `server/src/db/schema.ts` (barrel: re-export + add to the `schema` object)
- Create: `server/test/github-tokens-schema.it.test.ts`
- Generated (do not hand-edit): `server/src/db/migrations/*`

**Interfaces:**
- Consumes: `now` from `./_shared`, `workspaces` from `./core`
- Produces: `githubTokens` table (`id`, `workspaceId`, `label`, `githubLogin`, `createdAt`, `lastValidatedAt`); `repos.githubTokenId` nullable FK with `ON DELETE SET NULL`

- [ ] **Step 1: Write the failing DB test**

Create `server/test/github-tokens-schema.it.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('github_tokens schema', () => {
  let pg: PgFixture;
  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('deleting a token nulls repos.github_token_id instead of cascading', async () => {
    const { workspaceId, userId } = await seed(pg.db);

    const [token] = await pg.db
      .insert(t.githubTokens)
      .values({ workspaceId, label: 'work', githubLogin: 'octocat' })
      .returning();

    const [repo] = await pg.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'api',
        fullName: 'acme/api',
        createdBy: userId,
        githubTokenId: token!.id,
      })
      .returning();

    await pg.db.delete(t.githubTokens).where(eq(t.githubTokens.id, token!.id));

    const [after] = await pg.db.select().from(t.repos).where(eq(t.repos.id, repo!.id));
    expect(after).toBeDefined();
    expect(after!.githubTokenId).toBeNull();
  });

  it('label is unique per workspace', async () => {
    const { workspaceId } = await seed(pg.db);
    await pg.db.insert(t.githubTokens).values({ workspaceId, label: 'dupe' });
    await expect(
      pg.db.insert(t.githubTokens).values({ workspaceId, label: 'dupe' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && pnpm test test/github-tokens-schema.it.test.ts
```

Expected: FAIL — `t.githubTokens` is undefined.

- [ ] **Step 3: Create the table**

Create `server/src/db/schema/github-tokens.ts`:

```ts
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';

/**
 * GitHub PATs the user manages in the UI — METADATA ONLY. The token value
 * lives in the SecretsProvider under `GITHUB_TOKEN:<id>`, never here and never
 * in a migration. `repos.github_token_id` picks which one authenticates a repo.
 */
export const githubTokens = pgTable(
  'github_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    githubLogin: text('github_login'),
    createdAt: now(),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
  },
  (t) => ({
    uq: uniqueIndex('github_tokens_ws_label_uq').on(t.workspaceId, t.label),
    wsIdx: index('github_tokens_ws_idx').on(t.workspaceId),
  }),
);
```

- [ ] **Step 4: Add the column to `repos`**

In `server/src/db/schema/repos.ts`, add the import and the column. The `ON DELETE SET NULL` is what makes a deleted token leave the repo in the broken state rather than deleting the repo:

```ts
import { githubTokens } from './github-tokens';
```

Inside the `repos` column object, after `clonePath`:

```ts
    githubTokenId: uuid('github_token_id').references(() => githubTokens.id, {
      onDelete: 'set null',
    }),
```

- [ ] **Step 5: Wire the barrel**

In `server/src/db/schema.ts` add the re-export next to the others:

```ts
export * from './schema/github-tokens';
```

Add the import alongside the existing ones:

```ts
import { githubTokens } from './schema/github-tokens';
```

And add `githubTokens,` to the `schema` object (put it directly after `repos,`).

- [ ] **Step 6: Generate and apply the migration**

```bash
cd server && pnpm db:generate && pnpm db:migrate
```

Expected: a new file under `src/db/migrations/`, then `✓ migrations applied`. Read the generated SQL and confirm it contains `CREATE TABLE "github_tokens"`, `ALTER TABLE "repos" ADD COLUMN "github_token_id"`, and `ON DELETE set null`. Do not edit it.

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd server && pnpm test test/github-tokens-schema.it.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add server/src/db server/test/github-tokens-schema.it.test.ts
git commit -m "feat(db): github_tokens table and repos.github_token_id

ON DELETE SET NULL makes 'this repo has no usable token' a database
guarantee rather than application bookkeeping."
```

---

### Task 3: Shared contracts

**Files:**
- Create: `server/src/vendor/shared/contracts/github-tokens.ts`
- Modify: `server/src/vendor/shared/index.ts` (barrel)
- Create: `client/src/vendor/shared/contracts/github-tokens.ts` (identical copy)
- Modify: `client/src/vendor/shared/index.ts` (barrel)
- Create: `server/test/github-tokens-contracts.test.ts`

**Interfaces:**
- Consumes: `Repo`, `RepoInput` from `./platform.js`
- Produces: `GitHubToken`, `GitHubTokenInput`, `GitHubTokenPatch`, `GitHubTokenTestInput`, `GitHubTokenTestResult`, `RepoCreate`, `RepoWithToken`, `AssignRepoTokenInput`

- [ ] **Step 1: Write the failing contract test**

Create `server/test/github-tokens-contracts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GitHubToken, GitHubTokenInput, RepoCreate, RepoWithToken } from '@devdigest/shared';

describe('github token contracts', () => {
  it('GitHubToken never carries the token value', () => {
    const parsed = GitHubToken.parse({
      id: 'a3f',
      workspace_id: 'ws',
      label: 'work',
      github_login: 'octocat',
      configured: true,
      repo_count: 2,
      created_at: '2026-08-05T00:00:00Z',
      last_validated_at: null,
      token: 'ghp_leak',
    });
    expect('token' in parsed).toBe(false);
  });

  it('GitHubTokenInput requires a non-empty label and token', () => {
    expect(GitHubTokenInput.safeParse({ label: '', token: 'ghp_x' }).success).toBe(false);
    expect(GitHubTokenInput.safeParse({ label: 'work', token: '' }).success).toBe(false);
    expect(GitHubTokenInput.safeParse({ label: 'work', token: 'ghp_x' }).success).toBe(true);
  });

  it('RepoCreate keeps github_token_id optional so {url} alone still parses', () => {
    expect(RepoCreate.safeParse({ url: 'https://github.com/acme/api' }).success).toBe(true);
    const withToken = RepoCreate.parse({ url: 'https://github.com/acme/api', github_token_id: 'a3f' });
    expect(withToken.github_token_id).toBe('a3f');
  });

  it('RepoWithToken allows a null token id and label (the broken state)', () => {
    const r = RepoWithToken.parse({
      id: 'r1',
      workspace_id: 'ws',
      owner: 'acme',
      name: 'api',
      full_name: 'acme/api',
      default_branch: 'main',
      clone_path: null,
      last_polled_at: null,
      created_by: null,
      github_token_id: null,
      github_token_label: null,
    });
    expect(r.github_token_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && pnpm test test/github-tokens-contracts.test.ts
```

Expected: FAIL — no export named `GitHubToken`.

- [ ] **Step 3: Write the contract file**

Create `server/src/vendor/shared/contracts/github-tokens.ts`:

```ts
import { z } from 'zod';
import { Repo, RepoInput } from './platform.js';

/**
 * Per-repo GitHub tokens. The token VALUE is never part of any response
 * contract — it lives only in the SecretsProvider. `configured` reports
 * whether a value resolves, which is all a client needs to know.
 */
export const GitHubToken = z.object({
  id: z.string(),
  workspace_id: z.string(),
  label: z.string(),
  github_login: z.string().nullable(),
  configured: z.boolean(),
  repo_count: z.number().int(),
  created_at: z.string(),
  last_validated_at: z.string().nullable(),
});
export type GitHubToken = z.infer<typeof GitHubToken>;

export const GitHubTokenInput = z.object({
  label: z.string().min(1).max(60),
  token: z.string().min(1),
});
export type GitHubTokenInput = z.infer<typeof GitHubTokenInput>;

/** Rename, replace the value, or both. */
export const GitHubTokenPatch = z
  .object({
    label: z.string().min(1).max(60).optional(),
    token: z.string().min(1).optional(),
  })
  .refine((v) => v.label !== undefined || v.token !== undefined, {
    message: 'Provide label, token, or both',
  });
export type GitHubTokenPatch = z.infer<typeof GitHubTokenPatch>;

export const GitHubTokenTestInput = z.object({
  token: z.string().min(1),
  /** Optional `owner/name` — when given, also proves the token can read that repo. */
  full_name: z.string().optional(),
});
export type GitHubTokenTestInput = z.infer<typeof GitHubTokenTestInput>;

export const GitHubTokenTestResult = z.object({
  ok: z.boolean(),
  login: z.string().nullable(),
  message: z.string(),
});
export type GitHubTokenTestResult = z.infer<typeof GitHubTokenTestResult>;

/** `POST /repos` body. `github_token_id` is optional: omitted → no token. */
export const RepoCreate = RepoInput.extend({
  github_token_id: z.string().optional(),
});
export type RepoCreate = z.infer<typeof RepoCreate>;

export const AssignRepoTokenInput = z.object({
  github_token_id: z.string().nullable(),
});
export type AssignRepoTokenInput = z.infer<typeof AssignRepoTokenInput>;

export const RepoWithToken = Repo.extend({
  github_token_id: z.string().nullable(),
  github_token_label: z.string().nullable(),
});
export type RepoWithToken = z.infer<typeof RepoWithToken>;
```

- [ ] **Step 4: Export it from the server barrel**

In `server/src/vendor/shared/index.ts`, add after the `platform.js` line:

```ts
export * from './contracts/github-tokens.js';
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd server && pnpm test test/github-tokens-contracts.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Mirror both files into the client copy**

`client/src/vendor/shared/` is a real directory, not a symlink, so this is a genuine second edit:

```bash
cp server/src/vendor/shared/contracts/github-tokens.ts client/src/vendor/shared/contracts/github-tokens.ts
```

Then add the same `export * from './contracts/github-tokens.js';` line to `client/src/vendor/shared/index.ts`.

- [ ] **Step 7: Verify both packages typecheck**

```bash
cd server && pnpm typecheck && cd ../client && pnpm typecheck
```

Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add server/src/vendor/shared client/src/vendor/shared server/test/github-tokens-contracts.test.ts
git commit -m "feat(shared): github token contracts in both vendor/shared copies

client/src/vendor/shared is a hand-maintained copy, not a symlink, so
the file and the barrel line go in twice."
```

---

### Task 4: Resolver and `MissingTokenError`

Note: the resolver needs **no** database access. With the env fallback gone there is no `legacy` flag to read, and the FK guarantees any non-null `repos.github_token_id` references a real row — so this collapses to a key-format helper plus a secrets lookup.

**Files:**
- Modify: `server/src/platform/errors.ts` (add `MissingTokenError`)
- Create: `server/src/modules/github-tokens/resolver.ts`
- Create: `server/test/github-token-resolver.test.ts`

**Interfaces:**
- Consumes: `SecretsProvider` from `@devdigest/shared`
- Produces: `tokenSecretKey(id: string): string` → `` `GITHUB_TOKEN:${id}` ``; `resolveGitHubToken(secrets: SecretsProvider, githubTokenId: string | null): Promise<string>` (throws `MissingTokenError`); `MissingTokenError` with `code: 'token_missing'`, `statusCode: 422`

- [ ] **Step 1: Write the failing test**

Create `server/test/github-token-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SecretKey, SecretsProvider } from '@devdigest/shared';
import { resolveGitHubToken, tokenSecretKey } from '../src/modules/github-tokens/resolver.js';
import { MissingTokenError } from '../src/platform/errors.js';

function fakeSecrets(stored: Record<string, string>, env: NodeJS.ProcessEnv = {}): SecretsProvider {
  return {
    async get(key: SecretKey) {
      const v = stored[key as string];
      if (v) return v;
      return env[key as string];
    },
  };
}

describe('resolveGitHubToken', () => {
  it('reads the namespaced key for the given token id', async () => {
    const secrets = fakeSecrets({ 'GITHUB_TOKEN:abc': 'ghp_abc' });
    await expect(resolveGitHubToken(secrets, 'abc')).resolves.toBe('ghp_abc');
  });

  it('throws MissingTokenError for a null id', async () => {
    const secrets = fakeSecrets({ 'GITHUB_TOKEN:abc': 'ghp_abc' });
    await expect(resolveGitHubToken(secrets, null)).rejects.toBeInstanceOf(MissingTokenError);
  });

  it('throws MissingTokenError when nothing is stored for the id', async () => {
    await expect(resolveGitHubToken(fakeSecrets({}), 'abc')).rejects.toBeInstanceOf(
      MissingTokenError,
    );
  });

  it('treats a tombstoned empty value as absent', async () => {
    const secrets = fakeSecrets({ 'GITHUB_TOKEN:abc': '' });
    await expect(resolveGitHubToken(secrets, 'abc')).rejects.toBeInstanceOf(MissingTokenError);
  });

  // Regression guard for the removed env fallback: a bare GITHUB_TOKEN in the
  // environment must NEVER be used for any repo.
  it('never falls back to a bare GITHUB_TOKEN from the environment', async () => {
    const secrets = fakeSecrets({}, { GITHUB_TOKEN: 'ghp_env', GITHUB_PAT: 'ghp_env_pat' });
    await expect(resolveGitHubToken(secrets, 'abc')).rejects.toBeInstanceOf(MissingTokenError);
  });

  it('MissingTokenError is a 422 with code token_missing', () => {
    const err = new MissingTokenError();
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('token_missing');
  });

  it('tokenSecretKey namespaces by id', () => {
    expect(tokenSecretKey('abc')).toBe('GITHUB_TOKEN:abc');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && pnpm test test/github-token-resolver.test.ts
```

Expected: FAIL — cannot find module `resolver.js`.

- [ ] **Step 3: Add the error class**

Append to `server/src/platform/errors.ts`:

```ts
/**
 * No usable GitHub token for this repo — either none was ever assigned or the
 * assigned one was deleted. 422, not ConfigError's 500: this is user-fixable
 * state, and the client renders a "assign a token" CTA off the code.
 */
export class MissingTokenError extends AppError {
  constructor(message = 'No GitHub token is assigned to this repository', details?: unknown) {
    super('token_missing', message, 422, details);
  }
}
```

- [ ] **Step 4: Write the resolver**

Create `server/src/modules/github-tokens/resolver.ts`:

```ts
import type { SecretsProvider } from '@devdigest/shared';
import { MissingTokenError } from '../../platform/errors.js';

/**
 * The ONE place that knows how a token id maps to a secrets key. Swapping
 * LocalSecretsProvider for a Vault backend stays a one-adapter change.
 */
export const tokenSecretKey = (githubTokenId: string): string => `GITHUB_TOKEN:${githubTokenId}`;

/**
 * Resolve the PAT for a repo's assigned token. One lookup, no fallback —
 * a bare GITHUB_TOKEN in the environment is deliberately never consulted.
 * An empty stored value counts as absent (that is how deletion tombstones).
 */
export async function resolveGitHubToken(
  secrets: SecretsProvider,
  githubTokenId: string | null,
): Promise<string> {
  if (!githubTokenId) throw new MissingTokenError();
  const value = await secrets.get(tokenSecretKey(githubTokenId));
  if (!value) throw new MissingTokenError();
  return value;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd server && pnpm test test/github-token-resolver.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/platform/errors.ts server/src/modules/github-tokens/resolver.ts server/test/github-token-resolver.test.ts
git commit -m "feat(server): per-token secret resolution and MissingTokenError

422 token_missing, because a repo whose token was deleted is
user-fixable state and not a broken deployment."
```

---

### Task 5: Container takes a token id

**Files:**
- Modify: `server/src/platform/container.ts:153-160` (`github()`), `:65` (`_github` field), `:217` (`invalidateSecretCaches`)
- Modify: `server/src/modules/pulls/routes.ts:36,204,302,325`
- Modify: `server/src/modules/polling/routes.ts:28`
- Create: `server/test/container-github-cache.test.ts`

**Interfaces:**
- Consumes: `resolveGitHubToken`, `MissingTokenError` from Task 4
- Produces: `Container.github(githubTokenId: string | null): Promise<GitHubClient>` — required argument, per-id cache, `overrides.github` still short-circuits first

- [ ] **Step 1: Write the failing test**

Create `server/test/container-github-cache.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SecretKey, SecretsProvider } from '@devdigest/shared';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MissingTokenError } from '../src/platform/errors.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';

function secretsWith(stored: Record<string, string>): SecretsProvider {
  return {
    async get(key: SecretKey) {
      return stored[key as string];
    },
    async set(key: SecretKey, value: string) {
      stored[key as string] = value;
    },
  };
}

describe('Container.github(githubTokenId)', () => {
  it('returns the same client for the same id and different clients per id', async () => {
    const c = new Container(loadConfig(), {
      secrets: secretsWith({ 'GITHUB_TOKEN:a': 'ghp_a', 'GITHUB_TOKEN:b': 'ghp_b' }),
    });
    const a1 = await c.github('a');
    const a2 = await c.github('a');
    const b1 = await c.github('b');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b1);
  });

  it('throws MissingTokenError for a null id', async () => {
    const c = new Container(loadConfig(), { secrets: secretsWith({}) });
    await expect(c.github(null)).rejects.toBeInstanceOf(MissingTokenError);
  });

  it('invalidateSecretCaches drops cached clients so a replaced value takes effect', async () => {
    const stored: Record<string, string> = { 'GITHUB_TOKEN:a': 'ghp_a' };
    const c = new Container(loadConfig(), { secrets: secretsWith(stored) });
    const first = await c.github('a');
    stored['GITHUB_TOKEN:a'] = 'ghp_rotated';
    c.invalidateSecretCaches();
    const second = await c.github('a');
    expect(second).not.toBe(first);
  });

  it('an injected override wins over resolution, with any id', async () => {
    const gh = new MockGitHubClient();
    const c = new Container(loadConfig(), { secrets: secretsWith({}), github: gh });
    await expect(c.github(null)).resolves.toBe(gh);
    await expect(c.github('anything')).resolves.toBe(gh);
  });
});
```

Check the `Container` constructor signature at `server/src/platform/container.ts` before running; if overrides are passed differently, match the existing shape rather than this sketch.

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && pnpm test test/container-github-cache.test.ts
```

Expected: FAIL — `github()` takes no argument / caches a single client.

- [ ] **Step 3: Rework the container**

In `server/src/platform/container.ts`, replace the `_github` field (line ~65):

```ts
  private githubClients = new Map<string, GitHubClient>();
```

Replace the `github()` method (lines ~153-160):

```ts
  /**
   * GitHub client for ONE token id. The argument is required and has no
   * default so TypeScript flags any call site that has not been taught which
   * repo it is acting for — a silent fallback to a global token is exactly
   * what this feature removes. One cached client per id.
   */
  async github(githubTokenId: string | null): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (!githubTokenId) throw new MissingTokenError();
    const cached = this.githubClients.get(githubTokenId);
    if (cached) return cached;
    const token = await resolveGitHubToken(this.secrets, githubTokenId);
    const client = new OctokitGitHubClient(token);
    this.githubClients.set(githubTokenId, client);
    return client;
  }
```

Add the imports:

```ts
import { resolveGitHubToken } from '../modules/github-tokens/resolver.js';
import { MissingTokenError } from './errors.js';
```

In `invalidateSecretCaches()` (line ~217) replace `this._github = undefined;` with:

```ts
    this.githubClients.clear();
```

- [ ] **Step 4: Update the five call sites**

Each already loads its `repo` row immediately above the call, so the id is in scope.

`server/src/modules/polling/routes.ts:28`:

```ts
    const gh = await container.github(repo.githubTokenId);
```

`server/src/modules/pulls/routes.ts:36` (inside the existing try/catch that keeps reads working offline):

```ts
      gh = await container.github(repo.githubTokenId);
```

`server/src/modules/pulls/routes.ts:204`:

```ts
      const gh = await container.github(repo.githubTokenId);
```

`server/src/modules/pulls/routes.ts:302` and `:325`: apply the same change, using whatever `repo` variable is in scope at each site. If a site has a `pr` but no `repo`, load the repo first with the existing pattern:

```ts
    const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');
```

- [ ] **Step 5: Typecheck to find any missed call site**

```bash
cd server && pnpm typecheck
```

Expected: clean. Any `Expected 1 arguments, but got 0` is a call site still to convert — that is the point of the required argument.

- [ ] **Step 6: Run the new test and the full suite**

```bash
cd server && pnpm test test/container-github-cache.test.ts && pnpm test
```

Expected: the new file passes; the existing suite stays green because `overrides.github` still short-circuits.

- [ ] **Step 7: Commit**

```bash
git add server/src/platform/container.ts server/src/modules/pulls/routes.ts server/src/modules/polling/routes.ts server/test/container-github-cache.test.ts
git commit -m "feat(server): resolve a GitHub client per token id

Required argument with no default, so a missed call site is a type
error rather than a silent fallback to a global token."
```

---

### Task 6: Delete the env token path

**Files:**
- Modify: `server/src/adapters/secrets/local.ts:10-11,40` (drop the `GITHUB_TOKEN`/`GITHUB_PAT` special case)
- Delete from: `server/src/modules/repos/constants.ts:12` (`GITHUB_TOKEN_SECRET`)
- Modify: `server/src/modules/settings/constants.ts` (drop `github` from `SECRET_KEY_BY_PROVIDER`, keep `GITHUB_PROVIDER`)
- Modify: `server/src/modules/settings/routes.ts:74-96` (reject `provider: 'github'`)
- Modify: `server/.env.example:11-13`, `scripts/dev.sh:44`
- Modify: `server/README.md:28-29,96,103`, `README.md:114`, `server/CLAUDE.md:46`
- Create: `server/test/no-env-github-token.test.ts`

**Interfaces:**
- Consumes: `MissingTokenError` (Task 4)
- Produces: nothing new; `POST /settings/test-connection` with `provider: 'github'` now answers 422

- [ ] **Step 1: Write the failing test**

Create `server/test/no-env-github-token.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LocalSecretsProvider } from '../src/adapters/secrets/local.js';
import { SECRET_KEY_BY_PROVIDER } from '../src/modules/settings/constants.js';

describe('the env GitHub token is gone', () => {
  it('LocalSecretsProvider does not special-case GITHUB_TOKEN or GITHUB_PAT', async () => {
    const p = new LocalSecretsProvider('/nonexistent/secrets.json', {
      GITHUB_PAT: 'ghp_pat',
    } as NodeJS.ProcessEnv);
    // GITHUB_PAT must no longer stand in for GITHUB_TOKEN.
    await expect(p.get('GITHUB_TOKEN')).resolves.toBeUndefined();
  });

  it('no connection-test provider maps to the bare GITHUB_TOKEN key', () => {
    expect(Object.values(SECRET_KEY_BY_PROVIDER)).not.toContain('GITHUB_TOKEN');
    expect('github' in SECRET_KEY_BY_PROVIDER).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && pnpm test test/no-env-github-token.test.ts
```

Expected: FAIL on both assertions.

- [ ] **Step 3: Strip the secrets adapter**

In `server/src/adapters/secrets/local.ts`, delete line 40 entirely:

```ts
    if (key === 'GITHUB_TOKEN') return this.env.GITHUB_TOKEN ?? this.env.GITHUB_PAT;
```

Update the class docblock (lines 10-11), replacing the `GITHUB_TOKEN is the canonical key…` sentence with:

```
 * GitHub PATs are stored per token id under `GITHUB_TOKEN:<id>`; there is no
 * bare GITHUB_TOKEN and no env fallback for them.
```

- [ ] **Step 4: Strip the constants**

In `server/src/modules/settings/constants.ts`, remove the `github` entry and change the type so the map no longer claims to cover every provider:

```ts
/** Maps a connection-test provider to the SecretsProvider key it persists to.
    `github` is absent on purpose — GitHub PATs are per-repo tokens managed by
    the github-tokens module, not a single global secret. */
export const SECRET_KEY_BY_PROVIDER: Partial<Record<ConnTestProvider, SecretKey>> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};
```

In `server/src/modules/repos/constants.ts`, delete the `GITHUB_TOKEN_SECRET` export (line 12) and remove it from the `repos/service.ts` import list (Task 8 rewrites its only use).

- [ ] **Step 5: Reject `provider: 'github'` in test-connection**

In `server/src/modules/settings/routes.ts`, inside the handler, replace the GitHub branch. The `github` member stays in the shared `ConnTestProvider` enum — the route rejects it, so no contract is edited:

```ts
    const { provider, key } = req.body;
    if (provider === GITHUB_PROVIDER) {
      throw new ValidationError('Use POST /github-tokens/test to validate a GitHub token');
    }
    try {
      const secretKey = SECRET_KEY_BY_PROVIDER[provider];
      if (!secretKey) return { provider, ok: false, message: 'Unsupported provider' };
      if (key) {
        if (!container.secrets.set) {
          return { provider, ok: false, message: 'Secrets backend is read-only' };
        }
        await container.secrets.set(secretKey, key);
        container.invalidateSecretCaches();
      }
      const llm = await container.llm(provider);
      const models = await llm.listModels();
      return { provider, ok: true, message: `OK — ${models.length} models available` };
    } catch (err) {
      return { provider, ok: false, message: (err as Error).message };
    }
```

Ensure `ValidationError` is imported from `../../platform/errors.js` and drop the now-unused `GitHubClient`-related imports the old branch needed.

- [ ] **Step 6: Update config and docs**

- `server/.env.example`: delete the `GITHUB_TOKEN=` line and its comment block (lines ~11-13).
- `scripts/dev.sh:44`: change the warning to `add your API keys (OPENAI/ANTHROPIC) in server/.env — GitHub tokens are added in the app under Settings → GitHub Tokens`.
- `server/README.md`: drop the `GITHUB_TOKEN` row from the env table (line ~96) and rewrite lines 28-29 and 103 to say GitHub PATs are per-repo tokens stored under `GITHUB_TOKEN:<id>` via the UI.
- `README.md:114`: drop the parenthetical about `GITHUB_TOKEN` in the env.
- `server/CLAUDE.md:46`: replace the `GITHUB_TOKEN is canonical; GITHUB_PAT accepted as fallback` gotcha with `GitHub PATs are per-repo: repos.github_token_id → secrets key GITHUB_TOKEN:<id>. There is NO global GITHUB_TOKEN and no env fallback — a value in server/.env is ignored`.

Do **not** touch `client/messages/en/ci.json:93`.

- [ ] **Step 7: Verify**

```bash
cd server && pnpm test test/no-env-github-token.test.ts && pnpm typecheck && pnpm test
```

Expected: the new test passes, typecheck clean, suite green. If an existing test asserted the `GITHUB_PAT` fallback, update it to assert the new behavior — do not restore the fallback.

- [ ] **Step 8: Confirm nothing still reads the env token**

```bash
cd /Users/anton/repos/dev-digest && grep -rn "GITHUB_TOKEN\|GITHUB_PAT" --include='*.ts' server/src client/src | grep -v vendor/shared | grep -v "GITHUB_TOKEN:"
```

Expected: no hits.

- [ ] **Step 9: Commit**

```bash
git add -u && git commit -m "refactor(server)!: remove the global env GitHub token

A single GITHUB_TOKEN cannot express per-repo access, and keeping it as
a fallback required an adoption step whose guards existed only to stop
it silently reattaching deleted credentials. Values in server/.env are
now ignored; tokens are managed in the UI."
```

---

### Task 7: github-tokens module (repository, service, routes)

**Files:**
- Create: `server/src/modules/github-tokens/repository.ts`
- Create: `server/src/modules/github-tokens/service.ts`
- Create: `server/src/modules/github-tokens/routes.ts`
- Modify: `server/src/modules/index.ts` (one import + one entry)
- Create: `server/test/github-tokens-routes.it.test.ts`

**Interfaces:**
- Consumes: `tokenSecretKey` (Task 4), `githubTokens` table (Task 2), contracts (Task 3), `OctokitGitHubClient`, `MockGitHubClient`
- Produces:
  - `GitHubTokenRepository`: `list(workspaceId)` → rows with `repoCount`; `getById(workspaceId, id)`; `insert({workspaceId, label})`; `updateMeta(id, {label?, githubLogin?, lastValidatedAt?})`; `remove(workspaceId, id)` → `{deleted: boolean, orphanedRepos: number}`
  - `GitHubTokenService`: `list(workspaceId)`; `create(workspaceId, input)`; `patch(workspaceId, id, input)`; `remove(workspaceId, id)`; `test(input)`; `probeAccess(token, fullName)`
  - Routes: `GET/POST /github-tokens`, `PATCH/DELETE /github-tokens/:id`, `POST /github-tokens/test`

- [ ] **Step 1: Write the failing route test**

Create `server/test/github-tokens-routes.it.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import type { FastifyInstance } from 'fastify';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('github-tokens routes', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  const stored: Record<string, string> = {};

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.db);
    app = await buildApp({
      config: { ...loadConfig(), databaseUrl: pg.url },
      overrides: {
        github: new MockGitHubClient(),
        secrets: {
          async get(k: string) {
            return stored[k];
          },
          async set(k: string, v: string) {
            stored[k] = v;
          },
        },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('creates a token, stores the value out of band, and never returns it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/github-tokens',
      payload: { label: 'work', token: 'ghp_work' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.label).toBe('work');
    expect(body.configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain('ghp_work');
    expect(stored[`GITHUB_TOKEN:${body.id}`]).toBe('ghp_work');
  });

  it('rejects a duplicate label with 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/github-tokens',
      payload: { label: 'work', token: 'ghp_other' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('lists tokens with repo_count', async () => {
    const res = await app.inject({ method: 'GET', url: '/github-tokens' });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].repo_count).toBe(0);
    expect(rows[0].github_login).toBeTruthy();
  });

  it('replacing the value tombstones nothing and overwrites the secret', async () => {
    const [row] = (await app.inject({ method: 'GET', url: '/github-tokens' })).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/github-tokens/${row.id}`,
      payload: { label: 'work-renamed', token: 'ghp_rotated' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().label).toBe('work-renamed');
    expect(stored[`GITHUB_TOKEN:${row.id}`]).toBe('ghp_rotated');
  });

  it('deleting reports how many repos were orphaned and tombstones the value', async () => {
    const [row] = (await app.inject({ method: 'GET', url: '/github-tokens' })).json();
    const res = await app.inject({ method: 'DELETE', url: `/github-tokens/${row.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ deleted: row.id, orphaned_repos: 0 });
    expect(stored[`GITHUB_TOKEN:${row.id}`]).toBe('');
  });

  it('test endpoint validates without persisting anything', async () => {
    const before = Object.keys(stored).length;
    const res = await app.inject({
      method: 'POST',
      url: '/github-tokens/test',
      payload: { token: 'ghp_probe' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(Object.keys(stored)).toHaveLength(before);
  });
});
```

Match `buildApp`'s real signature and the `ContainerOverrides` shape before running — read `server/src/app.ts` and `test/integration.it.test.ts` and copy their exact call form.

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && pnpm test test/github-tokens-routes.it.test.ts
```

Expected: FAIL — 404 on every route.

- [ ] **Step 3: Write the repository**

Create `server/src/modules/github-tokens/repository.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type GitHubTokenRow = typeof t.githubTokens.$inferSelect;
export type GitHubTokenRowWithCount = GitHubTokenRow & { repoCount: number };

/** The ONLY place that touches `github_tokens`. Every query scopes by workspace. */
export class GitHubTokenRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<GitHubTokenRowWithCount[]> {
    const rows = await this.db
      .select({
        id: t.githubTokens.id,
        workspaceId: t.githubTokens.workspaceId,
        label: t.githubTokens.label,
        githubLogin: t.githubTokens.githubLogin,
        createdAt: t.githubTokens.createdAt,
        lastValidatedAt: t.githubTokens.lastValidatedAt,
        repoCount: sql<number>`(
          SELECT count(*)::int FROM ${t.repos}
          WHERE ${t.repos.githubTokenId} = ${t.githubTokens.id}
        )`,
      })
      .from(t.githubTokens)
      .where(eq(t.githubTokens.workspaceId, workspaceId))
      .orderBy(t.githubTokens.createdAt);
    return rows as GitHubTokenRowWithCount[];
  }

  async getById(workspaceId: string, id: string): Promise<GitHubTokenRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.githubTokens)
      .where(and(eq(t.githubTokens.workspaceId, workspaceId), eq(t.githubTokens.id, id)));
    return row;
  }

  async findByLabel(workspaceId: string, label: string): Promise<GitHubTokenRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.githubTokens)
      .where(and(eq(t.githubTokens.workspaceId, workspaceId), eq(t.githubTokens.label, label)));
    return row;
  }

  async insert(values: { workspaceId: string; label: string }): Promise<GitHubTokenRow> {
    const [row] = await this.db.insert(t.githubTokens).values(values).returning();
    return row!;
  }

  async updateMeta(
    id: string,
    values: { label?: string; githubLogin?: string | null; lastValidatedAt?: Date },
  ): Promise<GitHubTokenRow | undefined> {
    const [row] = await this.db
      .update(t.githubTokens)
      .set(values)
      .where(eq(t.githubTokens.id, id))
      .returning();
    return row;
  }

  /** Count the repos about to be orphaned, then delete (FK nulls them). */
  async remove(workspaceId: string, id: string): Promise<{ deleted: boolean; orphaned: number }> {
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(t.repos)
      .where(eq(t.repos.githubTokenId, id));
    const gone = await this.db
      .delete(t.githubTokens)
      .where(and(eq(t.githubTokens.workspaceId, workspaceId), eq(t.githubTokens.id, id)))
      .returning({ id: t.githubTokens.id });
    return { deleted: gone.length > 0, orphaned: count ?? 0 };
  }
}
```

- [ ] **Step 4: Write the service**

Create `server/src/modules/github-tokens/service.ts`:

```ts
import type {
  GitHubToken,
  GitHubTokenInput,
  GitHubTokenPatch,
  GitHubTokenTestInput,
  GitHubTokenTestResult,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { GitHubTokenRepository, type GitHubTokenRowWithCount } from './repository.js';
import { tokenSecretKey } from './resolver.js';

export class GitHubTokenService {
  private repo: GitHubTokenRepository;

  constructor(private container: Container) {
    this.repo = new GitHubTokenRepository(container.db);
  }

  /** A client for a RAW token value — used only to validate before persisting. */
  private clientFor(token: string) {
    return this.container.overrides.github ?? new OctokitGitHubClient(token);
  }

  private async toDto(row: GitHubTokenRowWithCount): Promise<GitHubToken> {
    const value = await this.container.secrets.get(tokenSecretKey(row.id));
    return {
      id: row.id,
      workspace_id: row.workspaceId,
      label: row.label,
      github_login: row.githubLogin ?? null,
      configured: !!value,
      repo_count: row.repoCount,
      created_at: row.createdAt.toISOString(),
      last_validated_at: row.lastValidatedAt?.toISOString() ?? null,
    };
  }

  async list(workspaceId: string): Promise<GitHubToken[]> {
    const rows = await this.repo.list(workspaceId);
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  /**
   * Validate FIRST, persist second: a rejected PAT must leave no row and no
   * secret behind. If writing the secret fails after the row exists, the row
   * is removed so a token can never be listed as configured without a value.
   */
  async create(workspaceId: string, input: GitHubTokenInput): Promise<GitHubToken> {
    if (!this.container.secrets.set) {
      throw new ValidationError('Secrets backend is read-only');
    }
    if (await this.repo.findByLabel(workspaceId, input.label)) {
      throw new ValidationError(`A token labelled "${input.label}" already exists`);
    }
    const login = await this.validate(input.token);

    const row = await this.repo.insert({ workspaceId, label: input.label });
    try {
      await this.container.secrets.set(tokenSecretKey(row.id), input.token);
    } catch (err) {
      await this.repo.remove(workspaceId, row.id);
      throw err;
    }
    const updated = await this.repo.updateMeta(row.id, {
      githubLogin: login,
      lastValidatedAt: new Date(),
    });
    this.container.invalidateSecretCaches();
    return this.toDto({ ...(updated ?? row), repoCount: 0 });
  }

  async patch(workspaceId: string, id: string, input: GitHubTokenPatch): Promise<GitHubToken> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) throw new NotFoundError('Token not found');
    if (input.label && input.label !== existing.label) {
      const clash = await this.repo.findByLabel(workspaceId, input.label);
      if (clash) throw new ValidationError(`A token labelled "${input.label}" already exists`);
    }

    let login = existing.githubLogin;
    if (input.token) {
      if (!this.container.secrets.set) throw new ValidationError('Secrets backend is read-only');
      login = await this.validate(input.token);
      await this.container.secrets.set(tokenSecretKey(id), input.token);
    }
    await this.repo.updateMeta(id, {
      ...(input.label ? { label: input.label } : {}),
      githubLogin: login,
      ...(input.token ? { lastValidatedAt: new Date() } : {}),
    });
    this.container.invalidateSecretCaches();
    const [fresh] = (await this.repo.list(workspaceId)).filter((r) => r.id === id);
    return this.toDto(fresh!);
  }

  /**
   * Deletion always succeeds. The FK nulls `repos.github_token_id`, leaving
   * those repos in the broken state — deliberately, so nothing silently
   * re-authenticates with a different token.
   *
   * SecretsProvider has no delete(), so the value is tombstoned with an empty
   * string, which `resolveGitHubToken` treats as absent.
   */
  async remove(workspaceId: string, id: string): Promise<{ deleted: string; orphaned: number }> {
    const { deleted, orphaned } = await this.repo.remove(workspaceId, id);
    if (!deleted) throw new NotFoundError('Token not found');
    if (this.container.secrets.set) await this.container.secrets.set(tokenSecretKey(id), '');
    this.container.invalidateSecretCaches();
    return { deleted: id, orphaned };
  }

  /** Ephemeral validation — nothing is persisted. */
  async test(input: GitHubTokenTestInput): Promise<GitHubTokenTestResult> {
    try {
      const login = await this.validate(input.token);
      if (input.full_name) await this.probeAccess(input.token, input.full_name);
      return {
        ok: true,
        login,
        message: input.full_name
          ? `Connected as @${login} — can read ${input.full_name}`
          : `Connected as @${login}`,
      };
    } catch (err) {
      return { ok: false, login: null, message: (err as Error).message };
    }
  }

  /** GET /user — proves the PAT authenticates at all. */
  private async validate(token: string): Promise<string> {
    try {
      return await this.clientFor(token).currentLogin();
    } catch {
      throw new ValidationError('GitHub rejected that token');
    }
  }

  /**
   * Prove the token can READ a specific repo. GitHubClient has no getRepo, and
   * listPullRequests is the capability DevDigest actually needs — a repo the
   * token cannot see 404s here.
   */
  async probeAccess(token: string, fullName: string): Promise<void> {
    const [owner, name] = fullName.split('/');
    if (!owner || !name) throw new ValidationError(`"${fullName}" is not owner/name`);
    try {
      await this.clientFor(token).listPullRequests({ owner, name });
    } catch {
      throw new ValidationError(`That token cannot read ${fullName}`);
    }
  }
}
```

Check the real import path of `OctokitGitHubClient` (`server/src/adapters/github/…`) and whether `container.overrides` is publicly readable; if it is private, add a narrow public getter rather than widening the whole field.

- [ ] **Step 5: Write the routes**

Create `server/src/modules/github-tokens/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { GitHubTokenInput, GitHubTokenPatch, GitHubTokenTestInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { GitHubTokenService } from './service.js';

/**
 * GitHub tokens — the user's labelled PATs. Token VALUES never appear in a
 * response; `configured` reports whether one resolves.
 *   GET    /github-tokens       → list with repo_count
 *   POST   /github-tokens       → validate then store
 *   PATCH  /github-tokens/:id   → rename and/or replace the value
 *   DELETE /github-tokens/:id   → delete; affected repos go to the broken state
 *   POST   /github-tokens/test  → ephemeral validation, nothing persisted
 */
export default async function githubTokensRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new GitHubTokenService(app.container);

  app.get('/github-tokens', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/github-tokens', { schema: { body: GitHubTokenInput } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const token = await service.create(workspaceId, req.body);
    reply.status(201);
    return token;
  });

  app.patch(
    '/github-tokens/:id',
    { schema: { params: IdParams, body: GitHubTokenPatch } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.patch(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/github-tokens/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const { deleted, orphaned } = await service.remove(workspaceId, req.params.id);
    return { deleted, orphaned_repos: orphaned };
  });

  app.post(
    '/github-tokens/test',
    { schema: { body: GitHubTokenTestInput }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => service.test(req.body),
  );
}
```

- [ ] **Step 6: Register the module**

In `server/src/modules/index.ts` add the import next to the others and `githubTokens,` to the exported object:

```ts
import githubTokens from './github-tokens/routes.js';
```

- [ ] **Step 7: Run the tests**

```bash
cd server && pnpm test test/github-tokens-routes.it.test.ts && pnpm typecheck
```

Expected: PASS (6 tests), clean typecheck.

- [ ] **Step 8: Commit**

```bash
git add server/src/modules/github-tokens server/src/modules/index.ts server/test/github-tokens-routes.it.test.ts
git commit -m "feat(server): github-tokens module

Validate before persisting so a rejected PAT leaves no row; delete
tombstones the secret with '' because SecretsProvider has no delete()."
```

---

### Task 8: Repos module — assign, join, clone

**Files:**
- Modify: `server/src/modules/repos/routes.ts:28-31` (body schema), add `PATCH /repos/:id/github-token`
- Modify: `server/src/modules/repos/service.ts:35-77` (`add`, `runCloneJob`)
- Modify: `server/src/modules/repos/repository.ts` (join for the label, `assignToken`, `insert` takes the id)
- Create: `server/test/repos-github-token.it.test.ts`

**Interfaces:**
- Consumes: `RepoCreate`, `AssignRepoTokenInput`, `RepoWithToken` (Task 3); `resolveGitHubToken` (Task 4); `GitHubTokenService.probeAccess` (Task 7)
- Produces: `RepoRepository.listWithToken(workspaceId)`, `RepoRepository.assignToken(workspaceId, repoId, githubTokenId)`, `CloneJobPayload.githubTokenId`

- [ ] **Step 1: Write the failing test**

Create `server/test/repos-github-token.it.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import type { FastifyInstance } from 'fastify';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('repos ↔ github token', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  const stored: Record<string, string> = {};

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.db);
    app = await buildApp({
      config: { ...loadConfig(), databaseUrl: pg.url },
      overrides: {
        github: new MockGitHubClient(),
        git: new MockGitClient(),
        secrets: {
          async get(k: string) {
            return stored[k];
          },
          async set(k: string, v: string) {
            stored[k] = v;
          },
        },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const newToken = async (label: string) =>
    (
      await app.inject({ method: 'POST', url: '/github-tokens', payload: { label, token: `ghp_${label}` } })
    ).json();

  it('POST /repos without github_token_id creates a repo in the broken state', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/no-token' },
    });
    expect([200, 201]).toContain(res.statusCode);
    expect(res.json().github_token_id ?? null).toBeNull();
  });

  it('POST /repos with a token id stores it', async () => {
    const token = await newToken('work');
    const res = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/api', github_token_id: token.id },
    });
    expect([200, 201]).toContain(res.statusCode);
    expect(res.json().github_token_id).toBe(token.id);
  });

  it('GET /repos returns the token label alongside the id', async () => {
    const rows = (await app.inject({ method: 'GET', url: '/repos' })).json();
    const api = rows.find((r: { full_name: string }) => r.full_name === 'acme/api');
    expect(api.github_token_label).toBe('work');
    const none = rows.find((r: { full_name: string }) => r.full_name === 'acme/no-token');
    expect(none.github_token_label).toBeNull();
  });

  it('PATCH /repos/:id/github-token reassigns, and null clears', async () => {
    const other = await newToken('personal');
    const rows = (await app.inject({ method: 'GET', url: '/repos' })).json();
    const api = rows.find((r: { full_name: string }) => r.full_name === 'acme/api');

    const assigned = await app.inject({
      method: 'PATCH',
      url: `/repos/${api.id}/github-token`,
      payload: { github_token_id: other.id },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().github_token_id).toBe(other.id);

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/repos/${api.id}/github-token`,
      payload: { github_token_id: null },
    });
    expect(cleared.json().github_token_id).toBeNull();
  });

  it('POST /repos/:id/poll on a repo with no token answers 422 token_missing', async () => {
    const rows = (await app.inject({ method: 'GET', url: '/repos' })).json();
    const none = rows.find((r: { full_name: string }) => r.full_name === 'acme/no-token');
    const res = await app.inject({ method: 'POST', url: `/repos/${none.id}/poll` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('token_missing');
  });
});
```

Note: this suite injects `overrides.github`, so `container.github()` short-circuits and the poll route reaches GitHub successfully for repos **with** a token. The 422 case is produced by the route resolving `repo.githubTokenId === null` before the client is fetched — make sure the poll route checks the id (via `container.github(repo.githubTokenId)`) rather than assuming a client.

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && pnpm test test/repos-github-token.it.test.ts
```

Expected: FAIL — `github_token_id` is not accepted or returned.

- [ ] **Step 3: Extend the repository**

In `server/src/modules/repos/repository.ts`, add `githubTokenId` to `InsertRepo` and the insert values:

```ts
export interface InsertRepo {
  workspaceId: string;
  owner: string;
  name: string;
  fullName: string;
  createdBy: string;
  githubTokenId?: string | null;
}
```

In `insert()`, add to `.values({…})`:

```ts
        githubTokenId: values.githubTokenId ?? null,
```

Add two methods:

```ts
  /** Repos with their token's label resolved in one query (for the list + badge). */
  async listWithToken(
    workspaceId: string,
  ): Promise<(RepoRow & { githubTokenLabel: string | null })[]> {
    const rows = await this.db
      .select({
        repo: t.repos,
        githubTokenLabel: t.githubTokens.label,
      })
      .from(t.repos)
      .leftJoin(t.githubTokens, eq(t.repos.githubTokenId, t.githubTokens.id))
      .where(eq(t.repos.workspaceId, workspaceId));
    return rows.map((r) => ({ ...r.repo, githubTokenLabel: r.githubTokenLabel ?? null }));
  }

  /** Reassign (or clear with null) the token a repo authenticates with. */
  async assignToken(
    workspaceId: string,
    repoId: string,
    githubTokenId: string | null,
  ): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .update(t.repos)
      .set({ githubTokenId })
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)))
      .returning();
    return row;
  }
```

Add `leftJoin` usage requires no new import beyond the existing `and, eq`.

- [ ] **Step 4: Extend the service**

In `server/src/modules/repos/service.ts`, change `add` to accept and validate the token id, and teach the clone job to resolve per repo. Replace the `GITHUB_TOKEN_SECRET` import with:

```ts
import { resolveGitHubToken } from '../github-tokens/resolver.js';
import { GitHubTokenService } from '../github-tokens/service.js';
import { MissingTokenError, ValidationError } from '../../platform/errors.js';
```

In `add(workspaceId, userId, url, githubTokenId?)`, after parsing owner/name and before inserting:

```ts
    // Fail here, not in the clone job minutes later: a PAT can authenticate
    // fine and still 404 on a private repo it cannot see.
    if (githubTokenId) {
      const token = await resolveGitHubToken(this.container.secrets, githubTokenId);
      await new GitHubTokenService(this.container).probeAccess(token, `${owner}/${name}`);
    }
```

Pass `githubTokenId` into `this.repo.insert({…})`, and include it in the clone job payload enqueued for the new repo.

In `runCloneJob`, replace the token lookup:

```ts
  async runCloneJob(payload: CloneJobPayload): Promise<void> {
    const { repoId, owner, name, url, githubTokenId } = payload;
    // Anonymous clone stays supported (public repos work with no token); when
    // it fails, the job error names the missing token instead of leaking a raw
    // git auth error.
    let token: string | null = null;
    try {
      token = await resolveGitHubToken(this.container.secrets, githubTokenId ?? null);
    } catch (err) {
      if (!(err instanceof MissingTokenError)) throw err;
    }
    const cloneUrl = token ? withGitHubToken(url, token) : url;
    try {
      const { path } = await this.container.git.clone({ owner, name }, cloneUrl, {
        depth: CLONE_DEPTH,
      });
      await this.repo.updateClonePath(repoId, path);
    } catch (err) {
      if (!token) {
        throw new Error(
          `Clone of ${owner}/${name} failed and no GitHub token is assigned to this repository — assign one in repo settings. Underlying error: ${(err as Error).message}`,
        );
      }
      throw err;
    }
    // …existing indexer enqueue block unchanged…
  }
```

Add `githubTokenId?: string | null` to the `CloneJobPayload` type where it is declared.

- [ ] **Step 5: Update the routes**

In `server/src/modules/repos/routes.ts`, swap the body schema and add the assign route:

```ts
import { RepoCreate, AssignRepoTokenInput } from '@devdigest/shared';
```

```ts
  app.post('/repos', { schema: { body: RepoCreate } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const { repo, created } = await service.add(
      workspaceId,
      userId,
      req.body.url,
      req.body.github_token_id ?? null,
    );
    reply.status(created ? 201 : 200);
    return repo;
  });

  app.patch(
    '/repos/:id/github-token',
    { schema: { params: IdParams, body: AssignRepoTokenInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.assignToken(workspaceId, req.params.id, req.body.github_token_id);
    },
  );
```

Change `GET /repos` to return the joined rows (`service.list` → `repository.listWithToken`), mapping `githubTokenLabel` to `github_token_label` in whatever serialization shape the existing list uses. Add `assignToken` to `RepoService`, throwing `NotFoundError` when the repo is not in the workspace.

- [ ] **Step 6: Run the tests**

```bash
cd server && pnpm test test/repos-github-token.it.test.ts && pnpm typecheck && pnpm test
```

Expected: new file passes (5 tests), typecheck clean, whole suite green.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/repos server/test/repos-github-token.it.test.ts
git commit -m "feat(server): pick a token when adding a repo, reassign it later

Access is probed with listPullRequests at add time so a token that
cannot read the repo fails immediately instead of in the clone job."
```

---

### Task 9: Client data layer

**Files:**
- Modify: `client/src/lib/hooks/core.ts` (`useAddRepo` signature; new token hooks)
- Modify: `client/src/lib/types.ts` (re-export the new contract types if that is the existing pattern — check first)
- Create: `client/src/lib/hooks/github-tokens.ts`
- Modify: `client/src/lib/hooks/index.ts` (export the new hooks)
- Create: `client/src/lib/hooks/github-tokens.test.ts`

**Interfaces:**
- Consumes: `GitHubToken`, `GitHubTokenInput`, `RepoWithToken` (Task 3); `api` from `../api`
- Produces: `useGitHubTokens()`, `useCreateGitHubToken()`, `usePatchGitHubToken()`, `useDeleteGitHubToken()`, `useTestGitHubToken()`, `useAssignRepoToken()`; `useAddRepo()` now takes `{url, githubTokenId}`

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/hooks/github-tokens.test.ts`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useGitHubTokens, useAssignRepoToken } from "./github-tokens";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("github token hooks", () => {
  it("useGitHubTokens fetches the list", async () => {
    const rows = [{ id: "t1", label: "work", github_login: "octocat", configured: true, repo_count: 1 }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })),
    );
    const { result } = renderHook(() => useGitHubTokens(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0]!.label).toBe("work");
  });

  it("useAssignRepoToken PATCHes the repo token route", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "r1", github_token_id: "t2" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAssignRepoToken(), { wrapper });
    await result.current.mutateAsync({ repoId: "r1", githubTokenId: "t2" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/repos/r1/github-token");
    expect(init!.method).toBe("PATCH");
    expect(JSON.parse(String(init!.body))).toEqual({ github_token_id: "t2" });
  });
});
```

Match the fetch-mocking style already used in the client's existing tests (`src/test/smoke.test.tsx`, `AgentCard.test.tsx`) — copy their setup rather than inventing one.

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd client && pnpm test src/lib/hooks/github-tokens.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the hooks**

Create `client/src/lib/hooks/github-tokens.ts`:

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GitHubToken,
  GitHubTokenInput,
  GitHubTokenPatch,
  GitHubTokenTestResult,
} from "@devdigest/shared";
import { api } from "../api";

const KEY = ["github-tokens"];

export function useGitHubTokens() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<GitHubToken[]>("/github-tokens") });
}

export function useCreateGitHubToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GitHubTokenInput) => api.post<GitHubToken>("/github-tokens", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function usePatchGitHubToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: GitHubTokenPatch & { id: string }) =>
      api.patch<GitHubToken>(`/github-tokens/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteGitHubToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.del<{ deleted: string; orphaned_repos: number }>(`/github-tokens/${id}`),
    onSuccess: () => {
      // Repos may have just lost their token — the badge depends on this.
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useTestGitHubToken() {
  return useMutation({
    mutationFn: (input: { token: string; full_name?: string }) =>
      api.post<GitHubTokenTestResult>("/github-tokens/test", input),
  });
}

export function useAssignRepoToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, githubTokenId }: { repoId: string; githubTokenId: string | null }) =>
      api.patch(`/repos/${repoId}/github-token`, { github_token_id: githubTokenId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repos"] });
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
```

- [ ] **Step 4: Update `useAddRepo`**

In `client/src/lib/hooks/core.ts`, change `useAddRepo` to take an object so the token rides along:

```ts
export function useAddRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; githubTokenId?: string | null }) =>
      api.post<RepoWithToken>("/repos", {
        url: input.url,
        ...(input.githubTokenId ? { github_token_id: input.githubTokenId } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}
```

Export the new hooks from `client/src/lib/hooks/index.ts`, and fix the one existing caller (`AddRepoView`) in Task 11.

- [ ] **Step 5: Run the tests**

```bash
cd client && pnpm test src/lib/hooks/github-tokens.test.ts && pnpm typecheck
```

Expected: PASS (2 tests); typecheck fails only at `AddRepoView`'s old call, which Task 11 fixes. If you prefer a green typecheck at every commit, do Step 4 of Task 11 now.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib
git commit -m "feat(client): github token query hooks"
```

---

### Task 10: `GitHubTokenPicker`

**Files:**
- Create: `client/src/components/github-token-picker/GitHubTokenPicker.tsx`
- Create: `client/src/components/github-token-picker/index.ts`
- Create: `client/src/components/github-token-picker/GitHubTokenPicker.test.tsx`
- Create: `client/messages/en/github-tokens.json`
- Modify: whatever aggregates `messages/en/*.json` (check `client/src/i18n` or the messages loader and follow its pattern)

**Interfaces:**
- Consumes: `useGitHubTokens`, `useCreateGitHubToken`, `useTestGitHubToken` (Task 9)
- Produces: `<GitHubTokenPicker value={string | null} onChange={(id: string | null) => void} fullName?: string />` — dropdown of tokens plus inline create; used by both `AddRepoView` and `RepoSettingsView`

- [ ] **Step 1: Write the failing component test**

Create `client/src/components/github-token-picker/GitHubTokenPicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { GitHubTokenPicker } from "./GitHubTokenPicker";

const tokens = [
  { id: "t1", workspace_id: "w", label: "work", github_login: "octocat", configured: true, repo_count: 1, created_at: "", last_validated_at: null },
  { id: "t2", workspace_id: "w", label: "personal", github_login: "anton", configured: true, repo_count: 0, created_at: "", last_validated_at: null },
];

function renderPicker(props: Partial<React.ComponentProps<typeof GitHubTokenPicker>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GitHubTokenPicker value={null} onChange={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(tokens), { status: 200 })),
  );
});

describe("GitHubTokenPicker", () => {
  it("lists the saved tokens and reports the chosen one", async () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    await userEvent.click(await screen.findByRole("button"));
    await userEvent.click(await screen.findByText("personal"));
    expect(onChange).toHaveBeenCalledWith("t2");
  });

  it("shows the selected token's label", async () => {
    renderPicker({ value: "t1" });
    await waitFor(() => expect(screen.getByText("work")).toBeInTheDocument());
  });

  it("reveals the inline create form and posts a new token", async () => {
    renderPicker();
    await userEvent.click(await screen.findByRole("button"));
    await userEvent.click(await screen.findByText(/new token/i));
    expect(await screen.findByPlaceholderText(/label/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ghp_/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd client && pnpm test src/components/github-token-picker
```

Expected: FAIL — module not found.

- [ ] **Step 3: Add the i18n messages**

Create `client/messages/en/github-tokens.json`:

```json
{
  "picker": {
    "none": "No token",
    "placeholder": "Choose a token",
    "newToken": "+ New token…",
    "labelPlaceholder": "Label (e.g. work)",
    "tokenPlaceholder": "ghp_… or github_pat_…",
    "test": "Test",
    "testing": "Testing…",
    "save": "Save token",
    "saving": "Saving…",
    "cancel": "Cancel"
  },
  "settings": {
    "title": "GitHub Tokens",
    "body": "Personal access tokens DevDigest uses to read your repositories. Each repository picks one.",
    "repoCount": "{count, plural, =0 {no repos} one {# repo} other {# repos}}",
    "rename": "Rename",
    "replace": "Replace value",
    "delete": "Delete",
    "deleteOrphanWarning": "{count, plural, one {# repository} other {# repositories}} will be left without a token and stop syncing until you assign one.",
    "notConfigured": "No value stored"
  },
  "repo": {
    "sectionTitle": "GitHub access",
    "sectionBody": "Which token DevDigest uses for this repository.",
    "brokenTitle": "No token assigned",
    "brokenBody": "This repository cannot reach GitHub. Existing pull requests stay readable; syncing and cloning fail until you pick a token.",
    "testAccess": "Test access to this repo",
    "badge": "no token"
  }
}
```

Register the namespace the same way the existing `messages/en/*.json` files are registered — read the i18n request config (`client/src/i18n/*` or `next-intl` setup) and add `github-tokens` alongside `settings` and `ci`.

- [ ] **Step 4: Write the component**

Create `client/src/components/github-token-picker/GitHubTokenPicker.tsx`:

```tsx
/* GitHubTokenPicker — choose which saved PAT a repo authenticates with, with
   inline creation so first-run never has to detour through Settings. Used by
   AddRepoView and RepoSettingsView; the two must not diverge. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown, FormField, Icon, TextInput, type DropdownItemDef } from "@devdigest/ui";
import { useCreateGitHubToken, useGitHubTokens, useTestGitHubToken } from "@/lib/hooks";
import { ApiError } from "@/lib/api";

export function GitHubTokenPicker({
  value,
  onChange,
  fullName,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  /** `owner/name` — when present, Test also proves access to that repo. */
  fullName?: string;
}) {
  const t = useTranslations("github-tokens");
  const { data: tokens } = useGitHubTokens();
  const create = useCreateGitHubToken();
  const test = useTestGitHubToken();

  const [creating, setCreating] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [token, setToken] = React.useState("");
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  const selected = tokens?.find((tk) => tk.id === value) ?? null;

  const items: DropdownItemDef[] = [
    ...(tokens ?? []).map((tk) => ({
      label: tk.label,
      icon: "Key" as const,
      onClick: () => onChange(tk.id),
    })),
    ...(tokens && tokens.length ? [{ divider: true }] : []),
    {
      label: t("picker.newToken"),
      icon: "Plus" as const,
      muted: true,
      onClick: () => {
        setResult(null);
        setCreating(true);
      },
    },
  ];

  const runTest = async () => {
    setResult(null);
    try {
      const r = await test.mutateAsync({
        token: token.trim(),
        ...(fullName ? { full_name: fullName } : {}),
      });
      setResult({ ok: r.ok, message: r.message });
    } catch (e) {
      setResult({ ok: false, message: e instanceof ApiError ? e.message : "Test failed" });
    }
  };

  const save = async () => {
    setResult(null);
    try {
      const created = await create.mutateAsync({ label: label.trim(), token: token.trim() });
      onChange(created.id);
      setCreating(false);
      setLabel("");
      setToken("");
    } catch (e) {
      setResult({ ok: false, message: e instanceof ApiError ? e.message : "Could not save token" });
    }
  };

  return (
    <div>
      <Dropdown
        align="left"
        width={240}
        items={items}
        trigger={
          <Button kind="secondary" size="md">
            {selected ? selected.label : t("picker.placeholder")}
            <Icon.ChevronsUpDown size={13} />
          </Button>
        }
      />

      {creating && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <TextInput value={label} onChange={setLabel} placeholder={t("picker.labelPlaceholder")} />
          <TextInput
            value={token}
            onChange={setToken}
            mono
            type="password"
            placeholder={t("picker.tokenPlaceholder")}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              kind="secondary"
              size="md"
              onClick={runTest}
              disabled={!token.trim() || test.isPending}
            >
              {test.isPending ? t("picker.testing") : t("picker.test")}
            </Button>
            <Button
              kind="primary"
              size="md"
              onClick={save}
              disabled={!label.trim() || !token.trim() || create.isPending}
            >
              {create.isPending ? t("picker.saving") : t("picker.save")}
            </Button>
            <Button kind="ghost" size="md" onClick={() => setCreating(false)}>
              {t("picker.cancel")}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: result.ok ? "var(--success)" : "var(--danger)",
          }}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}
```

Create `client/src/components/github-token-picker/index.ts`:

```ts
export { GitHubTokenPicker } from "./GitHubTokenPicker";
```

Confirm `Icon.Key` and the `Button` `kind`/`size` values exist in `client/src/vendor/ui`; substitute the closest existing icon and variants rather than adding any to the vendored kit.

- [ ] **Step 5: Run the tests**

```bash
cd client && pnpm test src/components/github-token-picker
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/github-token-picker client/messages/en/github-tokens.json client/src
git commit -m "feat(client): GitHubTokenPicker with inline token creation

One component for both add-repo and repo settings so the inline create
flow exists once."
```

---

### Task 11: Settings section, repo settings page, badge, nav

**Files:**
- Modify: `client/src/vendor/ui/nav.ts` (`SETTINGS_SECTIONS` entry + `NAV` item + `SHORTCUTS` line) — **the only vendored file this plan touches**
- Create: `client/src/app/settings/[section]/_components/SettingsView/_components/SettingsGitHubTokens/SettingsGitHubTokens.tsx` (+ `index.ts`, `styles.ts` following the sibling `SettingsApiKeys` layout)
- Modify: `client/src/app/settings/[section]/_components/SettingsView/SettingsView.tsx` (render the new section)
- Modify: `.../SettingsApiKeys/constants.ts` (drop the `github` row)
- Create: `client/src/app/repos/[repoId]/settings/page.tsx`
- Create: `client/src/app/repos/[repoId]/settings/_components/RepoSettingsView/RepoSettingsView.tsx` (+ `index.ts`)
- Create: `client/src/app/repos/[repoId]/settings/_components/RepoSettingsView/RepoSettingsView.test.tsx`
- Modify: `client/src/app/repos/[repoId]/pulls/page.tsx` (broken badge chip)
- Modify: `client/src/app/onboarding/_components/AddRepoView/AddRepoView.tsx` (picker + new `useAddRepo` signature)

**Interfaces:**
- Consumes: `GitHubTokenPicker` (Task 10), all hooks from Task 9
- Produces: route `/repos/[repoId]/settings`; settings section `github-tokens`

- [ ] **Step 1: Write the failing page test**

Create `RepoSettingsView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { RepoSettingsView } from "./RepoSettingsView";

const repos = [
  {
    id: "r1",
    workspace_id: "w",
    owner: "acme",
    name: "api",
    full_name: "acme/api",
    default_branch: "main",
    clone_path: null,
    last_polled_at: null,
    created_by: null,
    github_token_id: null,
    github_token_label: null,
  },
];

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RepoSettingsView repoId="r1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      new Response(JSON.stringify(String(url).includes("/github-tokens") ? [] : repos), {
        status: 200,
      }),
    ),
  );
});

describe("RepoSettingsView", () => {
  it("shows the repo identity", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("acme/api")).toBeInTheDocument());
  });

  it("warns when the repo has no token assigned", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText(/no token assigned/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd client && pnpm test src/app/repos
```

Expected: FAIL — module not found.

- [ ] **Step 3: Extend the vendored nav registry**

In `client/src/vendor/ui/nav.ts`:

Add to `NAV`'s WORKSPACE `items`, after the `pulls` entry:

```ts
      { key: "repo-settings", label: "Repository", icon: "Settings", href: "/repos/:repoId/settings", gKey: "r" },
```

Add to `SETTINGS_SECTIONS`:

```ts
  { key: "github-tokens", label: "GitHub Tokens" },
```

Add to `SHORTCUTS`, after the `g a` line:

```ts
  { keys: "g r", label: "Go to Repository settings", group: "Navigation" },
```

Confirm `"Settings"` is a valid `IconName` in `client/src/vendor/ui/icons` (the existing `SETTINGS_ITEM` uses it, so it is). Change nothing else in this file.

- [ ] **Step 4: Build the repo settings page**

Create `client/src/app/repos/[repoId]/settings/_components/RepoSettingsView/RepoSettingsView.tsx`:

```tsx
/* RepoSettingsView — per-repo settings. Today it exists to answer one
   question: which GitHub token does this repo authenticate with. Repo removal
   deliberately stays in the RepoSwitcher; two homes for a destructive action
   is how the wrong repo gets deleted. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Card, Icon } from "@devdigest/ui";
import { useRepos, useAssignRepoToken, useTestGitHubToken } from "@/lib/hooks";
import { GitHubTokenPicker } from "@/components/github-token-picker";

export function RepoSettingsView({ repoId }: { repoId: string }) {
  const t = useTranslations("github-tokens");
  const { data: repos } = useRepos();
  const assign = useAssignRepoToken();
  const test = useTestGitHubToken();
  const repo = repos?.find((r) => r.id === repoId) ?? null;
  const [probe, setProbe] = React.useState<{ ok: boolean; message: string } | null>(null);

  if (!repo) return null;

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 720 }}>
      <div>
        <h1 className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
          {repo.full_name}
        </h1>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          {repo.default_branch}
          {repo.clone_path ? ` · ${repo.clone_path}` : " · not cloned"}
          {repo.last_polled_at ? ` · synced ${repo.last_polled_at}` : " · never synced"}
        </div>
      </div>

      {!repo.github_token_id && (
        <Card>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Icon.AlertTriangle size={16} style={{ color: "var(--warning)", flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{t("repo.brokenTitle")}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("repo.brokenBody")}</div>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{t("repo.sectionTitle")}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
          {t("repo.sectionBody")}
        </div>

        <GitHubTokenPicker
          value={repo.github_token_id}
          fullName={repo.full_name}
          onChange={(githubTokenId) => {
            setProbe(null);
            assign.mutate({ repoId, githubTokenId });
          }}
        />

        {repo.github_token_id && (
          <div style={{ marginTop: 12 }}>
            <Button
              kind="secondary"
              size="md"
              disabled={test.isPending}
              onClick={async () => {
                // Proves this token can read THIS repo, not merely that it
                // authenticates — the distinction that costs a failed clone.
                const r = await test.mutateAsync({ token: "", full_name: repo.full_name });
                setProbe({ ok: r.ok, message: r.message });
              }}
            >
              {t("repo.testAccess")}
            </Button>
            {probe && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: probe.ok ? "var(--success)" : "var(--danger)",
                }}
              >
                {probe.message}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
```

The *Test access* button needs the stored value, which the client never sees. Add a server route to support it rather than sending a token from the browser: `POST /repos/:id/test-access` in `server/src/modules/repos/routes.ts`, which resolves the repo's assigned token server-side and calls `GitHubTokenService.probeAccess`, returning `GitHubTokenTestResult`. Add a `useTestRepoAccess()` hook in `client/src/lib/hooks/github-tokens.ts` calling it, and use that here instead of `useTestGitHubToken`. (Do not pass an empty token from the client — that is the placeholder this step exists to remove.)

Create `index.ts` exporting `RepoSettingsView`, and the page wrapper `client/src/app/repos/[repoId]/settings/page.tsx`:

```tsx
import { AppShell } from "@/components/app-shell";
import { RepoSettingsView } from "./_components/RepoSettingsView";

export default async function RepoSettingsPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return (
    <AppShell crumb={[{ label: "Repository" }]}>
      <RepoSettingsView repoId={repoId} />
    </AppShell>
  );
}
```

Match the existing `repos/[repoId]/pulls/page.tsx` for how `params` and `AppShell crumb` are handled — Next 15 async params must be awaited the same way.

- [ ] **Step 5: Build the Settings → GitHub Tokens section**

Create `SettingsGitHubTokens.tsx` following `SettingsApiKeys`'s structure (`SectionTitle` + rows + a `styles.ts`). Each row renders `label`, `@github_login`, `configured ? "" : t("settings.notConfigured")`, `repo_count`, and buttons wired to `usePatchGitHubToken` (rename / replace) and `useDeleteGitHubToken` (delete, showing `t("settings.deleteOrphanWarning", {count: repo_count})` before confirming). Add a create form reusing `GitHubTokenPicker`'s inline fields or a small local form — do not duplicate the validation logic; call `useCreateGitHubToken` directly.

Wire it in `SettingsView.tsx`:

```tsx
import { SettingsGitHubTokens } from "./_components/SettingsGitHubTokens";
import { SECTION_GITHUB_TOKENS } from "./constants";
```

```tsx
          ) : section === SECTION_GITHUB_TOKENS ? (
            <SettingsGitHubTokens />
```

Add `export const SECTION_GITHUB_TOKENS = "github-tokens";` to the `SettingsView/constants.ts`.

Remove the `github` entry from `SettingsApiKeys/constants.ts`'s `KEY_ROWS`, and drop its now-unused i18n keys from `client/messages/en/settings.json`.

- [ ] **Step 6: Add the broken badge to the PR header**

In `client/src/app/repos/[repoId]/pulls/page.tsx`, next to the existing `Auto-review` / `Refresh` controls, render for the active repo when `github_token_id` is null:

```tsx
import Link from "next/link";
```

```tsx
        {repo && !repo.github_token_id && (
          <Link href={`/repos/${repo.id}/settings`}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 9px",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--warning)",
                border: "1px solid var(--warning)",
              }}
            >
              <Icon.AlertTriangle size={12} />
              {t("repo.badge")}
            </span>
          </Link>
        )}
```

Use whatever variable already holds the active repo on that page; if the page does not have it, read it from `useRepos()` filtered by `repoId`.

- [ ] **Step 7: Update AddRepoView**

In `AddRepoView.tsx`, add token state, render the picker under the URL field, and fix the mutation call:

```tsx
  const [githubTokenId, setGithubTokenId] = React.useState<string | null>(null);
```

```tsx
      const repo = await addRepo.mutateAsync({ url: repoUrl.trim(), githubTokenId });
```

Add below the URL `FormField`:

```tsx
      <FormField label={t("tokenLabel")} hint={t("tokenHint")}>
        <GitHubTokenPicker value={githubTokenId} onChange={setGithubTokenId} />
      </FormField>
```

Add `tokenLabel` / `tokenHint` to the onboarding messages file, and update the file's header comment — it currently states GitHub PATs are *not* entered here, which this change reverses.

- [ ] **Step 8: Verify everything**

```bash
cd client && pnpm test && pnpm typecheck && pnpm build
```

Expected: all green, and the production build succeeds (it catches App Router mistakes tests miss).

- [ ] **Step 9: Commit**

```bash
git add client/src client/messages
git commit -m "feat(client): repo settings page, GitHub Tokens settings, broken badge

nav.ts gains one NAV item and one SETTINGS_SECTIONS entry — the single
vendored-UI change this feature needs."
```

---

### Task 12: e2e flow and end-to-end verification

**Files:**
- Create: `e2e/specs/github-tokens.<ext>` — match the existing spec file extension and structure in `e2e/specs/`
- Modify: `server/src/db/seed.ts` (seed one token row and point the demo repo at it)

**Interfaces:**
- Consumes: everything above
- Produces: a deterministic offline flow — badge appears on delete, clears on reassign

- [ ] **Step 1: Read an existing spec to copy its shape**

```bash
ls e2e/specs && sed -n '1,60p' e2e/specs/$(ls e2e/specs | head -1)
```

- [ ] **Step 2: Seed a token**

In `server/src/db/seed.ts`, insert one `githubTokens` row (`label: 'demo'`, `githubLogin: 'demo-user'`) and set the demo repo's `githubTokenId` to it. Insert **no** secret value — the seed must not fabricate a PAT, so the row lists as `configured: false`, which is honest and keeps the e2e flow offline.

- [ ] **Step 3: Write the e2e spec**

Following the structure from Step 1: navigate to the repo's settings page, assert the token label shows; go to Settings → GitHub Tokens, delete the `demo` token, confirm the orphan warning names 1 repository; return to the repo's pulls page and assert the `no token` badge; open repo settings, assign a token, assert the badge is gone. Do not add any step that requires a live GitHub call — `e2e/` has no network access to GitHub by design.

- [ ] **Step 4: Run the hermetic e2e**

```bash
./scripts/e2e.sh
```

Expected: the new flow passes along with the existing specs.

- [ ] **Step 5: Full verification sweep**

```bash
cd server && pnpm typecheck && pnpm test
cd ../client && pnpm typecheck && pnpm test && pnpm build
```

Expected: all green. Every command must be run and its output read — no claiming completion off a partial run.

- [ ] **Step 6: Run the real app and drive it**

Boot the stack and click the flow through in a browser: add a repo choosing a token, delete that token in Settings, see the badge, reassign it, see the badge clear.

```bash
./scripts/dev.sh
```

If `:3000`/`:3001` are occupied on this machine (they are — another app holds `:3000` and `docker-flowise-1` holds `:3001`), start the two servers directly instead, remembering that the API derives its CORS origin from `WEB_PORT`:

```bash
cd server && API_PORT=3011 WEB_PORT=3010 ./node_modules/.bin/tsx watch src/server.ts
cd client && NEXT_PUBLIC_API_BASE=http://localhost:3011 ./node_modules/.bin/next dev -p 3010
```

- [ ] **Step 7: Record the clickthrough**

Capture a screen recording of that flow as an mp4 and report the file path — this repo's owner attaches it to the PR manually. Do not upload it anywhere.

- [ ] **Step 8: Commit**

```bash
git add e2e server/src/db/seed.ts
git commit -m "test(e2e): token deletion leaves a repo broken until reassigned"
```

---

## Self-Review

**Spec coverage:** every spec section maps to a task — data model → 2; contracts → 3; resolution/container/error → 4, 5; env removal incl. docs → 6; API → 7, 8; UI (settings, repo page, nav, picker, badge) → 10, 11; failure modes → tested in 4, 7, 8; testing strategy → in every task plus 12; rollout → 2 (migration) and 12 (verification). Task 1 is additive: the toolchain fix the spec did not know it needed.

**Two refinements to the spec, both recorded here as the source of truth:**

1. **Access probing uses `listPullRequests`, not a repo read.** `GitHubClient` (`server/src/vendor/shared/adapters.ts:149-173`) has no `getRepo`, and adding one would edit an existing shared contract, which the conventions forbid. `listPullRequests` 404s on an unreadable repo and is the capability the app actually depends on.
2. **The resolver takes no `Db`.** The spec described `GitHubTokenResolver(db, secrets)` because the `legacy` flag needed a row read. With the env path removed there is nothing to read, and the FK already guarantees a non-null `github_token_id` points at a real row — so it is a module with `tokenSecretKey()` + `resolveGitHubToken(secrets, id)`.

**Also worth flagging for the implementer:** Task 11 Step 4 replaces a *Test access* button that would have needed the raw token in the browser with a server-side `POST /repos/:id/test-access` route. The token value must never reach the client.

**Open items still owed to the reviewer** (from the spec, unchanged): accept the `nav.ts` vendored edit or drop the sidebar entry; and tombstone-via-`set(key,'')` versus adding an optional `delete?()` to `SecretsProvider`. This plan implements the tombstone and the nav edit, so rejecting either means changing Task 7 Step 4 or Task 11 Step 3 respectively.
