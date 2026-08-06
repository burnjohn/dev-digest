# Per-repo GitHub tokens — design

**Date:** 2026-08-05
**Status:** proposed (awaiting review)

## Problem

DevDigest resolves exactly one GitHub PAT, process-wide:

- `SecretsProvider` is a flat key→value store (`~/.devdigest/secrets.json`, `process.env` fallback) with a single `GITHUB_TOKEN` key — `server/src/adapters/secrets/local.ts:37-42`.
- `Container.github()` reads that key and caches **one** `OctokitGitHubClient` for the process — `server/src/platform/container.ts:153-160`.
- The clone job authenticates with the same token — `server/src/modules/repos/service.ts:53`.
- `repos` has no credential association — `server/src/db/schema/repos.ts`.

A user with several PATs of differing reach (work org, personal, a client org, a fine-grained token bound to one owner) cannot say *"use this token for that repo"*. Fine-grained PATs are bound to a single resource owner, and orgs can restrict PAT access or require SSO authorization, so one token genuinely cannot cover every repo a user tracks.

## Goal

Let the user keep several labelled GitHub tokens, managed entirely in the UI, and choose per repo which one authenticates its API calls and clones.

## Non-goals

- GitHub App installations (per-installation tokens). Out of scope; the design leaves room for it but adds no abstraction for it now.
- Background revalidation of tokens. Detection is on-demand via a Test button.
- Per-repo settings beyond GitHub access. The new repo settings page exists to host the token picker; other fields are read-only facts.
- Raising API rate limits. REST quota is per user, not per token; multiple PATs do not increase it.
- Multi-user support. The design assumes the current single-user, local-first deployment.

## Decisions

| Question | Decision |
|---|---|
| Token→repo matching | Named tokens in a list; **explicit pick** per repo. No auto-probing. |
| The env token | **Removed entirely.** `GITHUB_TOKEN` / `GITHUB_PAT` in `server/.env` stop being read. Tokens exist only as UI-managed entries. |
| First-run flow | Token dropdown has an inline **`+ New token…`** (label + PAT + Test) so onboarding never leaves the page. |
| Deleting a token in use | **Succeeds.** Affected repos are marked broken (no token) and fail loudly on operations needing GitHub. No silent fallback. |
| Reassign surface | A new **per-repo settings page** at `/repos/[repoId]/settings`. |
| Store shape | DB holds non-secret metadata; the PAT stays in `secrets.json` behind `SecretsProvider`. |
| Vocabulary | **token** everywhere: `github_tokens`, `repos.github_token_id`, `/github-tokens`, `GitHubTokenResolver`, `token_missing`. |

### Why removing the env token is worth it

An earlier draft kept `server/.env` working by adopting it as a token labelled `default`, flagged `legacy`, with resolution falling back to the bare key. That fallback needed a boot-time adoption step, and the adoption step needed two separate guards to avoid silently reattaching credentials a user had deliberately deleted — both of which were found only by writing the failure modes out. With no other users to support, deleting the env path removes the fallback, the adoption step, the `legacy` column, and that entire class of bug.

The cost is one manual step, once: copy the PAT out of `server/.env` into Settings → GitHub Tokens, and assign it to the existing repo. Nothing automates that, deliberately — an automatic import is the adoption step under another name.

## Data model

New table, `server/src/db/schema/github-tokens.ts` — metadata only, never token values:

```ts
githubTokens = pgTable('github_tokens', {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  label: text().notNull(),              // "work", "client-x"
  githubLogin: text(),                  // @login, captured on successful validation
  createdAt: now(),
  lastValidatedAt: timestamp({ withTimezone: true }),
}, (t) => ({ uq: uniqueIndex('github_tokens_ws_label_uq').on(t.workspaceId, t.label) }))
```

`repos` gains:

```ts
githubTokenId: uuid('github_token_id').references(() => githubTokens.id, { onDelete: 'set null' })
```

Nullable by design: **`NULL` is the broken state.** `ON DELETE SET NULL` means deleting a token produces that state as a database guarantee rather than application bookkeeping, and "which repos are broken" is one predicate in the existing repo list query.

Workspace-scoped like `repos` and `settings`.

### Where the secret lives

The PAT goes through the existing chokepoint under key `GITHUB_TOKEN:<githubTokenId>`. This needs no shared-contract change: `SecretKey` is an open union (`| (string & {})`) — `server/src/vendor/shared/adapters.ts:280-285`. Migrations carry no secret material.

The union's existing `'GITHUB_TOKEN'` member is left in place — it costs nothing, and removing it would mean editing an existing shared contract file for no gain.

## Resolution

```
tokenFor(githubTokenId):
  if githubTokenId is null            → throw MissingTokenError
  secrets.get(`GITHUB_TOKEN:${id}`)   → non-empty? use it
  otherwise                           → throw MissingTokenError
```

One lookup, no fallback, and **no database access**: with `legacy` gone there is no row to read, and the FK guarantees a non-null `github_token_id` points at a real row. So this is a small module (`modules/github-tokens/resolver.ts`) exposing `tokenSecretKey(id)` and `resolveGitHubToken(secrets, id)` — the only place that knows the key format, so replacing `LocalSecretsProvider` with a Vault backend stays a one-adapter change.

### Container

- `github()` → `github(githubTokenId: string | null)`, argument **required with no default**, so TypeScript flags any missed call site instead of silently returning the old global client.
- The single `_github` field becomes `Map<string, GitHubClient>` keyed by token id.
- `invalidateSecretCaches()` (`server/src/platform/container.ts:217`) clears the map, so replacing a PAT's value takes effect without a restart — the behavior that exists today.
- `overrides.github` keeps short-circuiting **ahead** of resolution, so every existing test injecting a fake `GitHubClient` compiles and passes untouched.

### New error

`MissingTokenError` → **422**, code `token_missing`. `ConfigError` is a 500 (`server/src/platform/errors.ts:37-41`), which misrepresents a user-fixable state; the client needs to distinguish "assign a token" from "GitHub is down" to render the right CTA. Validation answers 422 in this codebase, never 400.

### Call sites

All five API sites load the `repo` row immediately before calling `container.github()`, so `repo.githubTokenId` is already in hand at each:

| Site | Behavior with no token |
|---|---|
| `GET /repos/:id/pulls` — `pulls/routes.ts:34-39` | existing catch serves persisted PRs; **repo stays browsable** |
| PR detail — `pulls/routes.ts:203` | existing catch serves stored files/commits |
| `pulls/routes.ts:302`, `:325` | same local-first degradation |
| `POST /repos/:id/poll` — `polling/routes.ts:28` | explicit action → **422 `token_missing`** |
| `POST /settings/test-connection` — `settings/routes.ts:87` | the `github` branch is **removed**; see below |

The local-first degradation already in the codebase is what makes the broken state land softly where it should: a broken repo remains fully readable offline; only operations that genuinely need GitHub fail.

`POST /settings/test-connection` with `provider: 'github'` has no token id to pass and no global token to test, so its GitHub branch is deleted and the route answers **422** pointing at `POST /github-tokens/test`. The `ConnTestProvider` enum in the shared contract keeps its `github` member — the route rejects it, no contract edit needed. `SECRET_KEY_BY_PROVIDER`'s `github` entry (`settings/constants.ts:12`) and `GITHUB_TOKEN_SECRET` (`repos/constants.ts:12`) are deleted.

### Clone

`CloneJobPayload` gains `githubTokenId`; `runCloneJob` resolves through the same resolver. The existing anonymous-clone attempt is **kept** (`token ? withGitHubToken(url, token) : url`) because that is how public repos work today and removing it would regress them. When the anonymous clone fails, the job error names the missing token rather than surfacing a raw git auth error, so `GET /jobs/:id` stays legible.

## Removing the env token

Deleted outright:

| Location | What goes |
|---|---|
| `server/src/adapters/secrets/local.ts:40` | the `GITHUB_TOKEN` → `env.GITHUB_TOKEN ?? env.GITHUB_PAT` special case |
| `server/src/modules/repos/constants.ts:12` | `GITHUB_TOKEN_SECRET` |
| `server/src/modules/settings/constants.ts:12` | the `github: 'GITHUB_TOKEN'` mapping |
| `server/src/modules/settings/routes.ts` | the `GITHUB_PROVIDER` branch of `test-connection` |
| `server/.env.example:12-13` | the `GITHUB_TOKEN` block |
| `scripts/dev.sh:44` | `GITHUB_TOKEN` in the "add your API keys" warning |
| `server/README.md:28-29,96,103`, `README.md:114`, `server/CLAUDE.md:46` | env-token documentation, including the "`GITHUB_PAT` accepted as fallback" gotcha |

**Not touched:** `client/messages/en/ci.json:93`. That string refers to GitHub Actions' own auto-provided `GITHUB_TOKEN` inside generated workflows — unrelated to this feature.

Nothing else in the repo reads the env token: no CI workflow, no test, no `e2e/` spec.

### First-run consequence

After the migration, `repos.github_token_id` is `NULL` for every existing repo, so each shows the broken badge until a token is created and assigned. That is the honest state — the app has no credential it is allowed to use — and it is the same path a fresh install takes. Reads keep working throughout, per the local-first degradation above.

## API

New module `server/src/modules/github-tokens/` (routes + service + repository), one import and one entry in `modules/index.ts`.

| Route | Behavior |
|---|---|
| `GET /github-tokens` | list with `repo_count` and `configured` (`configured` = a non-empty `GITHUB_TOKEN:<id>` is stored); **never returns token values** |
| `POST /github-tokens` | `{label, token}` → validate via `currentLogin()` **before** persisting; store row + `GITHUB_TOKEN:<id>`; 422 on a bad PAT |
| `PATCH /github-tokens/:id` | rename and/or replace value; re-validate when a value is supplied; `invalidateSecretCaches()` |
| `DELETE /github-tokens/:id` | succeeds; FK nulls affected repos; returns `{deleted, orphaned_repos: n}` |
| `POST /github-tokens/test` | ephemeral validation, nothing persisted — powers the inline Test button |
| `PATCH /repos/:id/github-token` | `{github_token_id: string \| null}` — reassign |
| `POST /repos/:id/test-access` | resolves the repo's **stored** token server-side and probes it against this repo; powers the *Test access to this repo* button without the value ever reaching the browser |
| `POST /repos` | body gains **optional** `github_token_id` |

`github_token_id` is optional on `POST /repos` so existing callers posting `{url}` alone (including `e2e/`) keep working; omitted means **no token**, and the repo is created in the broken state. The UI always sends it. With the env fallback gone there is no longer any implicit token to inherit, at creation time or after.

`GET /repos` joins `github_tokens` to return `github_token_label` alongside `github_token_id`, so the repo list and the broken badge need one request, not one per repo. Neither route declares a response schema today, so no serialization filtering is in the way.

### Contracts

A **new** file `contracts/github-tokens.ts`, exported from the barrel — existing contract files are not edited, per the extend-never-edit rule:

- `GitHubToken`, `GitHubTokenInput`, `GitHubTokenTestResult`
- `RepoCreate = RepoInput.extend({ github_token_id: z.string().optional() })`
- `RepoWithToken = Repo.extend({ github_token_id: z.string().nullable(), github_token_label: z.string().nullable() })`

**It must be added to both copies.** `client/src/vendor/shared/` is a real directory, **not** a symlink to the server's copy (client/CLAUDE.md says "symlinked from server" — that is stale), and there is no sync script. The two copies have already drifted in `adapters.ts`, `contracts/eval-ci.ts`, `knowledge.ts`, `productionize.ts`, and `trace.ts`. Implementation adds the identical file under `server/src/vendor/shared/contracts/` (canonical) and `client/src/vendor/shared/contracts/`, updating both barrels. Existing drift is out of scope.

## UI

### Settings → GitHub Tokens (global)

New section at `/settings/github-tokens`, added to `SETTINGS_SECTIONS`. Rows show label, `@login`, masked value, repo count, with Test / Rename / Replace / Delete. Deleting names the repos about to be orphaned.

`github` is **removed** from `KEY_ROWS` in `SettingsApiKeys` — that field has nothing to write to any more. API Keys keeps the LLM providers.

### Repo settings page (new)

`client/src/app/repos/[repoId]/settings/page.tsx` — a thin wrapper over `_components/RepoSettingsView/`, sibling to `pulls`.

Contents:

- Read-only repo facts from the existing `Repo` contract: `full_name`, `default_branch`, `clone_path`, `last_polled_at`.
- **GitHub access**: the token picker, the selected token's `@login`, and a *Test access to this repo* button running the same `owner/name` check `POST /repos` uses — confirming a PAT reaches *this* repo, not merely that it authenticates.
- Broken state (`github_token_id: null`) renders as an amber banner with the picker as its fix.
- **No** *Remove repository* — that lives in `RepoSwitcher`; duplicating a destructive action invites deleting the wrong repo.

### Nav

One line in `NAV`'s WORKSPACE group — `{key: "repo-settings", label: "Repository", icon: "Settings", href: "/repos/:repoId/settings", gKey: "r"}` — plus a `g r` entry in `SHORTCUTS`.

This is **the only vendored file the design touches** (`client/src/vendor/ui/nav.ts`, marked do-not-touch). Justification: it is the nav registry doing what it was built for, and `:repoId` templating plus `resolveHref` already exist. The alternative — no sidebar entry, reachable only from a link in the PR header — costs nothing in vendor churn and loses discoverability. Flagged explicitly for the reviewer's call.

### Shared component

`GitHubTokenPicker` — dropdown + `+ New token…` inline create (label, PAT, Test) — used by **both** `AddRepoView` and `RepoSettingsView`. One unit, one purpose, two consumers; the inline-create flow is built once.

### Broken badge

A small amber chip in the PR list page header (`app/repos/[repoId]/pulls/page.tsx`, alongside `Auto-review` / `Refresh`) linking to the repo settings page. App code, no vendor edit, signal where the work happens.

### Plumbing

New hooks in `client/src/lib/hooks/` (`useGitHubTokens`, `useCreateGitHubToken`, `useAssignRepoToken`) and `client/messages/en/github-tokens.json`, per the per-feature i18n convention.

## Failure modes

1. **Bad PAT on create** → validated before any write; 422; nothing persisted.
2. **Token valid but cannot see the repo** — a PAT that authenticates fine still 404s on a private repo it lacks access to. `POST /repos` probes the chosen token against `owner/name` before inserting, returning 422, rather than accepting the repo and failing in the clone job minutes later. The probe is **`listPullRequests`**, not a repo read: `GitHubClient` has no `getRepo` (`server/src/vendor/shared/adapters.ts:149-173`) and adding one would edit an existing shared contract, while listing PRs is both a valid 404-on-no-access check and the exact capability DevDigest depends on.
3. **Token deleted while in use** → FK nulls `repos.github_token_id`; repos show the broken badge; reads still work from Postgres; poll/clone fail with `token_missing`.
4. **Token revoked upstream** → no background revalidation. GitHub's 401 surfaces as the existing `ExternalServiceError` 502; the Test button and `last_validated_at` are the whole story.
5. **No `delete` on `SecretsProvider`** — the interface has only `get`/`set` (`server/src/vendor/shared/adapters.ts:287-294`). Deletion tombstones the value with `set(key, '')`: `local.ts:39` does `if (stored) return stored`, so `''` is falsy and falls through as absent. With the env special case gone, an absent value now means `MissingTokenError` — there is nothing left to fall through *to*. No secret material remains; an empty key lingers in `secrets.json`. The cleaner fix — an optional `delete?()` on the interface — is additive and breaks no consumer, but edits an existing shared contract file, so it is not proposed here.
6. **A stale `GITHUB_TOKEN` left in `server/.env`** → ignored. Worth stating because it is silent: the app will not use it, and the repo shows as broken until a token is added through the UI. `.env.example` and the docs are updated so the variable stops being suggested.
7. **Two repos sharing one token** → they share the cached client from the Map. No special handling.

## Testing

Following the `*.it.test.ts` split (DB-backed via testcontainers; everything else hermetic):

**Hermetic**

- Resolver: a stored `GITHUB_TOKEN:<id>` resolves; a missing one throws `MissingTokenError`; a tombstoned (`''`) value is treated as absent; **`process.env.GITHUB_TOKEN` set is never used** (the regression test for the removed fallback).
- Container: Map caching per token id; `invalidateSecretCaches()` drops entries; `overrides.github` still short-circuits.
- Client components with mocked fetch: `GitHubTokenPicker` dropdown and inline create, broken badge, repo settings view.

**DB-backed (`.it.test.ts`)**

- `ON DELETE SET NULL` really nulls `repos.github_token_id`.
- `repo_count` aggregation; `PATCH /repos/:id/github-token`.
- `POST /repos` without `github_token_id` creates a repo in the broken state.
- Route tests inject a fake `GitHubClient` via `ContainerOverrides` — no network.

**e2e (`e2e/`, deterministic, no LLM)**

`e2e/` never contacts GitHub; it runs on seeded data. So the flow covers what works offline: seed a token row and a repo, delete the token, assert the badge appears, reassign, assert it clears. Adding a token cannot be covered there because validation needs GitHub; that path stays on the hermetic and DB-backed tests.

## Rollout

1. Migration via `pnpm db:generate` (new table + `repos.github_token_id`), applied with `cd server && pnpm db:migrate` — migrations are not auto-applied on boot.
2. On first boot, existing repos show the broken badge. Create a token in Settings → GitHub Tokens (pasting the value currently in `server/.env`) and assign it on each repo's settings page.
3. Remove `GITHUB_TOKEN` from `server/.env`. It is inert from this point; leaving it there only invites confusion.

## Open items for the reviewer

- **Vendor nav edit** — accept the one-line `nav.ts` addition, or drop the sidebar entry and reach repo settings from the PR header only?
- **`SecretsProvider.delete`** — tombstone via `set(key, '')` as specified, or add the optional `delete?()` to `adapters.ts`?
