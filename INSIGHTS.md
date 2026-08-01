# Insights — repo-wide

Non-obvious findings accumulated by past sessions in this scope. Read before non-trivial work
here. Every entry should be actionable cold: a session that reads it without any other context
should know what to do or avoid.

Append with the `engineering-insights` skill (`/engineering-insights`), never by hand — the skill
dates entries, keeps the section order, and refuses duplicates. Existing entries are append-only:
correct them with a dated note below, never by rewriting.

Entry format: `` - `YYYY-MM-DD` — finding → evidence ``

## What Works

## What Doesn't Work

- `2026-08-01` — `instanceof` cannot be trusted for ANY class constructed inside `server/src/vendor/shared/` — not just `ZodError`. Each package resolves its own copy of the dependency, so the prototype chains differ and the check silently returns false; nothing throws and no type error appears, which is why the failure surfaces only as a wrong branch being taken further downstream. Match by shape (a discriminating field, e.g. an `issues` array) instead → `server/src/app.ts:140`

## Codebase Patterns

## Tool & Library Notes

- `2026-08-01` — Matching zod version strings are NOT a defence against the dual-instance problem: `server/`, `client/`, and `reviewer-core/` each declare `zod: ^3.24.1` and each has its own lockfile, so they still resolve to distinct module copies. Do not "fix" a cross-boundary `instanceof` by aligning versions — it is already aligned → `zod@^3.24.1` in server/package.json:38
- `2026-08-01` — A skill's ```! dynamic-context block must use the same path form as its `allowed-tools` pattern: `${CLAUDE_SKILL_DIR}` expands to an absolute path, which a relative grant like `Bash(node .claude/skills/...)` does not match, so every invocation prompts for approval instead of rendering silently. Use the project-relative path in both places → `.claude/skills/engineering-insights/SKILL.md:11`

## Recurring Errors & Fixes

## Session Notes

## Open Questions
