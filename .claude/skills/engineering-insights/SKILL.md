---
name: engineering-insights
description: "Recording non-obvious discoveries, dead ends, and working patterns found during development into {module}/insights/INSIGHTS.md. Use when you encounter unexpected behavior, work around a library quirk, discover why something failed, make an architectural decision with tradeoffs, or wrap up a substantive session (30+ min with a concrete problem and outcome). Covers client/, server/, reviewer-core/, e2e/. Trigger phrases: learned, discovered, realized, unexpected, gotcha, workaround, turns out, figured out, session wrap-up, engineering notes, non-obvious."
---

# Engineering Insights Recorder

Capture non-obvious discoveries and append them to `{module}/insights/INSIGHTS.md` so future sessions benefit. Read existing entries first to avoid duplicates. **Append-only — never rewrite existing content.**

---

## When to Run

Run when any of the following apply:

- You encounter behavior not obvious from reading the code for 5 minutes
- You find a dead end — something that does not work and the exact reason
- A library or tool behaves differently than documented
- An architectural decision was made with a concrete reason ("we chose X because Y")
- A recurring error pattern becomes clear with its root cause
- A session ran 30+ minutes with a concrete problem and resolution
- The user invokes `/engineering-insights` directly

Skip trivial sessions: config typo, rename, formatting change, comment edit, or no meaningful discovery.

---

## Algorithm

### 1. Detect touched modules

Identify modules touched this session by file paths read or modified:

| Path prefix | Module | INSIGHTS.md |
|-------------|--------|------------|
| `client/` | client | `client/insights/INSIGHTS.md` |
| `server/` | server | `server/insights/INSIGHTS.md` |
| `reviewer-core/` | reviewer-core | `reviewer-core/insights/INSIGHTS.md` |
| `e2e/` | e2e | `e2e/insights/INSIGHTS.md` |

Write to each module meaningfully touched. Root-only changes (scripts/, docker-compose) → attribute to most affected module.

### 2. Rank candidate insights by signal strength

Collect candidates in priority order (cap at 5 per module):

1. **User corrections** — user said "no, not like that" or corrected a mistake
2. **Failed approaches** — paths tried that didn't work, with the exact reason
3. **Repeated patterns** — same issue appeared 2+ times in the session
4. **Non-obvious solutions** — worked, but required investigation to discover
5. **Workflow discoveries** — process or tool behavior learned by doing

### 3. Apply the quality filter

For each candidate: **"Would this be obvious to anyone reading the relevant code for 5 minutes?"**

If yes → discard. Also discard:
- Vague statements without a specific fact
- General programming advice not specific to this codebase
- Content already present in `gotchas.md` or existing INSIGHTS.md
- Pure process notes ("I ran the tests")

| BAD — discard | GOOD — keep |
|--------------|------------|
| "Promises can be tricky" | "Promise.all() on the review pipeline times out after 30 items — use Promise.allSettled() with batches of 10" |
| "Be careful with async" | "SecretsProvider must be injected — LocalSecretsProvider is the only class that reads process.env" |
| "The server uses Fastify" | "`groundFindings()` returning empty array with score 100 is correct when LLM hallucinates all quotes — not an error" |

### 4. Classify each insight into one of 7 sections

| Section | Use for |
|---------|---------|
| **What Works** | Effective patterns confirmed in this codebase |
| **What Doesn't Work** | Dead ends with exact reason — *most skipped, most valuable* |
| **Codebase Patterns** | Project conventions, architectural decisions with reason ("chose X because Y"), DI wiring |
| **Tool & Library Notes** | Dependency quirks, CLI behavior, test infra specifics |
| **Recurring Errors & Fixes** | Common errors with root cause and exact fix |
| **Session Notes** | One datestamped summary per substantive session |
| **Open Questions** | Unresolved items with context to resume later |

When ambiguous, prefer **What Doesn't Work** over What Works.
Architectural decisions with rationale → **Codebase Patterns**.

### 5. Read existing INSIGHTS.md (if present)

Read the file in full before writing. Discard any candidate that is already captured — exact duplicate or substantively the same fact.

**Capacity check:** If the file has 180+ entries, include a warning in the output and suggest splitting into domain files (e.g., `INSIGHTS-auth.md`, `INSIGHTS-db.md`).

### 6. Create INSIGHTS.md if it doesn't exist

Use this template (substitute module name):

```markdown
# {Module} Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
```

### 7. Entry format

Every entry must be specific and locatable.

**Most sections:**
```
YYYY-MM-DD — Actionable fact specific to this codebase. ref: path/to/file.ts:line
```

**Session Notes:**
```
YYYY-MM-DD — [problem tackled] → [outcome/resolution]. Files: path1, path2.
```

**Open Questions:**
```
YYYY-MM-DD — [question with context to resume]. Investigated in: path/file.ts:line.
```

The `ref: file:line` anchor is mandatory for What Works / What Doesn't Work / Codebase Patterns / Recurring Errors entries.

### 8. Append — never overwrite

- Append each entry under its section header with a blank line between entries
- Never delete, reword, or replace existing entries
- If a section header is missing, add it at the end before appending
- Open question resolved later → add resolution entry in Recurring Errors or What Works; do not edit original Open Questions entry

---

## Output Report

After writing, report:

1. Which modules received entries
2. Number of entries written per module, by section
3. Entries discarded by quality filter and why (one line each)
4. Any capacity warnings (approaching 180+ entries)
5. Open questions recorded

Do not print the full INSIGHTS.md content unless asked.
