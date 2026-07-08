---
name: workflow-retro
description: Manual retrospective of a multi-agent run (spec → plan → implement pipeline or any session with subagents). Computes real metrics from session transcripts on disk — tokens in/out/cache-read per context including nested subagents, cache-hit rate, tool calls, durations, parallelism — then turns them into insights, concrete recommendations, and a trend row in docs/retros/ledger.md. Run manually after a run worth analyzing; never triggered by hooks.
argument-hint: "[session-id[,session-id…] | latest] [quick]"
---

# Workflow Retro

You analyze how a multi-agent run *actually* went. Deterministic counting is done by the bundled script — never by pasting transcripts into context. Your job is the judgment on top: what the numbers mean and what to change.

**Why the script exists:** a parent context's `<usage>` does not include subagent spend — in-context estimates systematically undercount. The script reads the transcript files on disk (`~/.claude/projects/<slug>/<session>.jsonl` + `<session>/subagents/agent-*.jsonl`), dedupes usage by `requestId` (one API response is split across several JSONL lines), and reports every context separately.

## Modes

- **deep** (default) — full metrics from disk via the script.
- **quick** (arg `quick`) — no disk access: estimate from what this context saw, and say explicitly that subagent spend is missing from the numbers.

## Workflow (deep)

### 1 — Identify the run's sessions

A run may span several chats (spec chat, planning chat, implement chat). If the invocation names session ids, use them. Otherwise:

```sh
node .claude/skills/workflow-retro/scripts/analyze.mjs --list 10
```

Show the list (id · time · size · subagent count · title) and ask the user which session(s) make up the run. `latest` is a valid answer.

### 2 — Compute metrics

```sh
node .claude/skills/workflow-retro/scripts/analyze.mjs --session <id>[,<id>…]
```

The output is a markdown block: per-context table (main + every subagent with its agentType and task), totals, subagent cost share, parallelism (max concurrent, speedup factor), tool-call counts, and files Read in ≥3 contexts. Cost figures are API-list-price estimates — treat them as relative weights, not an invoice.

### 3 — Interpret

Walk this checklist against the numbers; every hit becomes an insight:

| Signal | Likely cause | Typical action |
|---|---|---|
| Cache-hit < 90% in a context | volatile prompt prefix, agent respawned instead of continued, 5m TTL expiring between waves | fix the invalidator; continue via SendMessage; reorder waves |
| A file Read in ≥3 contexts | every agent re-discovers the same shared file | paste its content (or a digest) into the task prompts, or preload it via the agent's `skills:`/brief |
| Parallelism factor ≪ wave plan | waves serialized by dependency that isn't real, or one long-pole task | re-cut the plan's owned paths; split the long task |
| One context dominates cost | oversized brief, unscoped exploration, huge tool outputs | tighten the agent brief; delegate sweeps to researcher; scope test runs |
| Tool anomalies (Edit ≫ Write = thrash; Grep storms = missing context; many tiny API calls = chatty loop) | plan step under-specified; agent lacks a map | add file paths and exact behavior to the plan step; add module map to the brief |
| Subagent share of cost surprisingly high/low | delegation balance off | merge trivially small agents into fewer tasks, or split monster tasks |

Also record what the metrics *can't* show but you observed: questions agents had to ask, gates that fired, fix-loop iterations used, anything missed until late.

### 4 — Write the artifacts

1. **Report** → `docs/retros/YYYY-MM-DD-<run-slug>.md` (template below). Date from `date +%F`, slug from the feature/plan name.
2. **Ledger row** → append to `docs/retros/ledger.md` via Edit (append-only — never rewrite existing rows). If the ledger doesn't exist, create it from the template below first.

### 5 — Answer

Deliver in chat: the metrics table, 3–5 insights ranked by impact, and the recommendations — each one naming the exact file or process to change (an agent's `.md`, a skill, the plan template, wave composition, concurrency). A recommendation without a target file/process is not done.

## Hard rules

- Manual invocation only — never wire this into hooks or run it unprompted.
- Never Read raw `.jsonl` transcripts into context; the script is the only reader. If the script errors on a schema change, fix the script, don't fall back to manual parsing.
- Ledger is append-only; one row per analyzed run, newest last.
- Costs are estimates at API list prices; say so wherever you quote them.

## Report template (`docs/retros/YYYY-MM-DD-<run-slug>.md`)

```markdown
# Retro: <run name> — YYYY-MM-DD

**Sessions:** <ids> · **Plan:** <docs/plans/… or —> · **Mode:** deep|quick

## Metrics
<script output pasted verbatim>

## Insights
1. <what the numbers show + what it means>

## Recommendations
| # | Action | Target | Expected effect |
|---|---|---|---|
| 1 | <concrete change> | <file / process> | <tokens/time/quality> |

## Follow-up
- [ ] <applied? tracked where?>
```

## Ledger template (`docs/retros/ledger.md`)

```markdown
# Workflow retro ledger

One row per analyzed run, appended by /workflow-retro (newest last). Costs are API-list estimates.

| Date | Run | Sessions | Contexts | In (uncached) | Cache-write | Cache-read | Out | Cache-hit | Est. cost | Max ∥ | Top action |
|---|---|---|---|---|---|---|---|---|---|---|---|
```
