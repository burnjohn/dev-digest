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

## Asking the owner — use the interactive prompt, never prose

**Whenever a decision is genuinely the owner's, ask it through the interactive question tool
(`AskUserQuestion`), not as a sentence in a reply.** A question buried in prose — especially at the
end of a long status report, or alongside a table of results — gets missed, and the run then either
stalls waiting for an answer that will never come or proceeds on an assumption the owner never made.

- This covers anything the owner alone can settle: scope calls, spec changes, accepting a known
  defect, authorising a protected action (`db:migrate`, a `client/` build, anything touching git).
- Give real options with their consequences, and mark the recommendation. "What do you want to do?"
  is not a question, it is a shrug.
- Batch related decisions into one prompt rather than firing several in a row.
- Purely informational status — what landed, what is running, what a check returned — stays in prose.
  The prompt is for decisions, not for narration.

## Delegation — which agent gets the work

**Delegating is the default, not an escalation.** This section is the repo owner's standing
instruction to dispatch: route by the table below and do not ask for permission task by task.
The agents live in `.claude/agents/`; [`.claude/agents/README.md`](.claude/agents/README.md) is the
**canonical catalog** — what each one may touch, what it consumes and what it hands back. Their
rules live in the agent files and are not restated here.

| When the work is… | Dispatch | Note |
|---|---|---|
| Finding something out — in this project or on the public internet | [`researcher`](.claude/agents/researcher.md) | Read-only. Returns a cited report, never a file. |
| Deciding *what* to build and what "done" means — before any plan exists | [`spec-creator`](.claude/agents/spec-creator.md) | Interviews on blockers first, then writes `<pkg>/specs/SPEC-NN-<slug>.md` with EARS acceptance criteria and a design review. Its own improvement ideas stay in the report until you accept them. |
| Deciding *how* to build something — decomposition into tasks | [`implementation-planner`](.claude/agents/implementation-planner.md) | Validates the requirements it is given, asks whether to run multi-agent or single-agent, then writes `docs/plans/NN-slug.md` and nothing else. |
| Writing the code for **one** task block | [`implementer`](.claude/agents/implementer.md) | N-up in parallel only on disjoint `Owned paths`. |
| Running a finished plan end to end — waves, review, fixes, verification | [`run-plan`](.claude/skills/run-plan/SKILL.md) — a **skill**, not an agent | The parent session runs it. Drives `implementer` waves, then the architecture review→fix→re-review loop, then `plan-verifier`. Never writes a spec or a plan, never commits. |
| Checking a finished implementation | [`architecture-reviewer`](.claude/agents/architecture-reviewer.md) **then** [`plan-verifier`](.claude/agents/plan-verifier.md) | Structure first, completeness last — see below. |
| Writing tests for code that already exists | [`test-writer`](.claude/agents/test-writer.md) | Never edits the file under test. |
| Writing a design note, a README, or a spec for something that already shipped | [`doc-writer`](.claude/agents/doc-writer.md) | Documents what already exists. `docs/plans/**` is not its surface, and neither is a file carrying a `Spec ID:` line. |

**The verification pair runs in that order, and the second leg has two preconditions.**
`architecture-reviewer` judges structure and runs first, so remediation happens before anything is
graded complete. `plan-verifier` answers *was every `REQ` actually shipped* by walking the plan's own
coverage matrix, so (1) it needs `docs/plans/NN-*.md` to exist, and (2) it must run **last** — its
contract caps code inspection at `PARTIAL`, so only a passing test buys `VERIFIED` and running it
before the tests are in returns `INCOMPLETE` by construction. Work dispatched through the short leg
— task block inline, no plan file — has no matrix to walk: run `architecture-reviewer` alone.

The full post-wave order is [docs/plans/README.md](docs/plans/README.md) §"After the waves land":
coverage triage (free) → `architecture-reviewer` → remediation → `test-writer` at flagged gaps only
→ `plan-verifier` → remediation. The [`run-plan`](.claude/skills/run-plan/SKILL.md) skill executes it.

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
