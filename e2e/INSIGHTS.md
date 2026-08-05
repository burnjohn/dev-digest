# Insights — e2e/

Non-obvious findings accumulated by past sessions in this scope. Read before non-trivial work
here. Every entry should be actionable cold: a session that reads it without any other context
should know what to do or avoid.

Append with the `engineering-insights` skill (`/engineering-insights`), never by hand — the skill
dates entries, keeps the section order, and refuses duplicates. Existing entries are append-only:
correct them with a dated note below, never by rewriting.

Entry format: `` - `YYYY-MM-DD` — finding → evidence ``

## What Works

## What Doesn't Work

## Codebase Patterns

- `2026-08-05` — e2e/ never contacts GitHub — the specs run entirely on seeded data, so any flow that needs a live GitHub call (validating a PAT, importing PRs) cannot be covered here and belongs in server hermetic/DB-backed tests with a fake GitHubClient injected via ContainerOverrides → `grep -rn 'GITHUB_TOKEN|github' e2e/` returns no source hits, confirmed 2026-08-05

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
