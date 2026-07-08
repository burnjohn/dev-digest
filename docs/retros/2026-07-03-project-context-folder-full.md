# Retro: Project Context Folder — full spec→plan→implement run — 2026-07-03

**Sessions:** adbafdeb-e002-48a7-b703-091579dc8661 · **Plan:** docs/plans/2026-07-02-project-context-folder.md · **Mode:** deep

> Extends the earlier partial slice [2026-07-02-project-context-folder-spec.md](2026-07-02-project-context-folder-spec.md) ($12.48, spec→plan only). The same session id continued through implementation; this row captures the complete run.

## Metrics

| context | model | API calls | in (uncached) | cache-write | cache-read | out | cache-hit | wall | est. cost |
|---|---|---|---|---|---|---|---|---|---|
| main | claude-opus-4-8 | 158 | 43.1k | 1.92M | 53.94M | 431.2k | 96.5% | 892m25s | $57.16 |
| spec-creator — Create spec | claude-sonnet-5 | 18 | 18.7k | 197.8k | 1.33M | 2.1k | 86.0% | 8m45s | $1.23 |
| general-purpose — Feasibility check | claude-sonnet-5 | 8 | 14.4k | 58.8k | 322.7k | 1.8k | 81.5% | 1m13s | $0.39 |
| implementation-planner — Plan v1 | claude-sonnet-5 | 41 | 27.4k | 520.2k | 6.60M | 6.7k | 92.3% | 14m45s | $4.11 |
| implementation-planner — Plan v2 delta | claude-sonnet-5 | 68 | 23.5k | 790.9k | 15.76M | 2.9k | 95.1% | 30m15s | $7.81 |
| plan-verifier — pass 1 | claude-sonnet-5 | 29 | 7.1k | 111.9k | 2.34M | 6.9k | 95.2% | 5m06s | $1.24 |
| implementer — Step 1: cleanup | claude-sonnet-5 | 24 | 5.5k | 115.5k | 2.10M | 2.0k | 94.6% | 14m09s | $1.11 |
| implementer — Step 2: DB migration | claude-sonnet-5 | 73 | 11.2k | 504.7k | 8.60M | 5.8k | 94.3% | 17m08s | $4.59 |
| implementer — Step 3: shared contracts | claude-sonnet-5 | 36 | 9.7k | 211.1k | 3.25M | 3.3k | 93.6% | 7m06s | $1.85 |
| implementer — Step 4: context-docs module | claude-sonnet-5 | 78 | 14.3k | 175.5k | 10.70M | 6.0k | 98.3% | 12m21s | $4.00 |
| implementer — Step 5: attach routes | claude-sonnet-5 | 36 | 3.5k | 111.2k | 3.64M | 3.6k | 96.9% | 6m02s | $1.57 |
| implementer — Step 6: run-time injection | claude-sonnet-5 | 65 | 3.8k | 139.7k | 7.33M | 4.8k | 98.1% | 7m43s | $2.81 |
| implementer — Step 7: Project Context page | claude-sonnet-5 | 68 | 7.7k | 163.4k | 8.89M | 4.4k | 98.1% | 7m53s | $3.37 |
| implementer — Step 8: editors + trace UI | claude-sonnet-5 | 84 | 2.5k | 187.8k | 12.06M | 7.1k | 98.4% | 11m45s | $4.44 |
| test-writer — Step 9 server tests | claude-sonnet-5 | 69 | 5.3k | 226.6k | 10.92M | 4.9k | 97.9% | 11m46s | $4.22 |
| test-writer — Step 10 client tests | claude-sonnet-5 | 53 | 4.5k | 153.5k | 6.14M | 3.2k | 97.5% | 11m38s | $2.48 |
| architecture-reviewer — full review | claude-sonnet-5 | 16 | 5.2k | 88.4k | 989.5k | 3.2k | 91.4% | 2m16s | $0.69 |
| architecture-reviewer — re-review (scoped) | claude-sonnet-5 | 6 | 4.3k | 47.0k | 176.6k | 22 | 77.5% | 55s | $0.24 |
| implementer — Fix arch: container getter | claude-sonnet-5 | 32 | 7.6k | 133.1k | 3.19M | 2.0k | 95.8% | 4m58s | $1.51 |
| implementer — Fix 2 Phase-6 bugs + tests | claude-sonnet-5 | 42 | 3.1k | 97.0k | 3.07M | 4.8k | 96.8% | 5m15s | $1.37 |
| implementer — Fix: add nav item | claude-sonnet-5 | 20 | 3.5k | 71.2k | 1.30M | 2.0k | 94.6% | 3m31s | $0.70 |
| **TOTAL** | | 1024 | 225.9k | 6.02M | 162.66M | 508.9k | 96.3% | | **$106.89** |

Subagent share of cost: 46.5%.

Parallelism: 20 subagents, max concurrent **2**, sum-of-wall 184m30s over an 859m54s span (factor 0.2×). The span is inflated by a session left open ~15h — max-concurrent 2 is the real signal, not the factor.

Tool calls: Read:574 · Bash:381 · Grep:228 · Edit:164 · Glob:54 · Write:49 · Agent:21 · SendMessage:14 · PowerShell:13 · AskUserQuestion:10 · Skill:2

Files Read in ≥3 contexts (inject-per-run candidates):
- docs/plans/2026-07-02-project-context-folder.md — **15 contexts**
- server/insights.md — 12 · run-executor.ts — 11 · context-docs/service.ts — 11
- context-docs/helpers.ts, repository.ts, routes.ts — 10 each
- engineering-insights/SKILL.md — 9 · client/insights.md — 7 · agents/service.ts — 7 · contracts/context-docs.ts — 7 · feature-requirements spec — 6

## Insights

1. **The v2 re-plan was the single most expensive delegation ($7.81, 15.76M cache-read, 30m) — planning cost doubled to $11.92 across two passes.** The v2-delta planner cost *more* than the original v1 plan ($4.11) and re-derived a huge context cold instead of building on v1. This is the v1→v2 phasing that was flagged in project memory: the feature evolved after v1 was implemented+verified, forcing a fresh planning pass. A fully-scoped spec up front, or a v2 planner *continued* from v1's context via SendMessage, would have avoided most of it.

2. **20 subagents but max-concurrent 2 — implementation ran essentially serially.** Steps 1–8 have largely disjoint owned paths (DB migration, contracts, module, routes, injection, two pages, editors) yet almost never overlapped. Genuine serial dependencies exist (Step 5 routes need Step 3 contracts + Step 4 module; fix-loops follow reviews), but a 2-wide ceiling across 8 steps means the wave map under-parallelized. This is the biggest *time* lever (not a cost lever — serial vs parallel spends the same tokens).

3. **The plan file was re-read in 15 contexts and the 5 context-docs module files 10–11× each.** Every implementer/reviewer/test-writer re-discovered the same module. Per `orchestration-cost-habits`, the fix is per-run injection: hand each implementer *its step* + the module files it owns in the task prompt, not the whole plan to re-Read. This is the main subagent cache-read lever (subagents burned ~90M cache-read total).

4. **main (Opus) is again the top cost center — $57.16 / 53% — with 53.94M cache-read over a ~15h-open session.** Same lesson as the earlier slice, now larger: a single Opus orchestrator context carried spec+plan+all 8 steps+fixes forward. Running spec / plan / implement as *separate chats* would reset the main context between phases and shed most of that carry-forward. (The 892m wall also reflects idle time — the session sat open.)

5. **Gates fired correctly but each fix was a cold respawn.** The pipeline caught real issues — arch review → container-getter fix → scoped re-review; 2 Phase-6 bugs → fix; missing nav item → fix. Healthy. But the scoped re-review ran at **77.5% cache-hit** (cold start on a 55s / $0.24 task), and each fix-implementer respawned fresh. Continuing the original reviewer/implementer via SendMessage for follow-ups would kill that cold-start tax.

## Recommendations

| # | Action | Target | Expected effect |
|---|---|---|---|
| 1 | For phased features (v1→v2), either fully scope the spec before the first plan, or spawn the v2-delta planner as a **continuation** of the v1 planner (SendMessage) rather than a cold respawn | `/implement` re-plan step + how the orchestrator invokes implementation-planner for a delta | Cut most of the $7.81 v2 re-plan (15.76M cache-read) |
| 2 | Cut disjoint owned paths into explicit parallel waves and dispatch them concurrently (raise the 2-wide ceiling) | implementation-planner Phase 3 wave map + `/implement` wave dispatch (`.claude/skills/implement`) | Raise max-concurrent above 2 — wall-time win on 8 independent-ish steps |
| 3 | Inject each implementer's **specific step + the files it owns** into its task prompt instead of the whole plan; digest the plan per-step | `/implement` task-prompt composition (`.claude/skills/implement`) | Cut the 15× plan re-reads and 10–11× module re-reads (~subagent cache-read) |
| 4 | Run spec / plan / implement as **separate chats** to reset the Opus main context between phases | workflow habit — extend `orchestration-cost-habits.md` | Shed most of main's 53.94M cache-read carry-forward ($57 line item) |
| 5 | Continue reviewers/fixers via SendMessage for follow-up passes instead of cold respawn | `/implement` fix-loop dispatch (`.claude/skills/implement`) | Kill cold-start (77.5% → ~95%) on re-reviews and small fixes |

## Follow-up (applied 2026-07-03)
- [x] Rec #1 — **applied.** implementation-planner now has a **Delta Re-plan mode** (Phase 1 detects a prior plan for the same feature; writes a delta anchored to it — unchanged steps by reference, changed surface only — instead of re-deriving cold). Plan header gains a `Delta of:` line + "Changes from <prior-plan>" section. Orchestration trigger (name the prior plan / continue the instance via SendMessage) captured in `orchestration-cost-habits.md` habit #6.
- [x] Rec #2 — **applied.** implementation-planner: "MAXIMIZE WAVE WIDTH" note in the parallelization map + new anti-pattern. `/implement` Phase 1: "Maximize wave width" check before spawning each wave
- [x] Rec #3 — **applied.** `/implement` Phase 1: "Inject, don't point" — step text + owned/shared file digests into the task prompt
- [x] Rec #4 — **applied.** Separate-chats habit added as habit #4 in `orchestration-cost-habits.md`
- [x] Rec #5 — **applied.** `/implement` Phase 3 (re-verify) + Phase 5 (re-review) now continue the original verifier/reviewer via SendMessage; Hard Rules "Continue vs respawn" clarified
