---
name: engineering-insights
description: "Reads and updates each package's Insights.md — the running log of project-specific gotchas, decisions, fixes, and open questions discovered while working in this repo. Use before starting substantive work in a package (read its Insights.md first and treat it as high-confidence guidance) and whenever a session surfaces something non-obvious worth keeping (a fix, a workaround, a decision with a rationale, a recurring error, an unresolved question) — including at the end of a working session via /engineering-insights."
---

# Engineering Insights

`Insights.md` is per-package institutional memory: notes a past session left
for the next one, so the same non-obvious discovery doesn't have to be
re-made from scratch. It is not a chat transcript and not a substitute for
`README.md`/`docs/` — it holds what isn't derivable by reading the code.

## Where insights live

| Scope | File |
|---|---|
| Cross-cutting (touches more than one package) | [`Insights.md`](../../../Insights.md) (root) |
| `server` | [`server/Insights.md`](../../../server/Insights.md) |
| `client` | [`client/Insights.md`](../../../client/Insights.md) |
| `reviewer-core` | [`reviewer-core/Insights.md`](../../../reviewer-core/Insights.md) |
| `e2e` | [`e2e/Insights.md`](../../../e2e/Insights.md) |

If work spans packages, check the root file plus every package involved.

## Before starting work

Read the relevant `Insights.md` file(s) before writing code. Don't just load
it silently — briefly note (to yourself or the user) the 1-3 points most
relevant to the task at hand. That forced summary is what makes the read
register rather than pass through unused, and it's a cheap sanity check that
the file was actually read. Treat its contents as high-confidence guidance
unless something in the current session contradicts it — in which case fix
the entry (see "Keeping it correct" below) rather than silently ignoring it.

## The seven sections

Every `Insights.md` uses these fixed section headers, in this order. Append
new bullets to the section they belong in — don't invent new headers.

- **What Works** — approaches, patterns, and solutions that have proven
  effective.
- **What Doesn't Work** — dead ends and antipatterns to avoid. This is the
  section most often skipped and the most valuable one — a wrong turn
  someone else already took is worth more than another confirmation of the
  happy path.
- **Codebase Patterns** — conventions and architectural decisions specific
  to this package.
- **Tool & Library Notes** — quirks or gotchas about a dependency (versions,
  limits, surprising defaults).
- **Recurring Errors & Fixes** — an error that has bitten more than once,
  paired with its fix.
- **Session Notes** — dated, one-line summaries of what a substantive
  session accomplished or discovered. Only entries here carry a date; the
  other sections describe durable facts, not events.
- **Open Questions** — things left unresolved that a future session should
  investigate.

Leave a section as `_None yet._` rather than deleting the header — an empty
section is still telling the next reader where to look.

## Quality bar: actionable "cold"

A reader who has never seen this session must be able to read the entry and
know exactly what to do or avoid — without re-investigating. Run every
candidate entry through this test: **if this would be obvious to anyone who
reads the code, don't write it.**

Bad (vague, no signal):
- "Promises can be tricky."
- "Be careful with async here."

Good (specific, actionable, grounded):
- "`Promise.all()` in the ingest pipeline times out after ~30 elements — use
  `Promise.allSettled()` batched 10 at a time instead."
- "Checkout-flow state always goes through Zustand (`cartStore.ts`) — the
  cart is shared by 3 components, local state silently breaks it."

Where it helps, ground the entry with evidence: a file:line reference or a
commit hash (the existing root/server files already do this — see the
`ERR_MODULE_NOT_FOUND` entries).

## When to write

Two triggers, both in play:

1. **As you go** — the moment something non-obvious surfaces (a dead end, a
   workaround, a rationale that took real digging to find), capture it
   immediately rather than trusting yourself to remember it at wrap-up.
2. **End of a substantive session** — a session that involved a real
   problem, a decision, or a discovery (roughly 30+ minutes of engaged work).
   Trivial edits (a config tweak, a typo fix) don't need a Session Notes
   entry — volume of entries is not the goal, signal is.

If neither trigger fired — nothing non-obvious came up — write nothing.
Padding the file with restatements of what the code already makes obvious
makes it worse, not better.

## Before writing: read, then dedupe

Always re-read the target section before appending. If the insight (or a
close variant of it) is already there, don't add a duplicate — leave it
alone, or if the existing entry is now wrong/outdated, correct it in place
(update the text; don't leave two contradicting bullets).

## Append-only, otherwise

Outside of fixing your own duplicate or a now-incorrect entry, add — don't
rewrite or delete other entries while doing routine work. That's what causes
merge conflicts and erased lessons when more than one session (or person)
touches the file. Bulk cleanup is a deliberate, separate activity (see
below), not something to do inline while capturing a new insight.

## Keeping it correct over time

- **Prune periodically.** An entry can go stale — a dependency upgrade can
  turn a documented quirk into noise or even actively wrong advice. Sweep
  for staleness now and then rather than letting it silently accumulate.
- **Resolve contradictions explicitly.** If one bullet says "always do X"
  and another says "X fails here," fix it — don't leave both, or the file
  becomes ambiguous guidance no one can safely follow.
- **Split before it gets unwieldy.** If a package's file grows past roughly
  150-200 entries, its signal-to-noise drops. At that point shard by domain
  (`Insights-Auth.md`, `Insights-Database.md`, …) rather than letting one
  file keep growing.
- **It's a draft, not ground truth.** A session (including this one) can
  summarize its own work imprecisely. Spot-check entries before leaning on
  them for something consequential.

## A known limitation

Nothing forces this skill to fire on its own — description-based
auto-triggering is unreliable, especially for the "write at the end"
trigger. The durable backstop is the explicit instruction in each package's
`AGENTS.md` (read before work, update after). This skill is the format and
rulebook for *how* to do that read/write correctly once triggered — manually
via `/engineering-insights`, or whenever the agent notices something
insight-worthy mid-session.
