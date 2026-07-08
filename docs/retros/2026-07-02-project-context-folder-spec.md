# Retro: Project Context Folder — spec → plan run — 2026-07-02

**Sessions:** adbafdeb-e002-48a7-b703-091579dc8661 · **Plan:** docs/plans/ (implementation-planner output) · **Mode:** deep

## Metrics

| context | session | model | API calls | in (uncached) | cache-write | cache-read | out | cache-hit | wall | est. cost |
|---|---|---|---|---|---|---|---|---|---|---|
| main | adbafdeb | claude-opus-4-8 | 47 | 16.8k | 241.1k | 5.50M | 102.8k | 95.5% | 41m04s | $7.82 |
| spec-creator — Create Project Context Folder spec | adbafdeb | claude-sonnet-5 | 18 | 18.7k | 197.8k | 1.33M | 2.1k | 86.0% | 8m45s | $1.23 |
| general-purpose — Feasibility check for in-browser doc editing | adbafdeb | claude-sonnet-5 | 8 | 14.4k | 58.8k | 322.7k | 1.8k | 81.5% | 1m13s | $0.39 |
| implementation-planner — Plan Project Context Folder feature | adbafdeb | claude-sonnet-5 | 34 | 19.7k | 393.0k | 4.84M | 4.3k | 92.1% | 6m51s | $3.05 |
| **TOTAL** | | | 107 | 69.7k | 890.8k | 12.00M | 111.0k | 92.6% | | **$12.48** |

Subagent share of cost: 37.4% — this is what the parent context never sees (in-context estimates undercount by exactly this).

Parallelism: 3 subagents, max concurrent 2, sum-of-wall 16m49s over a 35m41s span (factor 0.5×).

Tool calls: Read:89 · Bash:37 · Grep:31 · Edit:17 · Glob:8 · Agent:4 · SendMessage:4 · AskUserQuestion:3 · Write:3 · PowerShell:2 · Skill:1 · ToolSearch:1 · mcp__ccd_session__mark_chapter:1

Files Read in ≥3 contexts (pre-fetch / preload candidates):
- reviewer-core/src/prompt.ts — 3 contexts
- server/src/vendor/shared/contracts/trace.ts — 3 contexts
- server/insights.md — 3 contexts
- server/src/adapters/git/simple-git.ts — 3 contexts

## Insights

1. **The main (Opus) orchestrator is the cost center, not the workers — $7.82 / 63% of spend.** Its 5.50M cache-read means the full spec, feasibility report, and plan were all relayed back into the parent context and carried forward on every subsequent turn. The subagents (Sonnet) are cheap; the expensive thing is the Opus context re-reading everything the workers produced. Cache-hit there is healthy (95.5%), so this is volume, not churn — the parent simply holds too much.

2. **Both single-shot Sonnet subagents ran cold (86% / 81.5% cache-hit).** spec-creator and the feasibility agent each pay a cold-prefix penalty because they're spawned fresh and never continued. For one-shot agents this is largely unavoidable, but the feasibility agent (8 calls, $0.39, 81.5%) is small enough that its cold start is a meaningful fraction of its own cost — a candidate for folding into the spec-creator brief rather than a separate spawn.

3. **Four shared files were re-Read across 3 contexts each** (prompt.ts, trace.ts, server/insights.md, simple-git.ts). Every agent independently re-discovers the same grounding files. Read:89 total is the single largest tool category — a large share is this redundant re-discovery.

4. **Parallelism factor 0.5× is expected here, not a defect.** This is a spec → plan pipeline: the planner cannot start until the spec exists, so serialization is real dependency, not a mis-cut wave. The only genuinely parallelizable unit — the feasibility check — did overlap (max concurrent 2). No action needed on wave structure.

5. **Metrics can't show it, but the run used 3 AskUserQuestion round-trips and 4 SendMessage relays** — consistent with the spec-creator's iterative-questioning design and the Ukrainian-relay handoff. The run completed spec + plan in one session without a re-plan loop, which is the healthy outcome.

## Recommendations

| # | Action | Target | Expected effect |
|---|---|---|---|
| 1 | Have the parent relay a **digest** of subagent output (spec ID + section headers + acceptance criteria), not the full artifact text, keeping full docs on disk and re-reading on demand | orchestration prompt / how spec-creator & implementation-planner report back (`.claude/agents/spec-creator.md`, `implementation-planner.md`) | Cuts main's 5.50M cache-read carry-forward — the largest single line item (~$7.82) |
| 2 | Preload the 4 recurring grounding files into agent briefs instead of letting each agent re-Grep/Read them | `.claude/agents/spec-creator.md` + `implementation-planner.md` (add a "context files" block: prompt.ts, trace.ts, server/insights.md, simple-git.ts) | Removes ~2–3 redundant Reads per agent; trims Read:89 |
| 3 | Fold the "in-browser doc editing feasibility" probe into the spec-creator's own research phase rather than spawning a separate general-purpose agent | spec-creator workflow (`.claude/agents/spec-creator.md`) | Eliminates one cold-start spawn (81.5% cache-hit, $0.39) and its relay round-trip |

## Follow-up

On execution (2026-07-02) all three recs proved to be **orchestration-level, not agent-def edits**:

- [x] Rec #1 — **already satisfied in the agent defs.** Both spec-creator (report step: path + AC count + open items) and implementation-planner (path + step count + mode) already return digests; their out-tokens were tiny (2.1k / 4.3k). The 5.50M cache-read lives in the main Opus context carrying spec/plan text forward — a main-behavior lever, not an agent file. Captured as habit.
- [x] Rec #2 — **not applied as written; would be harmful.** The 4 files are feature-specific to this run; hardcoding them into agent briefs violates the "preload only always-needed" canon and would load noise into every other run. `server/insights.md` is already covered by Mode C. Correct form = per-run injection into the task prompt. Captured as habit.
- [x] Rec #3 — **agent already supports it.** spec-creator has Research Delegation; the feasibility probe was a `general-purpose` agent spawned by main, so the fix is main routing feasibility through spec-creator's `researcher`. Captured as habit.

All three folded into memory `orchestration-cost-habits.md` (main-context habits), since none is an agent-def change.
