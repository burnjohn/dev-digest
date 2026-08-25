# AGENTS.md — DevDigest

Local-first AI pull-request review. **Five standalone packages, NOT a workspace** —
each has its own `package.json` + lockfile; cross-package code is shared through
tsconfig path aliases, not published modules. There is no root `package.json`.

Run every command from *inside* the package. Use **pnpm** (client/server) —
`reviewer-core`, `e2e` and `mcp` use npm.

## Modules (each has its own AGENTS.md — bridged to CLAUDE.md for Claude Code — auto-loaded when you touch it)

| Folder           | Package                    | What it is                                   | Port | Map                                  |
|------------------|----------------------------|----------------------------------------------|------|--------------------------------------|
| `server/`        | `@devdigest/api`           | Fastify 5 + Drizzle/Postgres (pgvector)      | 3001 | [server/AGENTS.md](server/AGENTS.md) |
| `client/`        | `@devdigest/web`           | Next.js 15 studio (App Router, React 19)     | 3000 | [client/AGENTS.md](client/AGENTS.md) |
| `reviewer-core/` | `@devdigest/reviewer-core` | Pure engine: diff → prompt → LLM → findings  | —    | [reviewer-core/AGENTS.md](reviewer-core/AGENTS.md) |
| `e2e/`           | `@devdigest/e2e`           | Deterministic browser e2e (agent-browser)    | —    | [e2e/AGENTS.md](e2e/AGENTS.md)       |
| `mcp/`           | `@devdigest/mcp`           | Local stdio MCP server (five tools over HTTP to the API) — started by an MCP client, **never** by `./scripts/dev.sh` | —    | [mcp/AGENTS.md](mcp/AGENTS.md)       |

`@devdigest/shared` (Zod contracts, the source of truth for API/UI types) is vendored
at `server/src/vendor/shared` — not a top-level module. `repo-intel` (codebase indexer)
lives inside the server at `server/src/modules/repo-intel`.

## Session protocol — the insights loop

Each module keeps an append-only `INSIGHTS.md` (non-obvious findings, gotchas, decisions).
The `engineering-insights` skill owns the write format; this protocol makes the loop run.

- **Before starting work** (once you know which module the task touches): read that
  module's `INSIGHTS.md` and consult any skill relevant to the task. Treat logged insights
  as high-confidence guidance unless told otherwise, and **confirm the read by summarizing
  the most relevant points** before writing code (forced active reading, not passive load).
- **Before recording a new insight:** re-read that `INSIGHTS.md`. If the point is already
  there, do not duplicate it — correct a stale entry with a new dated note instead.
- **At the end of a session:** review the *whole* session (not just the last exchange) and
  append any *substantial* new insight via the `engineering-insights` skill. Substantial =
  non-obvious and not already logged. If nothing clears that bar, write nothing — never pad.

## Delegation — which agent gets the work

**Delegating is the default, not an escalation.** This section is the repo owner's standing
instruction to dispatch: route by the table below and do not ask for permission task by task.
The agents live in `.claude/agents/`; [`.claude/agents/README.md`](.claude/agents/README.md) is the
**canonical catalog** — what each one may touch, what it consumes and what it hands back. Their
rules live in the agent files and are not restated here.

| When the work is… | Dispatch | Note |
|---|---|---|
| Finding something out — in this project or on the public internet | [`researcher`](.claude/agents/researcher.md) | Read-only. Returns a cited report, never a file. |
| Deciding *how* to build something — decomposition into tasks | [`planner`](.claude/agents/planner.md) | Writes `docs/plans/NN-slug.md` and nothing else. |
| Writing the code for **one** task block | [`implementer`](.claude/agents/implementer.md) | N-up in parallel only on disjoint `Owned paths`. |
| Checking a finished implementation | [`plan-verifier`](.claude/agents/plan-verifier.md) **then** [`architecture-reviewer`](.claude/agents/architecture-reviewer.md) | Completeness first, structure second — see below. |
| Writing tests for code that already exists | [`test-writer`](.claude/agents/test-writer.md) | Never edits the file under test. |
| Writing a spec, design note, or README | [`doc-writer`](.claude/agents/doc-writer.md) | Documents what already exists. `docs/plans/**` is not its surface. |

**The verification pair runs in that order, and the first leg has a precondition.**
`plan-verifier` answers *was every `REQ` actually shipped* by walking the plan's own coverage matrix,
so it needs `docs/plans/NN-*.md` to exist. Work dispatched through the short leg — task block inline,
no plan file — has no matrix to walk: go straight to `architecture-reviewer`. Completeness before
structure; there is no point judging the shape of a requirement nobody implemented.

**What is never delegated.** Committing, pushing, integration of parallel work, the `pr-self-review`
gate, and the end-of-session `INSIGHTS.md` append stay with the parent session. No agent commits.

**When not to dispatch.** A conversational answer, a one-line mechanical edit, or something already
settled in this session's context — do it inline. The table routes *work*, not every turn.

## Cross-cutting conventions

- **Contracts are shared Zod schemas.** One schema drives request validation *and*
  response serialization (server) and typed hooks (client). Edit the contract, not both ends.
- **Secrets never touch git or the DB.** They live in `~/.devdigest/secrets.json`
  (mode `0600`), with `process.env` as fallback. `GITHUB_TOKEN` is canonical.
- **Only Postgres runs in Docker.** API + web run on the host via `pnpm dev`.
- Wiring: `server/tsconfig.json` aliases `@devdigest/reviewer-core` → `../reviewer-core/src`.
  The engine is consumed as **TypeScript source** (tsx/vitest), never built to JS.

## Gotchas / do-not-touch

- **NEVER `docker compose down -v`** — `-v` deletes the `devdigest_pgdata` volume and
  every imported repo/review. Use it only against the ephemeral e2e stack.
- **Migrations are NOT applied on boot.** Run `pnpm db:migrate` in `server/`.
- `clones/` (imported repo checkouts) and `test-results/` are git-ignored — don't commit them.
- There is **no `agent-runner/`** in the starter — the CI runner is added back in the
  Export-to-CI lesson (L06). The `!agent-runner/dist/` exception in `.gitignore` is
  forward-looking, not a description of the tree.
- **Lock files are never hand-edited.** `pnpm-lock.yaml` and `package-lock.json` are
  regenerated by the package manager — change them only via `pnpm`/`npm`, never by hand.

## Docs & where to look

- [README.md](README.md) — project overview + architecture diagram
- [.claude/agents/README.md](.claude/agents/README.md) — the subagent catalog: permissions, artifacts, and what was actually probed
- [TESTING.md](TESTING.md) — CI strategy: one typological suite per package
- [docs/agent-prompts/](docs/agent-prompts) — reviewer prompt authoring + model choice
- Each module carries: `README.md` (deep dive) · `docs/` (design notes) ·
  `specs/` (specs/flows) · `INSIGHTS.md` (running log of gotchas & decisions).
  These are linked, **not inlined** — read them on demand when the task needs them.
