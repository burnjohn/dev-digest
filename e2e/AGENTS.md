# CLAUDE.md — e2e (`@devdigest/e2e`)

Deterministic browser e2e for the full stack, driven by the `agent-browser`
CLI (CDP) against JSON flow specs — no LLM calls involved. Full picture:
[README.md](README.md).

## Docs map

- [README.md](README.md) — setup, how flows are structured and run
- [docs/](docs/) — flow design notes, agent-browser setup deep-dives
- [specs/](specs/) — the `*.flow.json` deterministic flow specifications themselves (this package's specs are executable, not prose)
- [Insights.md](Insights.md) — gotchas and decisions learned while building this package
- Root docs also apply: [../README.md](../README.md), [../TESTING.md](../TESTING.md)

## Commands

```bash
npm ci               # NOT pnpm — see Conventions
npm test             # tsx run.ts
npm run typecheck
../scripts/e2e.sh    # boots the full stack (Docker + API + web) then runs flows
```

## Conventions & gotchas

- Package manager is **npm**, deliberately, not pnpm (same rationale as
  `reviewer-core`: kept independent from the pnpm packages it drives).
- Flows are deterministic JSON specs in `specs/`, not free-form AI-driven
  browsing — no LLM keys are needed to run this suite.
- Needs the full stack running (Postgres + API + web) — `../scripts/e2e.sh`
  handles that; don't hand-roll a partial boot sequence.
- Before starting work here, read [Insights.md](Insights.md) and treat it as
  high-confidence guidance. At session end, if something non-obvious was
  learned, append it (read the file first to avoid duplicating an existing
  entry) — see the `engineering-insights` skill.
