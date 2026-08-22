# PR Self-Review Skill

Automated pre-push code review orchestrator for the DevDigest project.

## What it does

Runs before `git push` (via `PreToolUse` hook) or on demand. Collects the git diff against `origin/main`, routes changed files into three buckets, spawns one sub-agent per bucket applying the relevant skills, collects structured findings, and applies a merge gate: **CRITICAL findings block the push**.

## When to invoke

- Manually: `"review my changes"` / `"pr self review"` / `"check before push"`
- Automatically: fires on `PreToolUse(Bash git push*)`

## File structure

```
pr-self-review/
├── SKILL.md                 ← orchestrator — 7-step execution algorithm
├── tile.json                ← skill metadata
├── README.md                ← this file
├── references.md            ← all sources and inspirations
└── rules/
    ├── file-routing.md      ← how files are assigned to buckets
    ├── severity-levels.md   ← CRITICAL / HIGH / MEDIUM definitions
    └── output-format.md     ← findings table + PASS/BLOCKER verdict format
```

## Buckets and skills

| Bucket             | Files                           | Skills applied                                                                                                                            |
| ------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **UI Frontend**    | `client/**/*.ts,tsx,css`        | `frontend-architecture`, `react-best-practices`, `next-best-practices`, `typescript-expert`, `zod`, `security`                            |
| **Backend/Domain** | `server/**`, `reviewer-core/**` | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `typescript-expert`, `zod`, `security` |
| **Tests**          | `**/*.test.ts,tsx`              | `react-testing-library`, `typescript-expert`                                                                                              |

## Severity and merge gate

| Level       | Blocks push? |
| ----------- | ------------ |
| 🔴 CRITICAL | ✅ YES       |
| 🟡 HIGH     | ❌ No        |
| 🔵 MEDIUM   | ❌ No        |

CRITICAL = React Rules of Hooks violation, security high-confidence finding, onion layer violation, or contract sync mismatch between `client/src/vendor/shared/contracts/` and `server/src/vendor/shared/contracts/`.

## Sources

All research URLs → [references.md](references.md)
