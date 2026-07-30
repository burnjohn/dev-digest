---
name: engineering-insights
description: "Captures and persists non-obvious engineering learnings to the module's LEARNINGS.md. Use at session end OR immediately when something non-obvious surfaces mid-session: a bug fixed non-obviously, an architectural decision made, a tool quirk discovered, a dead end found, or a user correction issued. Assesses session depth before capturing — skips trivial sessions. Writes append-only, checks for duplicates before writing. Target files: server/LEARNINGS.md, client/LEARNINGS.md, reviewer-core/LEARNINGS.md, e2e/LEARNINGS.md."
metadata:
  tags: learnings, memory, insights, wrap-up, knowledge-capture, session
---

## Session start (mandatory, silent)

Before responding to any user prompt, silently read the LEARNINGS.md of the module the conversation is about. Apply that knowledge — do not announce that you read it.

Module detection:
- Conversation about `server/` → read `server/LEARNINGS.md`
- Conversation about `client/` → read `client/LEARNINGS.md`
- Conversation about `reviewer-core/` → read `reviewer-core/LEARNINGS.md`
- Conversation about `e2e/` → read `e2e/LEARNINGS.md`
- Multiple modules → read all relevant ones

## Gate check — assess session depth before capturing

Before deciding to write at session end, assess session depth:

**Full capture** (session is substantial): 10+ user messages, tool usage, errors encountered, corrections issued, or architectural decisions made → proceed to capture up to 5 candidates.

**Skip capture** (session is brief): Fewer than 3 user messages, no tools used, no errors, no discoveries → write nothing. Silence is correct.

## Candidate priority order

When extracting learnings, rank candidates in this order — higher ranked items should displace lower ones if space is limited:

1. **User corrections** — something the agent got wrong and the user corrected (highest signal)
2. **Failed approaches** — dead ends, anti-patterns, things tried and abandoned
3. **Repeated patterns** — same class of issue appeared more than once
4. **Error patterns** — bugs with non-obvious root causes
5. **Workflow observations** — architectural decisions, tool quirks, conventions confirmed

## Anti-banality test

Before writing every candidate: **"Would this be obvious to anyone reading the code?"**
- Yes → discard
- No → proceed

Concrete form is better than abstract: `"Avoid relative imports in /utils"` is useful; `"Be careful with imports"` is not.

See `examples.md` for good vs bad entries.

## Duplicate check (mandatory before writing)

Re-read the target LEARNINGS.md immediately before writing. If the insight already exists — skip it. Do not write a paraphrase of an existing entry.

## Entry format

```
**YYYY-MM-DD** · **[Task type]** · [entry — actionable, specific, file:line where relevant] · Confidence: high/medium/low
```

Entry must be:
- **Actionable "cold"** — reader has zero context but knows exactly what to do
- **Specific** — cite `file:line` when tied to a code location
- **Declarative** — NEVER/ALWAYS for hard rules; plain past tense for observations
- **One line** — no paragraphs; terse format optimised for LLM consumption

## Sections

See `references/sections.md` for full section guide. Quick reference:

| Section | When to use |
|---|---|
| **What Works** | Pattern confirmed, approach that reliably worked |
| **What Doesn't Work** | Dead end, anti-pattern — most valuable, most often skipped |
| **Codebase Patterns** | Convention or architectural decision for this module |
| **Decisions** | Choice made + reason: "chose X over Y because Z" |
| **Recurring Errors & Fixes** | Same class of mistake appeared more than once |
| **Tool & Library Notes** | Dependency quirk — cite version when relevant |
| **Session Notes** | Datestamped summary of what happened |
| **Open Questions** | Unresolved — revisit next session |

## How to write an entry

1. Assess session depth via gate check — if brief, stop
2. Rank candidates by priority order above
3. Run anti-banality test on each — discard if obvious
4. Re-read target LEARNINGS.md — skip if insight already exists
5. Write entry: date · task type · substance + `file:line` · confidence
6. Append under matching section — **never edit existing entries**
7. To correct a wrong entry: add a dated correction note below, do not delete

## Maintenance thresholds

- **80–100 entries** → trigger consolidation: merge duplicates, synthesize principles, prune stale entries
- **~200 entries max** → split into domain files (`LEARNINGS-auth.md`, `LEARNINGS-db.md`, etc.)
- **Monthly review** → delete entries about fixed bugs, updated libraries, no-longer-relevant patterns
- **LEARNINGS is a draft** — LLM can mis-summarise; human spot-checks the output
- **Conflicting entries** → resolve with a dated decision entry; do not leave contradictions

## Consolidation (periodic, not session-end)

At 80–100 entries, run a consolidation pass:
1. Remove outdated, superseded, or inapplicable entries
2. Merge duplicate or closely related entries
3. Identify patterns → write synthesized principles into a `## Consolidated Principles` section
4. Flag entries needing `[REVIEW NEEDED]`

This is a separate operation from regular wrap-up — do not run it at session end.
