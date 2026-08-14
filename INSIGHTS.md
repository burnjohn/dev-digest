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

### 2026-08-14 — Local review zones are derived from CI `paths:`, not redefined

**What:** `pr-self-review` decides which skills see which files by reading the
`paths:` filters in `.github/workflows/*.yml` and treating each workflow's
filter as one "zone". `.claude/skills/pr-self-review/routing.md` holds only a
cached copy plus the zone→skill mapping, and the skill prefers the workflows
when the two disagree.
**Why:** the gate's only claim is "a local PASS means CI will be green". A
second, hand-maintained glob list makes that claim decay silently the first time
someone edits a workflow — and the cross-zone edges are exactly the ones nobody
remembers: `reviewer-core/**` activates the *server* zone (server aliases
`../reviewer-core/src` at typecheck), and `server/src/vendor/shared/**` activates
the *reviewer-core* zone. This is the same property the 2026-07-31 "Standalone
packages" entry calls load-bearing.
**Rejected:** a self-contained glob table in the skill. Simpler to read, but it
is a copy of a source of truth that changes without it.

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

- **2026-08-14** — A "you may not proceed until you have run X" gate has to bind
  its verdict to **both** `git rev-parse HEAD` **and** a hash of the working
  tree; the sha alone lets a PASS earned on one set of changes be spent on
  another, since the uncommitted half is what usually changed. Two constraints
  on that hash, both found by testing rather than by reading: it must cover the
  *contents* of untracked files (a new file with `git status` alone hashes the
  name only, so editing it keeps a stale PASS valid), and it must exclude the
  gate's own artifacts — `.claude/pr-review/` is gitignored precisely so that
  writing a verdict does not invalidate the verdict just written, which is an
  unbreakable staleness loop. Compute it in exactly one place and have both
  writer and reader call it: `./scripts/pr-gate.sh --worktree-hash`.

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
  **This is exactly what happened. Gated 2026-08-14.** By then 5 files had
  drifted on real fields, not comments: the client copy of `adapters.ts` was a
  generation behind (no `CommitFile`, `CommitFilesPayload`, `commitFiles()`,
  `findOpenPr()`, `sessionId`), and `'openrouter'` was missing from the provider
  enum in `adapters.ts`, `eval-ci.ts` and `productionize.ts` — so a provider the
  server supported could not be typed on the client at all. Both packages
  typechecked green throughout. `scripts/check-contracts.sh` now diffs the two
  trees and is a required job in both `client.yml` and `server-unit.yml`; run it
  with `--fix` to adopt the server side (server is canonical), then
  `cd client && pnpm typecheck` because new fields widen unions.
  `scripts/check-contracts.sh`

- **2026-08-01, corrected 2026-08-14** — Per-run LLM cost is computed end-to-end
  **and persisted**. Every provider returns `costUsd` on its result, and for
  OpenRouter it is the REAL billed figure — the client asks for it with
  `usage: { include: true }` and reads `usage.cost`, falling back to the injected
  `PriceBook` estimator. `reviewPullRequest` sums it across map-reduce chunks
  onto `ReviewOutcome.costUsd`.
  **The "never persisted" half of this entry is no longer true.** Commit
  `d45ab0d` did drop the field at the `run-executor.ts` destructure and delete
  the column (migration `0009_complex_runaways.sql`), but `0010_modern_professor_
  monster.sql` re-added `agent_runs.cost_usd` and back-filled it, and the write
  path is live again — `run-executor.ts:213` destructures it, `:249` passes it to
  `completeAgentRun`, `run.repo.ts:179` writes it. So surfacing cost costs zero
  extra model calls **and** zero schema work: read the existing column.
  One caveat the backfill introduces — rows predating `0010` hold an *estimate*
  computed from a hardcoded price list in the migration, not a billed figure,
  and models absent from that list are `NULL`. Live rows are real. Don't present
  historical and new costs as the same kind of number.
  `reviewer-core/src/review/run.ts:216`, `server/src/db/migrations/0010_modern_professor_monster.sql:13`

## Tool & Library Notes

- **2026-08-14** — A `PreToolUse` hook on `Bash` sees only the command *string*,
  and both consequences bite immediately. (1) A substring match fires on any
  command that merely mentions the guarded text — `scripts/pr-gate.sh`'s first
  smoke test blocked itself, because the test echoed `gh pr create` as JSON into
  the hook. Anchor to a command position instead: start of line or after
  `;`/`&&`/`||`/`|`/`(`, allowing `VAR=value` prefixes. (2) An inline env prefix
  does **not** reach the hook — `PR_SELF_REVIEW_SKIP=1 gh pr create` sets the
  variable for that command only, while the hook runs as a separate process that
  never sees it, so an env-var escape hatch that is only read via
  `$PR_SELF_REVIEW_SKIP` is silently dead. Detect the prefix in the command text
  as well. Also make parse failures **allow**: a hook that blocks every `Bash`
  call because its stdin was malformed is far worse than one that misses a PR.
  `scripts/pr-gate.sh:36`

- **2026-08-07** — The numeric rules in the `react-best-practices` skill — "Max
  200 lines per component", "Max 5-7 props" — have **no authoritative source**.
  A two-round research pass over react.dev, nextjs.org, Kent C. Dodds, Robin
  Wieruch and bulletproof-react found zero primary sources stating any numeric
  component-size threshold; React's only stated criterion is behavioural ("a
  component should ideally only be concerned with one thing", `Thinking in
  React`). The one numeric rule that *is* sourced governs duplication, not file
  length: abstract on the third occurrence ("two times, but never three", Dodds,
  *AHA Programming*). So treat the line/prop counts as house style — usable as a
  smell trigger, not quotable as industry practice, and not a review comment on
  their own. `.claude/skills/frontend-ui-architecture/README.md` records the
  full evidence and tags every rule `[DOC]` / `[CONV]` / `[SPLIT]` for exactly
  this reason.

- **2026-08-07** — The `deep-research` workflow answers "what does the canonical
  doc say" well and "what do practitioners do" not at all. A 102-agent,
  3.5M-token run on frontend architecture returned 14 high-confidence findings
  clustered entirely on Feature-Sliced Design's docs plus Next.js/React
  first-party material, and **zero** verified claims for six requested
  sub-questions (component-extraction criteria, constants placement, the
  utils/helpers/lib taxonomy, business-logic placement, types/test colocation,
  state placement) — its adversarial verification kills named-author blog claims
  that no primary source corroborates, which is most practitioner knowledge. Its
  own `caveats` field says so; read that field before the findings. The fix is
  cheap: a targeted pass of ~8 direct `WebFetch` calls against named URLs filled
  all six gaps in a fraction of the cost. Use the workflow to map a field, then
  fetch the practitioner sources by hand.

## Recurring Errors & Fixes

_None yet._

## Open Questions

_None yet._
