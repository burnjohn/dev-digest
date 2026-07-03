---
name: engineering-insights
description: "Captures durable, non-obvious engineering insights into the touched package's INSIGHTS.md (client, server, reviewer-core, e2e). Use the moment you hit something a future session would otherwise relearn — a gotcha, a working approach, a dead-end antipattern, a codebase convention, a tool/library quirk, a recurring error+fix, or an open question — and again at the end of a session, on 'wrap up' / 'retro', or when /engineering-insights is invoked. Reads the existing file first, never duplicates, records only substantial file-grounded entries, and is strictly append-only (never overwrites)."
---

# Engineering Insights

Capture one durable engineering insight into the **INSIGHTS.md of the package the work touched**,
so the next session doesn't relearn it. Read what's already there, add only what's new and
substantial, never overwrite.

## Where to write (module routing)

| Work touched | File |
|---|---|
| client (`@devdigest/web`) | `client/INSIGHTS.md` |
| server (`@devdigest/api`) | `server/INSIGHTS.md` |
| reviewer-core (`@devdigest/reviewer-core`) | `reviewer-core/INSIGHTS.md` |
| e2e (`@devdigest/e2e`) | `e2e/INSIGHTS.md` |
| several packages | write the part relevant to each, to each file |
| pure root config / CI only | usually not a module insight — skip it |

Never write insights into this SKILL.md.

## The 7 sections (append each entry under the right one)
- **What Works** — an approach/solution that worked here.
- **What Doesn't Work** — dead ends and antipatterns. **Highest-value, most-skipped — prioritize it.**
- **Codebase Patterns** — conventions and architectural decisions.
- **Tool & Library Notes** — dependency quirks and gotchas.
- **Recurring Errors & Fixes** — an error you'd hit again + the fix.
- **Session Notes** — dated summaries under a `### YYYY-MM-DD` subheading.
- **Open Questions** — what's still unresolved.

## Concrete, not banal
Test before writing: **"if this were obvious to anyone reading the code, don't write it."**

| ❌ Noise | ✅ Useful (actionable cold) |
|---|---|
| "Zod can be tricky" | "adding a required field to `RunStats` breaks the inline fixture in `server/test/contracts.test.ts` — update it in the same change" |
| "be careful with migrations" | "new DB column = edit `db/schema/*.ts` then `pnpm db:generate`; never hand-write the SQL" |

## Entry format
```
- **YYYY-MM-DD** — <concrete, actionable insight>. Evidence: `path/file.ts:NN`.
```
Session Notes group under a dated subheading instead.

## Workflow
```
- [ ] 1. Gate check — was this session substantial (problem solved / decision made / non-obvious discovery)? If not → write nothing, stop.
- [ ] 2. Read the touched package's INSIGHTS.md before drafting.
- [ ] 3. Draft ≤5 candidates, ranked by signal (user corrections + gotchas highest).
- [ ] 4. Dedup against existing entries. Contradiction? Add a dated note that supersedes — never edit the old one.
- [ ] 5. Append survivors (append-only, automatic — no approval prompt).
- [ ] 6. One-line summary: what was written, to which file, what was skipped.
```

## Non-destructive write contract (hard rule)
- **Re-read the target INSIGHTS.md immediately before writing** — its state may have changed.
- Insert with an anchored **`Edit`** under the correct `##` heading. **Never `Write` an existing INSIGHTS.md** — `Write` replaces the whole file and destroys prior content.
- Preserve the header, preamble, every section heading, and every existing entry verbatim. New content is only ever *added*.
- Corrections are additive; idempotent — skip an entry that already exists.

## Honest limitation
Manual/description triggering is unreliable — it fires ~every other session. That's expected at
this stage; L06 replaces it with a Stop-hook so capture becomes automatic and doesn't depend on
anyone remembering.
