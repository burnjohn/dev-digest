# Insights — reviewer-core

Running log of non-obvious findings, decisions, and gotchas for the review engine.
Append newest at the top. Keep entries short: what surprised you, why it is that
way, and what to do about it. [CLAUDE.md](CLAUDE.md) stays lean by pointing here.

<!-- Format: ### YYYY-MM-DD — short title, then 1–3 lines. -->

### 2026-08-09 — seed
- **The build is a type-check.** The package never emits JS; consumers read `src`
  directly via tsconfig alias. If a consumer can't see a symbol, export it from `index.ts`.
- **Grounding is the safety net, not a nice-to-have.** Never relax `groundFindings`
  to "trust" a location or score — hallucinated line numbers are exactly what it stops.
- **Don't add keyword scanning for prompt injection.** The defense is the single
  `INJECTION_GUARD` rule; a denylist only catches one phrasing and gives false comfort.
