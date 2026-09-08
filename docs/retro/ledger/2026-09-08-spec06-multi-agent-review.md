# Retro — SPEC-06 Multi-Agent Review (specs/13-multi-agent-review.md)

**Mode:** manual (not `workflow-retro`-skill-generated — see note below)

## Why this isn't a `workflow-retro`-skill output

The skill's Step 0 requires an `Agent`/`SendMessage` dispatch history to
retro, and refuses to fabricate one. Neither the original build session nor
this session made any such dispatches for this run — the feature was built
directly, and this entry compiles real facts from git history and one live
product-level run instead of a per-dispatch token/tool-use breakdown.

**Source:** this entry recovers and reformats real, previously-measured data
that already existed in commit `e4bfbeb` on branch
`feat/07-multi-agent-review-export-to-ci` — a branch that reconciled
`feat/multi-agent-review` (specs/13) with `feat/export-to-ci` (specs/14) but
was itself never merged into `main`, so its retro never landed here. Nothing
below is a new measurement; it is the same measured facts, reformatted into
the required column set and re-scoped to SPEC-06 alone.

## Summary

| Date | Workflow | Plan | Agents | Cost Est | Cache % | Parallelism | Bottleneck | Duplications | Gaps | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-26 | SPEC-06 Multi-Agent Review — live 3-agent run on PR #491 | plans/13-multi-agent-review.md | 3 (General, Security, Performance) | $0.00165 total (3 agents, `deepseek/deepseek-v4-flash` via OpenRouter) | **13.8%** overall (1,024 / 7,397 prompt tokens across the 3 agents) — see "Cache % — live verification" below | 3 concurrent; batch wall-clock 210.8s vs solo ~23s — **not** 3×, per the lab's own instruction not to assume a linear ratio | Security reviewer — 210.8s vs General 15.4s / Performance 41.6s; one outlier LLM call dominated the whole batch | 6 of 7 findings conflicted across agents (e.g. one location: General flagged WARNING, Security and Performance both recorded "did not flag") | `feat/multi-agent-review` was built directly on what became the merge branch, not in the prescribed `../devdigest-review` worktree — caught only by a manual session audit, not by tooling | Feature merged to `main` (PR #14); this reconciliation branch's own retro was not — that gap is what this entry closes |

## Supporting detail

**Cache % — live verification (2026-09-08, this session):** the original
2026-08-26 run predates any cache-hit instrumentation, so Cache % couldn't
be recovered from it. Re-ran the same live 3-agent batch against the same
`acme/payments-api#491` PR twice this session with temporary instrumentation
in `reviewer-core/src/llm/openrouter.ts` (logged the raw OpenRouter
`usage.prompt_tokens_details` to a scratch file, removed immediately after —
`git diff reviewer-core/` is empty on this branch). First run (no
instrumentation, baseline sanity check): 57.8s total, $0.0018361 — consistent
with the original $0.00165 figure, confirming this is the same PR/agent set.
Second run (instrumented) measured real `prompt_tokens_details.cached_tokens`
per agent call:

| Agent | Prompt tokens | Cached tokens | Cache % |
|---|---|---|---|
| Security Reviewer | 2,775 | 1,024 | 36.9% |
| Performance Reviewer | 2,527 | 0 | 0% |
| General Reviewer | 2,095 | 0 | 0% |
| **Total** | **7,397** | **1,024** | **13.8%** |

Only one of the three agents got a cache hit, despite all three sharing the
same diff/repo-map prefix in their prompts. Likely cause: `run-executor.ts:357`
builds `sessionId` as `${repo}#{pr}:{agent.name}` — **one distinct session
per agent**, not one shared session for the batch — so OpenRouter's sticky
routing (keyed on `session_id`) has no guarantee of sending all three agents'
requests to the same warm provider replica. This matches OpenRouter's own
caveat that DeepSeek cache hits "may vary depending on how requests are
structured and routed." A shared `session_id` for the whole batch (all
agents on one PR) would likely raise this substantially, at the cost of the
routing isolation the current per-agent scheme presumably exists for — not
something to change without checking why D-P4/the run-executor chose
per-agent sessions in the first place.

**Cost/duration control (1 agent vs 3):** solo General-only run ~23s
(diff 17ms + intent 9.5s + review ~14s); batch of 3 was 210.8s total, not
3×23s — the shared diff/intent prep saved time, but one agent's outlier LLM
response kept the total from scaling either linearly or sub-linearly in a
predictable way.

**Merge conflicts (process, not product):** 4 textual conflicts during
reconciliation (`client/LEARNINGS.md`, `server/LEARNINGS.md`,
`client/src/lib/hooks/index.ts`,
`server/src/db/migrations/meta/_journal.json`) — all resolved by
concatenation or renumbering, zero logic changes — plus one semantic
collision: both branches independently generated a migration numbered
`0023` against the same shared dev Postgres instance, resolved by
renumbering `feat/export-to-ci`'s pair to `0024`/`0025`.

**Post-merge defect:** `MultiAgentResultsView.tsx` had a stale
`RunTraceDrawer` import path that a conflict-free `git merge` did not catch
— only surfaced by running `pnpm typecheck` as a deliberate post-merge step.

## Signals

1. **Handoff efficiency** — not applicable; no `Agent`/`SendMessage` calls
   were made in either the build or the reconciliation session for this run.
2. **Gap discovered, not injected** — `feat/multi-agent-review` was built on
   the wrong branch relative to the lab's worktree-isolation instructions;
   caught only by an independent audit against the lab's own verification
   step, not by anything failing loudly.
3. **A clean `git merge` is not proof of correctness** — the
   `RunTraceDrawer` import break passed the merge silently and was only
   caught by a separate, deliberate `pnpm typecheck` step afterward.

## Recommendations

✅ `Target: root CLAUDE.md`, "Conventions (non-default)" section — state
explicitly that this repo's local Postgres is shared across every git
worktree (one `docker compose` instance, not one per worktree), so two
worktrees generating migrations independently will collide on `idx` if both
touch schema in the same lesson. Justified by the migration-collision
near-miss in "Supporting detail" above.

✅ `Target: root CLAUDE.md`, "Gotchas" section — after merging two branches
whose specs both reference reusing the same shared component from different
call sites, run `pnpm typecheck` before trusting a conflict-free `git
merge` — a clean merge only proves no two branches touched the same lines,
not that cross-file references between them still resolve. Justified by
signal 3.

*(Both recommendations restate ones already made in commit `e4bfbeb`'s
version of this entry, which never reached `main` — marking them
`RECURRING (2nd instance)` would overstate it, since the first instance
never actually landed as a checked-in recommendation on this branch. Treat
these as first-landed here.)*
