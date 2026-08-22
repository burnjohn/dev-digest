---
name: engineering-insights
description: Captures non-obvious engineering insights into the touched module's INSIGHTS.md (client, server, reviewer-core, e2e). Use during a session the moment you hit something a future agent would otherwise relearn — a gotcha, a working approach, a dead-end antipattern, a codebase convention, a tool/library quirk, a recurring error+fix, or an open question — and again at session end, on "wrap up" / "retro", or when /engineering-insights is invoked. Reads the existing file first, never duplicates, writes only substantial file-grounded entries, and is strictly append-only (never overwrites).
---

# Engineering Insights

Capture one durable engineering insight into the **INSIGHTS.md of the module the work
touched**, so the next session doesn't relearn it. Read what's already there, add only
what's new and substantial, never overwrite.

## Where to write (module routing)

Write to the file of the package the work actually touched:

| Work touched | File |
|---|---|
| client (`@devdigest/web`) | `client/INSIGHTS.md` |
| server (`@devdigest/api`, incl. repo-intel) | `server/INSIGHTS.md` |
| reviewer-core (`@devdigest/reviewer-core`) | `reviewer-core/INSIGHTS.md` |
| e2e (`@devdigest/e2e`) | `e2e/INSIGHTS.md` |
| spans several packages | write the part relevant to each, to each file |
| pure root config / CI only | usually not a module insight — skip it |

Never write insights into this SKILL.md itself.

## What counts (the 7 sections)

Each `INSIGHTS.md` has fixed sections — append each entry under the right one:

- **What Works** — an approach/solution that worked here.
- **What Doesn't Work** — dead ends and antipatterns. **Highest-value section, most often skipped — prioritize it.**
- **Codebase Patterns** — conventions and architectural decisions.
- **Tool & Library Notes** — dependency quirks and gotchas.
- **Recurring Errors & Fixes** — an error you'd hit again + the fix.
- **Session Notes** — dated session summaries (use a `### YYYY-MM-DD` subheading).
- **Open Questions** — what's still unresolved.

## Concrete, not banal

Test before writing: **"If this were obvious to anyone reading the code, don't write it."**

| ❌ Noise | ✅ Useful (actionable cold) |
|---|---|
| "Promises can be tricky" | "`Promise.all()` on the ingest pipeline times out after 30 items — use `Promise.allSettled()` in batches of 10" |
| "be careful with context enrichment" | "context enrichment is best-effort: on unindexed/error, omit the section, never throw — `server/...:NN`" |

## Entry format

Append a bullet under the matching `##` section:

```
- **YYYY-MM-DD** — <concrete, actionable insight>. Evidence: `path/file.ts:NN`.
```

Session Notes instead group under a dated subheading:

```
### YYYY-MM-DD
- <what the session accomplished / decided, one line per point>
```

## Workflow

Copy this checklist and work through it:

```
- [ ] 1. Gate check — was this session substantial?
- [ ] 2. Read the touched module's INSIGHTS.md
- [ ] 3. Draft ≤5 candidates, ranked by signal
- [ ] 4. Dedup against what's already there
- [ ] 5. Append automatically (append-only)
- [ ] 6. One-line summary
```

1. **Gate check.** Did the session produce something substantial — a problem solved, a decision made, a non-obvious discovery? If not → **write nothing** and stop.
2. **Read first.** Open the touched module's `INSIGHTS.md` before drafting anything.
3. **Draft ≤5 candidates**, ranked by signal (user corrections and gotchas highest; nice-to-know patterns lowest). Each candidate = the exact proposed line + its target section + `file:line` evidence.
4. **Dedup.** Drop any candidate already covered by an existing entry. If reality contradicts an old entry, add a new dated note that supersedes it — never edit the old one.
5. **Append** the survivors (automatic mode — no approval prompt). If nothing substantial survives gate + dedup, write nothing.
6. **Summary.** One line: what was written, to which file, what was skipped.

## Non-destructive write contract (hard rule)

This skill is **append-only** and must never clobber existing content:

- **Re-read the target `INSIGHTS.md` immediately before writing** — its state may have changed since the session started.
- **Insert with an anchored `Edit`** that adds the new bullet under the correct `##` heading. **Never use the `Write` tool on an existing `INSIGHTS.md`** — `Write` replaces the whole file and would destroy prior content.
- **Preserve verbatim** the `# Insights — …` header, the preamble, every section heading, and every entry already in the file. New content is only ever *added*.
- **Corrections are additive** — supersede a wrong entry with a new dated note; do not rewrite or delete the old one.
- **Idempotent** — if an equivalent entry already exists, skip it (no duplicate, no rewrite).

## Maintenance (not per-session)

Append-only keeps the file growing, so keep it lean out of band: prune monthly (drop
fixed-bug, duplicate, and never-needed entries), aim for ~30 high-value entries per file
before splitting into domain files, and treat the file as a reviewed draft — spot-check it,
since an incorrect entry propagates to every future session until corrected.
