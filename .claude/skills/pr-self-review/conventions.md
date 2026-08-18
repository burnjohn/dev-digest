# Stage A — deterministic checks (no LLM)

Everything here is decidable by running a command or matching a path. These
findings carry `verified: true` from birth: they **skip Stage E** and block
immediately. They are also the cheapest and the most precise findings the skill
produces, so they run first — and a Stage A failure short-circuits the LLM
fan-out entirely (see `SKILL.md`, step 3).

Every Stage A finding uses `category: "build"` unless stated otherwise, and
`confidence: 1.0`.

---

## A1. Toolchain — run what CI runs

Run these **only for activated zones** (`routing.md` §1). Note the package
manager per package: `server/` and `client/` use **pnpm**, `reviewer-core/` and
`e2e/` use **npm**. Running the wrong one in a package is itself a finding (A2.3).

| Zone            | Commands                                                             |
| --------------- | -------------------------------------------------------------------- |
| always          | `./scripts/check-contracts.sh`                                       |
| `client`        | `cd client && pnpm typecheck && pnpm lint && pnpm test`              |
| `server`        | `cd server && pnpm typecheck && pnpm lint && pnpm test`              |
| `reviewer-core` | `cd reviewer-core && npm run typecheck && npm test`                  |
| `e2e`           | `cd e2e && npm run typecheck && npm run lint`                        |

Non-zero exit → **CRITICAL**, with the failing command and the first ~20 lines
of output as `rationale`.

### `check-contracts.sh` runs unconditionally, and it matters most

`@devdigest/shared` is vendored twice — `server/src/vendor/shared` (canonical)
and `client/src/vendor/shared` — with no build step between the copies. Each
package typechecks only its own. **A contract edited on one side and forgotten
on the other compiles green in both and fails only in the browser.** No skill
reviewer can see this: each one is shown a single zone's slice by design. The
script diffs the two trees and is the only thing that notices.

If it fails, the fix is `./scripts/check-contracts.sh --fix` followed by
`cd client && pnpm typecheck` — say that in the finding's `suggestion`.

### `server` test split

`server/` tests are split by filename: `*.it.test.ts` are DB-backed
(testcontainers Postgres, run by `server-integration.yml`); everything else must
stay hermetic and is what `pnpm test` runs. Do **not** run the integration suite
in Stage A — it needs Docker and minutes. If the diff adds or changes an
`*.it.test.ts`, note in the report that integration coverage was deferred to CI.

### `e2e` is reported, not run

`e2e-web.yml` boots Postgres, the API and a Next build. Too slow for a pre-PR
gate. Report `e2e: will run in CI (not run locally)` and move on. Never let a
skipped suite read as a pass.

---

## A2. Repo conventions

Sourced from the "Conventions", "Gotchas" and "Do not touch" sections of the
root `CLAUDE.md`. These are the mistakes the repo has actually paid for.

### A2.1 — Edit inside `server/clones/**` → CRITICAL

`server/clones/` holds cloned user repos, **including a full copy of dev-digest
itself**. A change there is almost always the same accident: a grep matched the
clone and the edit landed in the wrong file. It is gitignored, so the change is
also invisible in the PR.

`category: "bug"`. Suggestion: re-apply the change to the real path, revert the
clone.

### A2.2 — Edit inside `**/src/vendor/**` → CRITICAL

Vendored trees are not hand-edited. The single exception is a deliberate
contract change in `server/src/vendor/shared`, which must be paired with a
`check-contracts.sh` sync (A1) — if `check-contracts.sh` passes and the change
is confined to `server/src/vendor/shared` and its client mirror, downgrade to
`SUGGESTION` and ask the author to confirm intent. Any edit to
`client/src/vendor/ui/**` or a client-side `vendor/shared` that is not a mirror
of the server's stays CRITICAL.

### A2.3 — Wrong package manager → CRITICAL

This is not a monorepo workspace: each package has its own lockfile.

| Path                                                        | Verdict                                    |
| ----------------------------------------------------------- | ------------------------------------------ |
| `server/package-lock.json`, `client/package-lock.json`       | CRITICAL — npm was run in a pnpm package    |
| `reviewer-core/pnpm-lock.yaml`, `e2e/pnpm-lock.yaml`         | CRITICAL — pnpm was run in an npm package   |
| a lockfile at the repo root                                  | CRITICAL — install was run from the root    |

### A2.4 — Drizzle schema changed without a migration → CRITICAL

If the diff touches `server/src/db/schema.ts` but adds no file under
`server/src/db/migrations/`, the change will boot and fail at runtime with
`relation ... does not exist` — migrations do not run on boot.

Suggestion: `cd server && pnpm db:generate && pnpm db:migrate`.

Inverse case: a new migration with no schema change is a **WARNING** (usually a
hand-written migration that will be clobbered by the next `db:generate`).

### A2.5 — Secrets in the diff → CRITICAL

`category: "security"`. Secrets live in `~/.devdigest/secrets.json` (mode 0600)
with `process.env` as fallback — never in git, never in the database. Match
added lines for: private key blocks, `sk-`/`ghp_`/`github_pat_` prefixes, AWS
key ids, bearer tokens, connection strings carrying a real password, and any
`.env` file that is not `.env.example`.

Before flagging, confirm it is not a fixture: a value under a `__fixtures__/`,
`*.test.*`, or seed path that is obviously synthetic is a WARNING, not a
CRITICAL. A real key in a test file is still CRITICAL.

### A2.6 — Consumer changed without the contract → WARNING

Contracts change in `@devdigest/shared` **first**, then in consumers. If the
diff changes request/response handling in `server/src/modules/**` or a client
data hook, and the corresponding schema in
`server/src/vendor/shared/contracts/**` is untouched, flag it. Frequently a
false positive on refactors, so it is a WARNING and never blocks.

### A2.7 — Non-hermetic server test outside `*.it.test.ts` → WARNING

A new or changed test under `server/` that is **not** named `*.it.test.ts` but
imports `testcontainers`, opens a `pg` connection, or reaches the network will
break `server-unit.yml`, which assumes everything it runs is hermetic. Either
rename it to `*.it.test.ts` or mock the dependency via `src/adapters/mocks.ts`.

### A2.8 — Docker reset in a script or doc → CRITICAL

Any added line containing `docker compose down -v` (or `docker-compose down -v`).
The `-v` destroys the `devdigest_pgdata` volume and every imported repo and
review with it. `category: "bug"`.

---

## A3. Router self-audit

Compare the directories in `.claude/skills/` against the table in
`routing.md` §2.

- A skill exists but has no row → **WARNING**: it will never run, and the report
  would otherwise claim full coverage.
- A row names a skill that no longer exists → **WARNING**: stale route.
- `routing.md` §1 disagrees with the `paths:` filters in
  `.github/workflows/*.yml` → **WARNING**: local coverage no longer matches CI.

`pr-self-review` itself, `mermaid-diagram` and `engineering-insights` are
exempt — they are authoring tools, not reviewers.

---

## A4. Suppressions

A finding is dropped if it is suppressed, and every suppression **requires a
reason**. A suppression without one is itself a WARNING.

**Inline**, on the line above or at the end of the offending line:

```ts
// pr-review-ignore: A2.6 — contract widened in #412, this consumer lands after
```

**File-level baseline**, `.claude/pr-review/baseline.json` — for known debt that
would otherwise block every PR touching a legacy file:

```json
{
  "entries": [
    {
      "rule": "A2.2",
      "file": "client/src/vendor/ui/Button.tsx",
      "reason": "one-off upstream patch, tracked in DD-118",
      "added": "2026-08-14"
    }
  ]
}
```

Baseline entries are matched on `rule` + `file` only — never on line number,
which goes stale on the first edit. List every applied suppression in the report
so a growing baseline stays visible instead of quietly swallowing the gate.
