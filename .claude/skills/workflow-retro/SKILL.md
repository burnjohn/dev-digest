---
name: workflow-retro
description: "Reports how a finished multi-agent run actually went — measured token cost per agent,
  launch order and spawn tree, what each agent found hard, what several agents read independently,
  and what the dispatch never covered. **Run only when the owner asks for it in so many words:**
  'retro on that run', 'розбір прогону', 'як пройшов запуск', 'подивись, як відпрацювали агенти',
  '/workflow-retro'. Sums `message.usage` across the session's own JSONL transcripts so every
  number is measured rather than recalled, separates what was observed from what an agent merely
  claimed, writes `docs/retros/NN-slug.md`, and *proposes* edits to agent and skill files without
  applying any. Not for capturing an engineering gotcha — that is `engineering-insights`; not for
  judging whether the code is right — that is `architecture-reviewer`; not for deciding whether a
  plan shipped — that is `plan-verifier`."
metadata:
  version: "1.0.0"
---

# workflow-retro

Answers exactly one question: **was this run's dispatch a good dispatch?**

Not *is the code correct* — that is `architecture-reviewer`. Not *did every REQ ship* — that is
`plan-verifier`. Not *what did we learn about the codebase* — that is `engineering-insights`. This
skill judges the **orchestration**: how the work was cut, how it was briefed, what it cost, and
which of those three a future run should change.

**Why it exists.** [`run-plan`](../run-plan/SKILL.md) writes nothing — its own §11 says *"The report
is the whole reply."* Every wave composition, every fix round, every verdict lives in one session's
transcript and then is gone. Meanwhile every `implementer` ends its report with
`### Insight candidates`, and [`docs/plans/README.md`](../../../docs/plans/README.md) gives that
section no consumer at all. So the two things worth knowing after a run — what it cost and what the
agents struggled with — are both produced and both discarded. This skill collects them.

**The rule that shapes everything below.** [`.claude/agents/README.md`](../../agents/README.md)
states it plainly: **an agent's own account of its work is a claim, not evidence.** A retrospective
assembled out of agent self-reports is therefore a pile of claims. Every section here is built to
keep the measured and the claimed in separate columns.

**Reference files** — read on demand, not up front:
- `references/report-template.md` — the retro file's sections, in order, with the fill-in text.
- `scripts/collect.mjs` — the telemetry collector. Run it; do not re-implement it by hand.

---

## 1. Scope

**In scope:** one session's dispatch record — the agents it launched, what they cost, what they
reported, and what a next run should do differently.

**Out of scope, hand these off:**

| Ask | Goes to |
|---|---|
| Is this code correct / well-placed | `architecture-reviewer` |
| Did every requirement actually ship | `plan-verifier` |
| Log a codebase gotcha for future sessions | `engineering-insights` |
| May this be pushed | `pr-self-review` — the owner's |
| Edit an agent or skill file | **the owner.** This skill proposes; it never applies. |
| Commit the retro | **the owner.** |

## 2. Invocation — manual only, and that is a guarantee

```
/workflow-retro [--session <id>] [--plan <path>] [--slug <name>]
```

**This skill never starts itself.** It is not wired to `SessionEnd`, `SubagentStop` or `Stop`; the
repo registers no hooks at all, and this skill adds none. It is not
chained from `run-plan`. It is not triggered by "wrap up", "what did we learn", or the end of a
session — those belong to `engineering-insights`, and the two must not race for the same moment.

If you find yourself reaching for this skill because a run just finished and nobody asked: **stop.**
That is the failure mode it was written to avoid.

| Flag | Effect |
|---|---|
| `--session <id>` | The session to analyse. Omitted: the most recently modified transcript, **named back to the owner before anything else**. |
| `--plan <path>` | A `docs/plans/NN-*.md` this run executed. Enables the wave/coverage columns; omit for a run that had no plan. |
| `--slug <name>` | Output filename. Omitted: derive from the plan or the session's title. |

**Finding the session id.** It is the UUID directory in the scratchpad path this session was given.
`node .claude/skills/workflow-retro/scripts/collect.mjs --list` prints every session with its
modification time and agent count.

## 3. Hard rules

1. **Never edit `.claude/agents/*.md`, `.claude/skills/**`, `AGENTS.md`, any `INSIGHTS.md`,
   `.claude/settings*.json` or `.claude/hooks/**`.** These are Tier A. Every improvement this skill
   finds is written as a *proposed* diff in the report, addressed to the owner.
2. **Never commit, stage, or push.** The retro file is left uncommitted like everything else.
3. **Never report `subagent_tokens` as tokens spent.** That figure is the agent's final-turn context
   size. Measured against summed `message.usage` it understates billable tokens by **2.9×–4.7×**
   (verified on three agents, this repo, 2026-08-25) and omits cache reads entirely. Use
   `tokens.billable` from the collector. If you show the reported figure at all, label it
   *peak context*.
4. **Never present a claim as a finding.** Anything traceable only to an agent's own report goes in
   the `Claimed` column and is marked `unverified` unless you checked it against the tree yourself.
5. **Never pad.** Same bar as `engineering-insights`: if a section has nothing that clears it, print
   the header and `_none_`. Deleting the section makes "we found nothing" indistinguishable from
   "we did not look".
6. **Never grade the agents.** "The reviewer did well" is not a finding. A finding names a file to
   change — an agent definition, a skill, a plan's task block, or a dispatch habit.

## 4. Phase 1 — collect (free, no LLM calls)

```bash
node .claude/skills/workflow-retro/scripts/collect.mjs --session <id> --out .devdigest/cache/workflow-retro/<session>.json
```

The collector streams the parent transcript and every `subagents/agent-*.jsonl`, and returns one
JSON document. **Read the JSON. Never read a raw transcript into context** — they run to 5 MB and
reading one destroys the very session writing the retro.

What it gives you, all measured:

| Field | Means |
|---|---|
| `totals.billable` | `input + output + cache_creation`, summed across the parent **and** every agent. The files are disjoint, so the sum does not double-count. |
| `totals.cacheRead` | Cache reads. Billed, but at a fraction — never fold this into one "tokens" number. |
| `agents.list[]` | One row per agent: type, description, model, `startedAt`, `durationMs`, `tokens.billable`, `toolUses`, `toolBreakdown`, `filesRead`, `filesWritten`, `zeroHitSearches`, `spawnDepth`, `parentAgentId`, `spawnedBySkill`. |
| `agents.peakConcurrency` | How many agents were actually in flight at once. |
| `agents.parallelismRatio` | Σ agent duration ÷ wall clock. **Below ~1.0 means the fan-out was sequential in practice** whatever the plan said. |
| `duplicateReads[]` | Files opened independently by two or more agents — the concrete, checkable form of "the same context was rediscovered N times". |
| `unmatched` | Dispatches with no agent transcript, notifications with no agent. Non-empty means the picture is incomplete — say so in the report. |

## 5. Phase 2 — the qualitative signal

Three sources, in descending order of trust:

1. **Measured, from the collector.** `duplicateReads`, `zeroHitSearches`, `toolBreakdown`,
   durations, concurrency. These are evidence.
2. **Each agent's `### Notes for the integrator`** — already mandated by `implementer` and already
   consumed by `run-plan`. Corrections to the plan, discrepancies, things the block got wrong.
3. **Each agent's `### Insight candidates`** — mandated by `implementer` and consumed by **nobody**.
   This is the unharvested channel for "what was hard". Collect every one of them.

Sources 2 and 3 are claims. Where a claim is cheap to check — a named file, a stated line, a
missing test — check it and promote it. Where it is not, keep it in the `Claimed` column.

**What each measured signal usually means:**

| Signal | Usual cause | Where the fix lands |
|---|---|---|
| One file in `duplicateReads` with 3+ readers | Context every agent needed, given to none of them | the plan's task block preamble, or a wave-0 artifact |
| `zeroHitSearches` for the same term across agents | The dispatch named something that does not exist | the plan, or the spec it came from |
| An agent's `filesRead` outside its `Owned paths` | The task was cut across the wrong boundary | wave composition |
| `parallelismRatio` well below 1 | Waves serialized on a dependency the plan missed | wave composition |
| Huge `promptChars`, small `reportChars` | Over-briefed for what it returned | the dispatch habit |
| Small `promptChars`, agent reports `BLOCKED` | Under-briefed | the agent file's required-inputs section |
| An agent reading `INSIGHTS.md` late in its run | The binding insight arrived after the code did | the task block's `Binding insights` |

## 6. Gates

| Gate | Fires when | Do |
|---|---|---|
| **G1** | No transcript for the session, or `agents.count` is 0 | Stop. Report that there is nothing to analyse — do not reconstruct a run from memory. |
| **G2** | `unmatched.dispatchesWithoutMeta` is non-empty | Continue, but state in the report which agents are missing and that the totals are floors. |
| **G3** | The owner did not ask for this | Stop. See §2. |
| **G4** | The run analysed is not the current session and `--session` was guessed | Name the session and its title back to the owner, and wait. |
| **G5** | Nothing clears the bar in §3.5 | Write the file with `_none_` sections rather than inventing findings. Say so in the reply. |

## 7. Phase 3 — write the file

Output goes to **`docs/retros/NN-<slug>.md`**, `NN` being the next free number in that directory
(the filenames are the registry; there is no index). The directory is committed on purpose — a
retro's value is the trend across runs, which a git-ignored cache would lose.

Sections and fill-in text are in `references/report-template.md`. None is optional.

The chat reply is **not** the file. It gets the banner, the headline numbers, the count of proposals
by target file, and the path — never the whole report.

~~~
**Retro:** `docs/retros/NN-<slug>.md` · session `<id>` · <n> agents · <peak> peak concurrent
**Measured:** <billable> billable tokens (+<cacheRead> cache reads) · <wall> wall · ratio <r>
**Proposals:** <n> — <k> to agent files, <m> to the plan, <j> to dispatch habit
**Gate:** <G1–G5, the one that fired; omit when none did>
~~~

## 8. Not done by this skill

No file under `.claude/` is edited, nothing is committed, no `INSIGHTS.md` is appended — that last
one stays with `engineering-insights` and the parent session, at the owner's word. The proposals in
§Proposals are diffs to read, not changes that were made.
