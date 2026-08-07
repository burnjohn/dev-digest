# Insights — cross-package

Decisions that span more than one package, and things we tried that did not
work. Module-local lessons go in `<module>/INSIGHTS.md` instead.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. Every entry must be actionable cold: claim first, `path:line` or a
runnable command last. If it would be obvious to anyone reading the code, leave
it out.

Roughly 5 entries per section. When an entry becomes stable reference material,
move it into `docs/` and delete it here.

---

## Decisions

### 2026-08-07 — CLAUDE.md → AGENTS.md via symlink, not the `@AGENTS.md` import

**What:** all five `CLAUDE.md` files (root, `client/`, `e2e/`, `reviewer-core/`,
`server/`) were moved to `AGENTS.md`, with `CLAUDE.md` kept as a same-directory
symlink (`ln -s AGENTS.md CLAUDE.md`) so Claude Code keeps working unchanged.
**Why:** explicit choice to keep one canonical file per directory, byte-identical
regardless of which name is opened; the repo is developed on Linux/macOS only, so
the symlink's Windows caveat doesn't apply here.
**Rejected:** Anthropic's documented preference — a real `CLAUDE.md` containing
only `@AGENTS.md` (Claude Code's file-import syntax, memory.md docs) — because it
is cross-platform and survives copy steps that drop symlinks (Docker `COPY`, zip
export), which a plain symlink does not. Claude Code reads `CLAUDE.md` only; it
does not read `AGENTS.md` on its own. If this repo ever needs a Windows
contributor or a symlink-unsafe build/copy step, swap to the import stub — it is
a five-file, one-line-each change.

### 2026-07-31 — Standalone packages instead of a workspace

**What:** four packages, each with its own `package.json` and lockfile; sharing
happens through tsconfig path aliases, not published modules. Each suite is
gated by its own CI workflow with a path filter.
**Why:** _rationale not recorded anywhere in the repo — fill this in._ Do not
"fix" this into a workspace before that gap is closed; it is load-bearing for the
per-package CI path filters.

### 2026-07-31 — Zod contracts as the single source of truth

**What:** `@devdigest/shared` schemas drive request validation, response
serialization, and client-side types.
**Why:** one definition, no drift between server and client.
**Rejected:** hand-rolled `Schema.parse(req.body)` inside handlers — it validated
input but left responses unchecked, so contract drift surfaced in the browser.

## What Works

_None yet._

## What Doesn't Work

_None yet._

## Codebase Patterns

- **2026-08-04** — `server/src/vendor/shared/contracts/*.ts` and
  `client/src/vendor/shared/contracts/*.ts` are two independent files with no
  sync script between them — a schema change must be hand-edited in both
  (server first, per `AGENTS.md`). Confirmed by a pre-existing comment-only
  diff between the two `trace.ts` copies before this session touched either.
  Forgetting the client copy compiles fine locally (client typecheck only sees
  its own copy) and fails invisibly until the two drift on a real field.
  `server/src/vendor/shared/contracts/trace.ts` /
  `client/src/vendor/shared/contracts/trace.ts`

- **2026-08-01** — Per-run LLM cost is already computed end-to-end; the only
  thing ever missing is persistence. Every provider returns `costUsd` on its
  result, and for OpenRouter it is the REAL billed figure — the client asks for
  it with `usage: { include: true }` and reads `usage.cost`, falling back to the
  injected `PriceBook` estimator. `reviewPullRequest` then sums it across
  map-reduce chunks onto `ReviewOutcome.costUsd`. Commit `d45ab0d` removed the
  cost *feature* by dropping that one field at the destructure in
  `run-executor.ts` and deleting the `agent_runs.cost_usd` column, leaving the
  computation intact. So surfacing cost anywhere costs **zero extra model
  calls** — wire up the existing field, never add a pricing lookup or a second
  request. `reviewer-core/src/review/run.ts:216`

## Tool & Library Notes

_None yet._

## Recurring Errors & Fixes

_None yet._

## Open Questions

_None yet._
