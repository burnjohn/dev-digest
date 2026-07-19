# L04 stretch — Pre-push CLI (`devdigest review --mode working`)

Get a review **in your working copy, before `git push`** — reusing the exact
Structured Reviewer that reviews PRs on the UI. Same agent, same findings, new
entry point. No server, DB, or GitHub.

## Design — one seam, three thin pieces

`reviewPullRequest` (the pure engine in `@devdigest/reviewer-core`) already takes
`(diff + resolved agent inputs + injected LLM) → grounded Review`. The CLI is
just a **new caller** of it:

```
git diff <mode>  →  parseUnifiedDiff  →  reviewPullRequest(SAME engine)  →  renderReview  →  stdout
```

| File | Role | Pure? |
|---|---|---|
| `server/src/cli/diff.ts` | `getDiff(mode, runGit)` — mode → `git diff` selector (`working`=`diff HEAD`, `staged`=`--cached`, `branch`=`base...HEAD`) | injectable `runGit` |
| `server/src/cli/render.ts` | `renderReview(review)` — terminal report (severity glyphs, `file:line`, summary, blockers-first) | ✅ pure |
| `server/src/cli/run.ts` | `runReviewCli(deps)` — orchestrate; empty diff → empty state + **0 model calls**; blockers → exit 1 | injectable git/llm/write |
| `server/src/cli/index.ts` | thin I/O shell — argv + real `OpenRouterProvider` + `GENERAL_REVIEWER_PROMPT` + `process.exit` | — |
| `bin/devdigest` | launcher (`bin/devdigest review --mode working`) | — |

`--mode working` is the headline; `staged` / `branch` are the same seam with a
different selector — room for future modes, as the spec calls out.

## TDD — 14 tests (P0/P1), hermetic (no Docker, no network)

**diff selector (`cli-diff.test.ts`)** — D.P0.1 working=`diff HEAD` · D.P0.2 fresh-repo fallback to `diff` · D.P1.1 staged=`--cached` · D.P1.2 branch=`base...HEAD` · D.P1.3 unknown mode throws.

**renderer (`cli-render.test.ts`)** — R.P0.1 file:line+severity+title+suggestion · R.P0.2 empty → "no issues" (not blank) · R.P1.1 blockers-first + counts · R.P1.2 single-line collapses, ranges kept.

**orchestrator (`cli-run.test.ts`)** — C.P0.1 diff → **same engine** (`completeStructured` runs) → grounded findings printed · C.P0.2 empty tree → empty state + **ZERO model calls** (provider never built) · C.P1.1 CRITICAL → exit 1 (pre-push hook) · C.P1.2 grounding drops phantom → exit 0.

## Acceptance (verified live)

- `--mode working` on a planted vuln → 5 grounded findings (2 critical, 3 warnings) on the right lines, `score 0/100`, **exit 1**.
- `--mode staged` clean tree → "Nothing to review", **exit 0**, no network call.
- Reuses `reviewPullRequest` verbatim — zero engine duplication.
