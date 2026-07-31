---
name: engineering-insights
description: >-
  Read and record per-module engineering insights in that module's INSIGHTS.md so
  a future agent never relearns them. Insight types: gotcha, working approach,
  dead-end antipattern, codebase convention, tool/library quirk, recurring
  error+fix, open question. Use this skill at the START of any task (first read
  the touched module's INSIGHTS.md and apply it), the MOMENT you hit something
  worth capturing, and at the END of a session — also on "wrap up" / "retro",
  when the user says "record this" / "log an insight", or when
  /engineering-insights is invoked. Reads the file first, never duplicates, writes
  only substantial file-grounded entries, strictly append-only (uses Edit, never
  Write; never overwrites).
---

# Engineering Insights

Per-module memory. Knowledge lives next to the code it's about, so the next
session in a module reads its own lessons, not others'. Read what's already
there, add only what's new and substantial, never overwrite.

## Where to read / write (module routing)

Use the file of the package the work actually touched:

| Work touched | File |
|--------------|------|
| client (`@devdigest/web`) | `client/INSIGHTS.md` |
| server (`@devdigest/api`, incl. repo-intel) | `server/INSIGHTS.md` |
| reviewer-core (`@devdigest/reviewer-core`) | `reviewer-core/INSIGHTS.md` |
| e2e (`@devdigest/e2e`) | `e2e/INSIGHTS.md` |
| spans several packages | write the part relevant to each, to each file |

## 1. At task start — READ

Before doing work, read the `INSIGHTS.md` of the module the task touches (the one
being changed or discussed) and apply it — don't rediscover known gotchas.
Touching several modules → read each.

## Insight types (what's worth capturing)

Capture the moment you hit one of these — something a future agent would
otherwise relearn:

- **gotcha** — a surprising failure mode or footgun
- **working approach** — a solution that proved effective and should be reused
- **dead-end antipattern** — an approach that failed; avoid it
- **codebase convention** — "always do X here, because Y"
- **tool/library quirk** — non-obvious behavior of a dep, build, or test tool
- **recurring error+fix** — an error seen more than once and its fix
- **open question** — an unresolved unknown worth flagging for next time

## 2. Session-end / wrap-up — WRITE workflow

1. **Gate check.** Did the session produce something substantial — a problem
   solved, a decision made, a non-obvious discovery? If not → **write nothing**
   and stop.
2. **Read first.** Open the touched module's `INSIGHTS.md` before drafting.
3. **Draft ≤5 candidates**, ranked by signal (user corrections and gotchas
   highest; nice-to-know patterns lowest). Each candidate = the exact proposed
   line + its target section + **`file:line` evidence**.
4. **Dedup.** Drop any candidate already covered by an existing entry. If reality
   contradicts an old entry, add a new dated note that **supersedes** it — never
   edit the old one.
5. **Append** the survivors (automatic mode — no approval prompt). If nothing
   substantial survives gate + dedup, **write nothing**.
6. **Summary.** One line: what was written, to which file, what was skipped.

**The bar — actionable "cold":** the next agent reads the entry and knows what to
do, with no re-investigation. Test: *"if this were obvious to anyone reading the
code, don't write it."*

- ❌ "be careful with async" · "Promises can be tricky"  (noise, not a lesson)
- ✅ "Promise.all() on the ingest pipeline times out after ~30 items — use
  Promise.allSettled() in batches of 10"
- ✅ "reviewer-core drops findings citing lines outside the diff (grounding.ts) —
  emit real diff line refs or the finding vanishes silently"

## Non-destructive write contract (hard rule)

This skill is **append-only** and must never clobber existing content:

- **Re-read** the target `INSIGHTS.md` immediately before writing — its state may
  have changed since the session started.
- **Insert with an anchored `Edit`** that adds the new entry under the correct
  heading. **Never use the `Write` tool on an existing `INSIGHTS.md`** — `Write`
  replaces the whole file and would destroy prior content.
- **Preserve verbatim** the `# <module> — Insights` header, the preamble, every
  section heading, and every entry already in the file. New content is only ever
  *added*.
- **Corrections are additive** — supersede a wrong entry with a new dated note;
  do not rewrite or delete the old one.
- **Idempotent** — if an equivalent entry already exists, skip it (no duplicate,
  no rewrite).

## Entry format (newest first)

Prepend the new entry directly under the `## Format` block. Replace
`_No entries yet._` on the first write. Use today's real date (run `date +%F` if
unsure).

    ## YYYY-MM-DD — <short, specific title>  [<insight type>]
    **Problem:** <symptom / what surprised you>
    **Decision:** <the concrete rule/fix to apply next time>
    **Why:** <mechanism> — evidence: `path/to/file.ts:123`

## Maintenance (not per-session)

Do **not** do this during a normal session. Occasionally (when asked, or when a
file grows unwieldy): remove obsolete entries, merge duplicates, and resolve
contradictions left by superseding notes. Keep each `INSIGHTS.md` at a readable
size so the start-of-task READ stays cheap.
