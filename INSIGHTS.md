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

### 2026-08-02 — AGENTS.md is the source of truth; CLAUDE.md is a symlink to it

**What:** every package's `CLAUDE.md` (root, `client/`, `e2e/`,
`reviewer-core/`, `server/`) was renamed to `AGENTS.md`, and `CLAUDE.md` was
recreated as a relative symlink (`CLAUDE.md -> AGENTS.md`) at the same path.
Edit `AGENTS.md`; never edit `CLAUDE.md` directly, it has no independent
content.
**Why:** `AGENTS.md` is the emerging cross-tool convention (Codex, Cursor,
etc.), and the project wants any AGENTS.md-aware tool to pick it up while
Claude Code keeps working unmodified by resolving `CLAUDE.md` to the same
bytes.
**Rejected:** Claude Code's native `@AGENTS.md` import syntax inside a stub
`CLAUDE.md`. A symlink was preferred because it is transparent to every tool,
not just Claude Code, with zero drift risk between the two files.
**Cost:** on a Windows checkout without `core.symlinks` enabled, git may check
`CLAUDE.md` out as a plain text file containing the literal string
`AGENTS.md` instead of a working symlink. Not a concern today (macOS-only
contributors) but worth knowing if that changes.

### 2026-08-01 — Per-run severity counts are derived client-side, not a contract field

**What:** the PR list's `findings_by_severity` is a new `PrMeta` field computed
by the server, but the identical breakdown on the Agent runs timeline is derived
in the browser from the reviews `usePrReviews` already loaded, keyed by
`review.run_id`. `RunSummary` deliberately did **not** gain the field.
**Why:** the two surfaces have different data on hand. The list never fetches
findings, so it has to be told; the PR detail page already holds every finding
for its `FindingsPanel`, so a second source would be a second query for data
sitting in the cache. Deriving it also makes dismissal live — dismissing a
finding in the panel updates the chip above it in the same render, which a
denormalized column could not do without an invalidation round-trip.
**Rejected:** a `findings_by_severity` column on `agent_runs` alongside the
existing `findings_count`/`blockers` denorms. It would go stale on dismiss, and
those two columns are written once at run completion precisely because they
describe the run, not the user's later triage of it.
**Cost:** the rollup rule now exists twice — `rollupSeverities` +
`selectLatestReviewPerAgent` in `server/src/modules/pulls/status.ts`, and
`countedFindings` + `countBySeverity` in `client/src/lib/findings.ts`. Both file
headers point at each other; change one and you must change the other, or the
same PR reports different numbers on the list and the detail page.

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

- **2026-08-03** — `.claude/skills/next-best-practices/` covers Next.js App
  Router *routing mechanics only* — the special-file table, `[slug]` /
  `[...slug]` / `[[...slug]]` syntax, `@slot` parallel routes, `(.)`/`(..)`
  interceptors, and the `middleware.ts`→`proxy.ts` rename. Grepping all 20 of
  its files turns up zero hits for "colocat", and its entire Private Folders
  section is 10 lines stating only that a `_` prefix opts a folder out of
  routing — it says nothing about what to put in `_components/`, `src/` vs.
  root `app/`, or when route groups are worth adding organizationally. That
  whole area is owned by `ui-architecture/nextjs-organization.md` instead. When
  extending either skill, keep this boundary: mechanics stay in
  `next-best-practices`, non-route organization stays in `ui-architecture`.

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

- **2026-08-03** — In this environment's shell (zsh), an unquoted variable
  holding multi-line `grep -l` output does **not** word-split in a `for f in
  $files` loop — the whole multi-line string becomes one element, and piping
  it into `sed`/`xargs` fails as `sed: <all paths jammed together>: File name
  too long`. `grep -rlZE ... | xargs -0 sed -i ...` has the same failure mode
  here even with `-Z`/`-0`. What works: write the match list to a real file,
  then `while IFS= read -r f; do …; done < file` — reading a file line-by-line
  never depends on shell word-splitting. Verify any xargs/loop approach first
  with a cheap dry run (e.g. `xargs -0 -n1 echo`) before trusting it against
  real files.

## Recurring Errors & Fixes

_None yet._

## Open Questions

_None yet._
