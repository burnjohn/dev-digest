# Retro: PR Why + Risk Brief — full spec→plan→implement run — 2026-07-04

**Sessions:** 632562c8-66a8-468e-97db-6d3cbcc8faa2 · **Plan:** [docs/plans/2026-07-03-pr-why-risk-brief.md](../plans/2026-07-03-pr-why-risk-brief.md) · **Mode:** deep

> Second full-pipeline run captured (after [2026-07-03-project-context-folder-full.md](2026-07-03-project-context-folder-full.md)). Spec, plan, cross-model review, 10 planned implementer steps, and ~13 reactive polish/fix agents all ran in a single main context.

## Metrics

| context | model | API calls | in (uncached) | cache-write | cache-read | out | cache-hit | wall | est. cost |
|---|---|---|---|---|---|---|---|---|---|
| main | claude-opus-4-8 | 148 | 33.6k | 603.4k | 48.29M | 339.2k | 98.7% | 234m34s | $38.82 |
| spec-creator — Spec for PR Why+Risk Brief | claude-sonnet-5 | 44 | 15.7k | 316.7k | 5.62M | 4.4k | 94.4% | 12m04s | $2.99 |
| implementation-planner — Plan for PR Why+Risk Brief | claude-sonnet-5 | 31 | 25.2k | 592.3k | 3.71M | 8.8k | 85.7% | 30m09s | $3.54 |
| general-purpose — Cross-model plan review | claude-sonnet-5 | 25 | 13.7k | 144.7k | 2.62M | 101 | 94.3% | 4m37s | $1.37 |
| implementer — Step 1 shared contract | claude-sonnet-5 | 22 | 3.1k | 93.5k | 1.56M | 2.9k | 94.2% | 3m06s | $0.87 |
| implementer — Step 2 repo upsert split | claude-sonnet-5 | 22 | 5.5k | 90.3k | 1.75M | 3.5k | 94.8% | 6m36s | $0.93 |
| implementer — Step 3 generator helpers | claude-sonnet-5 | 33 | 6.1k | 131.2k | 3.54M | 3.3k | 96.3% | 7m35s | $1.62 |
| implementer — Step 4 BriefGeneratorService | claude-sonnet-5 | 52 | 11.3k | 191.2k | 7.94M | 4.5k | 97.5% | 7m50s | $3.20 |
| implementer — Step 5 route + prompt | claude-sonnet-5 | 34 | 3.7k | 128.6k | 3.58M | 3.7k | 96.4% | 5m10s | $1.62 |
| implementer — Step 6 ReviewFocusCard | claude-sonnet-5 | 23 | 2.8k | 110.2k | 1.99M | 1.5k | 94.6% | 6m20s | $1.04 |
| implementer — Step 7 IntentCard enrichment | claude-sonnet-5 | 18 | 5.3k | 80.2k | 1.30M | 756 | 93.8% | 2m32s | $0.72 |
| implementer — Step 8 VerdictBanner | claude-sonnet-5 | 23 | 3.9k | 54.7k | 1.13M | 334 | 95.1% | 5m52s | $0.56 |
| implementer — Step 9 OverviewTab wiring | claude-sonnet-5 | 38 | 3.8k | 127.3k | 4.03M | 550 | 96.8% | 11m55s | $1.71 |
| implementer — Step 10 integration test | claude-sonnet-5 | 35 | 9.4k | 163.5k | 4.62M | 2.9k | 96.4% | 11m49s | $2.07 |
| implementer — Mirror contract to client | claude-sonnet-5 | 6 | 4.6k | 43.9k | 187.1k | 1.1k | 79.4% | 1m07s | $0.25 |
| implementer — Diff nav helper + SmartDiffViewer | claude-sonnet-5 | 24 | 2.9k | 64.7k | 1.38M | 4.4k | 95.3% | 4m55s | $0.73 |
| implementer — Meaningful line defaults from diff | claude-sonnet-5 | 44 | 3.0k | 97.1k | 3.90M | 6.2k | 97.5% | 6m30s | $1.64 |
| implementer — Hide line 1 suffix in path labels | claude-sonnet-5 | 16 | 3.5k | 49.3k | 811.7k | 2.0k | 93.9% | 2m55s | $0.47 |
| implementer — Fix duplicate file key in diff | claude-sonnet-5 | 9 | 3.7k | 52.6k | 364.2k | 1.0k | 86.6% | 2m20s | $0.33 |
| implementer — Fix diff scroll fallback | claude-sonnet-5 | 18 | 5.6k | 103.7k | 779.9k | 3.8k | 87.7% | 11m09s | $0.70 |
| implementer — Overview gating + RISK accordion + nav | claude-sonnet-5 | 80 | 5.7k | 160.0k | 9.92M | 4.6k | 98.4% | 15m42s | $3.66 |
| implementer — Restyle RISK AREAS cards | claude-sonnet-5 | 34 | 1.4k | 86.7k | 2.68M | 2.4k | 96.8% | 8m06s | $1.17 |
| implementer — Strengthen risk-brief prompt for risks | claude-sonnet-5 | 8 | 2.4k | 45.3k | 343.6k | 21 | 87.8% | 54s | $0.28 |
| implementer — Clear brief button UI | claude-sonnet-5 | 32 | 3.7k | 70.1k | 2.06M | 4.0k | 96.5% | 6m08s | $0.95 |
| implementer — DELETE brief route | claude-sonnet-5 | 15 | 8.9k | 90.3k | 1.03M | 1.3k | 91.2% | 3m07s | $0.69 |
| **TOTAL** | | 834 | 188.4k | 3.69M | 115.15M | 407.3k | 96.7% | | **$71.95** |

Subagent share of cost: 46.0%.

Parallelism: 24 subagents, max concurrent **4**, sum-of-wall 178m28s over a 229m59s span (factor 0.8×).

Tool calls: Read:426 · Bash:213 · Edit:166 · Grep:149 · Glob:38 · Agent:24 · Write:18 · SendMessage:9 · AskUserQuestion:8 · PowerShell:3 · Skill:2 · ToolSearch:1

Files Read in ≥3 contexts (inject-per-run candidates):
- `.claude/skills/engineering-insights/SKILL.md` — 15 contexts
- `docs/plans/2026-07-03-pr-why-risk-brief.md` — 12 contexts
- `server/src/vendor/shared/contracts/brief.ts` — 11 contexts
- `client/.../OverviewTab/IntentCard.tsx` — 10 contexts
- `client/insights.md` — 10 contexts
- `server/insights.md` — 10 contexts
- `client/.../OverviewTab/OverviewTab.tsx` — 9 contexts
- `server/src/modules/reviews/repository/pull.repo.ts` — 7 contexts
- `client/.../OverviewTab/styles.ts` — 6 contexts
- `server/src/modules/reviews/brief-composer.ts` — 6 contexts
- `server/src/modules/reviews/constants.ts` — 6 contexts
- `client/.../OverviewTab/IntentCard.test.tsx` — 6 contexts

## Insights

1. **Main is 54% of the run ($38.82) — the whole pipeline sat in one 234-minute main context.** Spec, plan, cross-model review, 10 planned steps and ~13 reactive fixes were all orchestrated from a single Opus context. Its cache-hit is excellent (98.7%), so the money is not waste-from-invalidation — it is the *volume* of orchestration: 148 API calls each re-reading a context that keeps growing as agent results land. This is the structural cost of doing spec→plan→implement→polish without ever resetting the session. Running the phases in separate sessions (per the `commit-and-session-workflow` convention) would have let main's context reset at each phase boundary instead of carrying spec+plan all the way through the 13th UI fix.

2. **The tail is reactive polish, not the plan.** The plan had 10 steps (Steps 1–10, ~$18). Everything after — "Mirror contract to client", "Diff nav helper", "Hide line 1 suffix", "Fix duplicate file key", "Fix diff scroll fallback", "Restyle RISK AREAS", "Strengthen risk-brief prompt", "Clear brief button", "DELETE brief route", "Overview gating + RISK accordion" — is ~13 agents (~$14) spawned one-at-a-time during manual UI testing. Several are cold (79–88% cache-hit, e.g. Mirror-contract 79.4%, duplicate-key 86.6%) and tiny (6–16 calls): they pay full spawn overhead without amortizing it.

3. **Parallelism improved to max-concurrent 4** (up from 2 in the prior full run) — the planned Steps 1–10 fanned out reasonably. But the factor is still 0.8× because the reactive tail is strictly serial: each polish fix waits on the previous one's visual verification. Parallelism can't help a debug-observe-fix loop; batching can.

4. **The OverviewTab surface is re-discovered by every UI implementer.** `brief.ts` (11), `IntentCard.tsx` (10), `OverviewTab.tsx` (9), `styles.ts` (6), `brief-composer.ts` (6) are all read across 6–11 contexts. These are the shared files the feature touches; each fresh implementer greps and reads them from scratch.

5. **What the numbers don't show:** the 8 `AskUserQuestion` calls + the reactive tail mean a lot of UI detail (line-default heuristics, path-label formatting, RISK card styling, clear/delete affordances) was discovered *after* the plan, through look-at-it iteration. The plan captured the data/route/component skeleton well but under-specified visual acceptance criteria, which is what generated the $14 tail.

## Recommendations

| # | Action | Target | Expected effect |
|---|---|---|---|
| 1 | Split the pipeline across sessions: spec chat → plan chat → implement chat → a separate polish chat. Don't carry spec+plan context through UI iteration. | `commit-and-session-workflow` memory + `implement` skill's session guidance | Resets main's carried context per phase; directly attacks the 54% / $38.82 main cost |
| 2 | Batch reactive UI fixes: collect a testing pass into 2–3 grouped implementer tasks (or fix true one-liners inline in main) instead of one cold agent per fix | main orchestration habit; note in `implement` skill | Removes ~10 cold-start spawns (each 79–88% cache-hit, $0.25–0.70); cuts the $14 polish tail |
| 3 | Embed an OverviewTab module digest (paths + signatures for `brief.ts`, `OverviewTab.tsx`, `IntentCard.tsx`, `styles.ts`, `brief-composer.ts`) into each UI implementer's task prompt | `implementation-planner` plan/task-prompt template | Kills re-discovery Grep/Read of the shared surface across 6–11 contexts |
| 4 | Add explicit visual acceptance criteria (line-default rules, path-label format, RISK card layout, clear/delete affordances) to plans for UI-heavy features | `implementation-planner` (Acceptance Criteria section) | Moves the reactive tail into the planned parallel wave; less serial observe-fix looping |

## Follow-up
- [ ] Rec 1 & 2 are behavioral — track by checking whether the next feature run keeps phases in separate sessions and whether the post-implement tail shrinks.
- [ ] Rec 3 & 4 need edits to the `implementation-planner` agent/template — not yet applied.
