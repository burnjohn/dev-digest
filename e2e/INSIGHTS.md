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
- `2026-08-06` — Sidebar nav item labels (client/src/vendor/ui/nav.ts NAV array — 'Pull Requests', 'Repository', 'Agents') render as visible DOM text via a plain <span>{item.label}</span> in NavItem.tsx, so a flow can navigate with find text "Repository" click / find text "Pull Requests" click instead of needing a repo's UUID to construct a /repos/:repoId/... URL by hand → client/src/vendor/ui/shell/NavItem.tsx:54, used in e2e/specs/08-github-tokens.flow.json to reach and return from /repos/:repoId/settings, Task 12 2026-08-06
- `2026-08-06` — A fix that makes a previously-absent UI state present from the very first page load (here: the amber 'no token' badge, once RepoWithToken.github_token_configured started gating it — the seeded demo token has no stored PAT) silently turns a before/after e2e assertion keyed on that state's mere presence into a vacuous no-op: 'the badge appears after deleting the token' passes even though the badge was already showing before deletion too. The fix has to assert what the action ACTUALLY changes instead — here, the repo settings picker's displayed selection (shows the token's label selected before, reverts to its unselected placeholder after, once the FK really nulls github_token_id) → e2e/specs/08-github-tokens.flow.json, final review pass on feat/per-repo-github-tokens 2026-08-06
- `2026-08-20` — Flow specs share one DB and browser session, so mutating flows carry "mutates": true and orderFlows() forces them after all read-only flows (loudly failing otherwise) — lexical filename ordering alone was an accident waiting for the next spec number → e2e/lib/assert.ts Flow.mutates, e2e/run.ts orderFlows(), 2026-08-20

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
