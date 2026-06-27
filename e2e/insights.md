# insights.md — e2e

> Append-only. Add new entries at the bottom of the correct section.
> Discovery bar: "Would a fresh agent save ≥10 minutes from reading this?" If not, skip.
> Format: `**YYYY-MM-DD [Category]** — actionable sentence. \`file:line\``
> See `.claude/skills/engineering-insights/` for full criteria and format rules.

## Patterns
<!-- Reusable approaches that worked in this module. -->

## Mistakes
<!-- Failure modes, antipatterns, wrong assumptions. Prioritize this section. -->
- **2025-06-01 [Mistake]** — All 7 flows assume `acme/payments-api` PR #482 is in the DB; running `npm test` against an empty or stale DB fails at the first redirect step. Always use `./scripts/e2e.sh` — it seeds an isolated DB automatically.

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->

## Quirks
<!-- Dependency gotchas, env constraints, non-obvious tool or library behavior. -->
- **2025-06-01 [Quirk]** — The `agent-browser` CLI uses Chrome DevTools Protocol directly — there is no Playwright, Cypress, or Puppeteer. Flows are JSON command files in `specs/*.flow.json`, not `.spec.ts` files; there is no `playwright.config.ts`. `e2e/specs/`
- **2025-06-01 [Quirk]** — `agent-browser` exits with non-zero on the first failed step with no structured error report or screenshot diff beyond stdout. Add descriptive `label` fields to every step to make failures readable from CLI output alone.
- **2025-06-01 [Quirk]** — The only URL substitution in flows is `{BASE}` → `E2E_BASE_URL`; there is no variable system for dynamic values. All IDs must match the seeded demo data exactly — if seed data changes (e.g., PR #482 is renamed), all flows referencing it must be updated.

## Open Questions
<!-- Unresolved. Convert to an entry in the appropriate section when answered. -->

---
Last updated: 2026-06-27 · Entries: 4
