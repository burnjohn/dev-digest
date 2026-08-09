---
name: engineering-insights
description: "Captures a non-obvious engineering insight into the working module's INSIGHTS.md so future sessions don't re-derive it. Use when you discover a gotcha, a root-caused fix, an architectural convention, a dependency quirk, a dead end that did NOT work, or an unresolved question; and at the end of any task that hit a problem, decision, or surprise. Triggers: \"capture this\", \"log a learning\", \"insight\", \"wrap up\", \"what did we learn\", \"engineering-insights\"."
---

# Engineering Insights

When you learn something non-obvious about this codebase, append it to the
**INSIGHTS.md of the module you are working in**. Append-only — never edit or
delete existing entries; correct a stale one by adding a new dated entry *(during
capture — the periodic pass under **Keep the log healthy** is the one sanctioned
time to prune or merge)*.

**Module → file:**

| You're working in…              | Write to                                       |
|---------------------------------|------------------------------------------------|
| `client/` (@devdigest/web)      | `client/INSIGHTS.md`                           |
| `server/` (@devdigest/api)      | `server/INSIGHTS.md`                           |
| `reviewer-core/`                | `reviewer-core/INSIGHTS.md`                    |
| `e2e/`                          | `e2e/INSIGHTS.md`                              |
| `server/src/modules/repo-intel/`| `server/src/modules/repo-intel/INSIGHTS.md`    |

**Write only if it clears every gate** — noise is worse than nothing:
- **Reusable** — applies beyond this one case.
- **Non-trivial** — took real discovery; not obvious from reading the code.
- **Actionable cold** — a future reader knows what to do without re-investigating.
- **Precise** — names the mechanism/root cause with a *stable* anchor: file, function,
  command, or exact error text. Avoid bare line numbers — they drift and break transferability.

**Don't capture:** general knowledge that's in official docs, transient/environment
problems (network blips, flaky runs), or pure personal style preferences.

**Cadence:** capture the moment you hit something non-obvious, and do a wrap-up pass at
the end of any substantive session (~>30 min, or any session with a real problem, decision,
or surprise). Skip trivial config tweaks — signal quality beats volume.

**Before writing, re-read the target file and dedupe by meaning** — if the same lesson is
already logged (even worded differently), don't add a duplicate. If your finding *refines*
an existing entry, add a dated note that sharpens it rather than a near-duplicate; correct
a stale entry the same way. Only ever touch the INSIGHTS.md section you're appending to.

**How to write — NEVER overwrite.** Always **read the whole file first**, then add your
entry with a *targeted, additive edit* under the right section. Use whole-file `Write` ONLY
to create a file that does not yet exist. Never replace the file wholesale, and never
delete, reorder, or rewrite existing entries — the change must be purely additive. After
writing, verify every prior entry is still present (the diff should show added lines only).

Append under the matching section (create it or the file if missing): **What Works** ·
**What Doesn't Work** · **Codebase Patterns** · **Tool & Library Notes** · **Recurring
Errors & Fixes** · **Session Notes** (dated) · **Open Questions**.

**Entry format:** `### YYYY-MM-DD — short title`, then 1–3 lines (two sentences max).
Bad (vague): "be careful with async." Bad (not transferable): "fixed a bug on line 47."
Good: "Promise.all() on ingest times out past ~30 items — use Promise.allSettled() in
batches of 10 (repo-intel ingest pipeline)."

**Keep the log healthy (periodic maintenance, not every session):**
- **Prune monthly.** Re-read and delete/supersede entries a dependency upgrade, refactor, or
  new convention made stale — an outdated note is worse than none. This is the sanctioned
  time to edit existing entries.
- **Reconcile contradictions.** If two entries disagree ("always do X" vs "X breaks here"),
  merge them into one dated entry — don't leave the agent to guess.
- **Split before it bloats.** Past ~200 entries (or when signal drops), split a module's
  INSIGHTS.md into domain files (e.g. `INSIGHTS-db.md`, `INSIGHTS-auth.md`).
- **It's a draft, not gospel.** A wrap-up is LLM-written — spot-check new entries for wrong
  summaries before trusting them.
- **It lives in git.** INSIGHTS.md is committed on purpose: history shows how knowledge
  evolved, a bad wrap-up can be reverted, and the team shares the same lessons.
