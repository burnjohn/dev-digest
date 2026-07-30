# Sections guide — LEARNINGS.md

Detailed guide for choosing the right section and writing quality entries.

## Section hierarchy (by value)

Most teams skip **What Doesn't Work** and **Decisions** — they are the highest-signal sections.

### What Doesn't Work ← highest value, most often skipped

Dead ends, anti-patterns, approaches tried and abandoned. A future session saves hours if it sees "this was tried and failed."

Format the dead-end explicitly:
> "Tried X → failed because Y → correct approach is Z"

### What Works

Approaches confirmed, patterns that reliably worked. Only write if non-obvious — if it's standard usage of a library, skip it.

### Codebase Patterns

Conventions and architectural decisions specific to this module. NEVER/ALWAYS rules that aren't derivable from reading the code.

### Decisions

Architectural choices with reasoning. Format:
> "Chose X over Y because Z"

Include the reason even if it seems obvious — the reason ages better than the decision.

### Recurring Errors & Fixes

The same class of mistake appeared more than once. The recurrence itself is the signal.

### Tool & Library Notes

Dependency quirks not in the official docs. Always cite version when the behavior is version-specific.

### Session Notes

Datestamped summary of what happened. One entry per session. Format:
> "YYYY-MM-DD — [what was worked on, main blocker, outcome]"

### Open Questions

Unresolved questions. Revisit next session. Remove when resolved (add a dated resolution note instead of deleting).

---

## Entry format reference

```
**YYYY-MM-DD** · **[Task type]** · [entry] · Confidence: high/medium/low
```

**Task types:** Module, Auth, DB, API, UI, Infra, Tests, Build, e2e, Review, Config

**Confidence:**
- `high` — reproduced, root cause understood, solution confirmed
- `medium` — worked in context, may have edge cases
- `low` — one observation, not verified

---

## Maintenance schedule

| Trigger | Action |
|---|---|
| 80–100 entries | Consolidation pass: merge duplicates, synthesize principles |
| ~200 entries | Split into domain files (LEARNINGS-auth.md, LEARNINGS-db.md) |
| Monthly | Prune: fixed bugs, updated libs, no-longer-relevant patterns |
| Conflicting entries | Add dated resolution entry; do not leave contradictions |
