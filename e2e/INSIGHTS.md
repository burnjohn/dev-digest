# Insights — e2e

Running log of non-obvious findings, decisions, and gotchas for the browser suite.
Append newest at the top. Keep entries short: what surprised you, why it is that
way, and what to do about it. [AGENTS.md](AGENTS.md) stays lean by pointing here.

<!-- Format: ### YYYY-MM-DD — short title, then 1–3 lines. -->

### 2026-08-09 — seed
- **Flaky flow 02/04/05 is almost always a dirty DB**, not a real bug. They follow
  the home redirect to the *first* repo and assume the demo repo is the only one.
  Run the hermetic stack instead of testing against your dev DB.
- **`wait --text` / `wait --url` ARE the assertions** — a non-zero exit fails the
  step, so a "missing" assertion usually means the wait timed out.
