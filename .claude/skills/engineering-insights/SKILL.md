---
name: engineering-insights
description: Use when a session produces a non-obvious engineering fact worth keeping — a bug whose cause was not where it looked, a fix that took more than one attempt, a dead end proven, a library or tooling quirk, an architectural choice made for a reason, a recurring error identified — and when wrapping up any task that touched code. Also use before non-trivial work in a package, to load what earlier sessions already learned there. Triggers on "insight", "learning", "gotcha", "what did we learn", "wrap-up", "retrospective", "INSIGHTS.md", and on noticing that a fact would have saved time if known at the start.
allowed-tools: Bash(node .claude/skills/engineering-insights/scripts/insights.mjs *)
---

# Engineering Insights

A finding is captured the moment it is confirmed, into the `INSIGHTS.md` of the scope where it was
learned. Wrap-up is a safety net for what slipped through, not the moment capture happens — details
that make an entry actionable are the first thing to evaporate.

```!
node .claude/skills/engineering-insights/scripts/insights.mjs status
```

## Capture through the script, never with Edit or Write

```sh
# from the repo root
S=.claude/skills/engineering-insights/scripts/insights.mjs
node $S route <path-you-were-working-in>          # which INSIGHTS.md owns this
node $S check  <scope> "<the finding>"            # is it already there?
node $S append <scope> "<section>" "<the finding> → <evidence>"
```

`append` stamps the date, keeps the seven sections in order, refuses entries with no evidence,
refuses near-duplicates, and creates the file when it is missing. Hand-editing bypasses all four —
that is the whole reason the script exists. The one edit to make by hand: appending `×2 (DATE)` to
an existing entry that this session re-confirmed.

## Where it goes

`route` answers this; the rule it implements: the file belongs to the package the finding is about
(`server/`, `client/`, `reviewer-core/`, `e2e/`), and anything cross-cutting goes to the root
`INSIGHTS.md` — tooling, CI, Docker, `scripts/`, and `src/vendor/shared/` contracts, which every
package consumes.

When a finding spans packages, the entry goes where the fix lives. Add a one-line pointer in the
other package only if a session working there would trip over it without knowing.

## The seven sections

| Section | What belongs there |
|---|---|
| What Works | An approach that was verified to work here, worth reaching for again |
| What Doesn't Work | A dead end that was actually proven, with what made it fail |
| Codebase Patterns | Conventions and architectural decisions **with the reason** — "chose X over Y because Z". There is no separate Decisions section; a decision without its reason gets re-litigated |
| Tool & Library Notes | Quirks of a dependency, version, or CLI — pin the version when it matters |
| Recurring Errors & Fixes | An error seen more than once: the observable symptom, then the fix |
| Session Notes | Only the state the next session needs. Max 3 bullets per day, enforced. Not a changelog — git already has one |
| Open Questions | Something left genuinely unresolved, phrased so it can be answered |

## What makes an entry worth writing

Every entry must be actionable cold: read with no other context, it says what to do or avoid.

- **The obviousness test** — if it would be obvious to any competent developer reading the code, do
  not write it.
- **Already documented?** Do not restate it. Capture only the part that is missing, which is usually
  the *observable symptom* rather than the resolution. "A 500 with `relation does not exist`
  underneath means migrations never ran" earns its place next to an existing "migrations are not
  auto-applied", because the existing line cannot be matched from the symptom a session starts with.
- **No narration.** Not "I fixed the SSE bug" but "SSE effects must key on a primitive; an inline
  object reopens every EventSource each render".
- **Evidence is mandatory** for the five factual sections: `path/file.ts:41`, a command, `pkg@version`,
  or `PR #N`. The script rejects entries without it.

## Append-only

Existing entries are never rewritten, reworded, or deleted. A finding that turns out wrong gets a new
dated entry that corrects it, and the old one is marked `~~superseded~~ see YYYY-MM-DD`. The history
of what was believed and when is the point; a file that is silently edited into agreement with the
present teaches nothing about which beliefs are fragile.

## The boundary with CLAUDE.md

`CLAUDE.md` is the stable handbook — stack, commands, conventions, and the `## Gotchas` rules that
hold today. `INSIGHTS.md` is the dated log of what sessions actually discovered, with evidence.

Findings go to `INSIGHTS.md` first, always. When one has been re-confirmed, or has hardened into a
rule everyone must follow, **graduate** it: add or extend the line in that package's `CLAUDE.md`
under `## Gotchas` or `## Conventions`, and append `→ CLAUDE.md` to the `INSIGHTS.md` entry so it is
not graduated twice. Graduating extends a `CLAUDE.md` line; it never replaces one.

## Rationalizations

| Thought | Reality |
|---|---|
| "A separate file nobody loads wouldn't have saved those 40 minutes — put it in CLAUDE.md" | `INSIGHTS.md` is read on purpose: the Session Protocol in `CLAUDE.md` names it, and `status` above lists it every time this skill loads. Raw dated findings in `CLAUDE.md` are how the handbook stops being stable — it grows without bound and every session pays for every past debugging trip. `INSIGHTS.md` costs nothing until a session works in that scope. |
| "The existing Gotchas line is incomplete — I'll rewrite it" | Rewriting is not capture. The missing part is a new dated entry. A `CLAUDE.md` line changes only when a finding graduates, and then it gains the new fact rather than being replaced by it. |
| "It's one line, I'll just Edit the file" | Then it has no date, may duplicate an existing entry, may lack evidence, and may land in the wrong section. `append` refuses all four. |
| "Nothing this session was interesting enough" | A legitimate outcome — say so explicitly and write nothing. Inventing an entry to have written one is worse than an empty section. |
| "I'll collect everything and write it at the end" | The end is where the specifics are already gone. Capture at confirmation; wrap-up only sweeps up what was missed. |

## Wrap-up, for a task that touched code

1. `node $S status` — see what already exists for the scopes touched.
2. For each candidate finding: `check` it, then `append` it to the routed scope.
3. Any entry re-confirmed this session: append `×2 (DATE)` to it. Any that has hardened into a rule:
   graduate it to `CLAUDE.md` and mark it `→ CLAUDE.md`.
4. If `status` reports a file over its entry ceiling, prune graduated and superseded entries before
   adding more.
5. Report what was captured and where — or state plainly that nothing was worth capturing.

Worked good-and-bad pairs for all seven sections, plus graduation and superseding examples:
[reference/entry-format.md](reference/entry-format.md).
