# File Routing — PR Self Review

Maps changed file paths to which skills should analyze them.
A file can match multiple categories.

## Category: Frontend

**Glob patterns:**
- `client/**/*.tsx`
- `client/**/*.ts`
- `client/**/*.jsx`
- `client/**/*.js`
- `client/**/*.css`

**Skills to apply:**
- `frontend-architecture` — folder structure, component splitting, constants/utils placement
- `react-best-practices` — hooks rules, state management, rendering anti-patterns
- `next-best-practices` — App Router, RSC boundaries, data fetching, directives
- `react-testing-library` — if the changed file is `*.test.tsx` or `*.spec.tsx`

---

## Category: Backend

**Glob patterns:**
- `server/src/modules/**/*.ts`
- `server/src/adapters/**/*.ts`
- `server/src/platform/**/*.ts`
- `server/src/db/**/*.ts`

**Skills to apply:**
- `onion-architecture` — layer violations (DB in routes, HTTP in service, etc.)
- `fastify-best-practices` — route shape, schema validation, error handling
- `drizzle-orm-patterns` — query patterns, transactions, relations
- `postgresql-table-design` — only if `server/src/db/schema/**` is in the diff

---

## Category: Migration (always special-tracked)

**Glob patterns:**
- `server/src/db/migrations/**`

**Extra checks (beyond backend skills):**
- `NOT NULL` column added without `DEFAULT` on an existing table → critical
- `DROP TABLE` or `DROP COLUMN` present → critical, must have explicit confirmation comment
- No corresponding down migration → high

---

## Category: Security (always-on — runs on ALL files)

**Glob patterns:** `**/*` (every changed file)

**Skills to apply:**
- `security` — OWASP Top 10, secrets in code, injection, auth bypass

---

## Category: Shared / Full-stack

**Glob patterns:**
- `**/*.ts`
- `**/*.tsx`

**Skills to apply:**
- `zod` — schema validation patterns, safe parsing
- `typescript-expert` — type safety, `any` usage, inference issues

---

## Routing Priority (for large diffs)

When diff exceeds 500 lines, analyze in this order and stop if context budget is exceeded:

1. Migration files
2. Security-sensitive files (auth, tokens, env, secrets)
3. Backend business logic (`service.ts`, `routes.ts`, `repository.ts`)
4. Frontend components with business logic
5. Tests
6. Config / tooling files