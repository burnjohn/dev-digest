# Finding Severity Model — PR Self Review

## Severity Levels

### critical — BLOCKS merge
A finding that **guarantees** broken behavior, data loss, or a security vulnerability in production.
The PR cannot be merged until the issue is resolved.

Examples:
- Secret or API key hardcoded in source code
- SQL injection / XSS vulnerability
- Drizzle query in `routes.ts` or `service.ts` (layer violation that bypasses security scoping)
- Repository query without `workspace_id` filter (data leak between workspaces)
- `NOT NULL` column added in migration without `DEFAULT` (will crash on deploy)
- `DROP TABLE` / `DROP COLUMN` without explicit `-- intentional` comment
- `FastifyRequest` passed into a service method (breaks testability and layering)
- Auth check missing on a protected route

---

### high — should fix before merge (not blocking by default)
A clear architectural or correctness violation that will cause bugs or make the code hard to maintain.
Can be overridden with `// pr-review: ignore` + justification.

Examples:
- Missing Zod schema on route `body`, `params`, or `querystring`
- `new ConcreteAdapter()` inside a service (should use Container injection)
- Business logic inside `repository.ts` (orchestration belongs in service)
- React component over ~200 lines with mixed concerns
- `useEffect` with missing or incorrect dependency array
- `any` type used without justification

---

### medium — worth fixing, not urgent
Deviations from project conventions that accumulate into tech debt.

Examples:
- Constants defined inside component body instead of module scope
- Utility function that belongs in `utils/` placed inside a component
- Component doing two unrelated things (should be split)
- Drizzle `numeric` column returned without `Number()` wrap
- `throw new Error('...')` in service instead of `AppError` subclass

---

### low — style / cosmetic
Minor issues, naming, small style deviations. Informational only, never blocks.

Examples:
- Inconsistent naming convention
- Comment that describes WHAT instead of WHY
- Dead code that could be removed

---

## Confidence Threshold

Each finding must include a confidence level. Apply this rule before surfacing a finding:

| Confidence | Action |
|---|---|
| `high` | Surface as-is |
| `medium` | Surface, but downgrade severity by one level (critical → high, high → medium) |
| `low` | Drop the finding entirely — do not include in the report |

This prevents noise from uncertain analysis.

---

## Suppression

A finding on a line marked with `// pr-review: ignore` must be skipped entirely.
The comment should include a short justification and optionally a ticket reference:

```ts
const client = new Anthropic({ apiKey }) // pr-review: ignore — legacy path, tracked in #234
```

Do not surface suppressed findings even as informational notes.
