# server — Insights
↑ [CLAUDE.md](./CLAUDE.md)

Append-only log of non-obvious decisions and gotchas for the API. Newest first.
One entry per learning.

## Format
```
## YYYY-MM-DD — <short title>
**Problem:** …  **Decision:** …  **Why:** …
```

## 2026-07-31 — Shared contracts have no sync script; edit source AND mirror
**Problem:** Adding a field to a `@devdigest/shared` Zod contract (e.g. `PrMeta.cost_usd`, `PrMeta.findings_counts`) only in `server/src/vendor/shared` silently drops it from the client. **Decision:** Always edit the source copy under `server/src/vendor/shared/contracts/*` AND hand-mirror the identical change into `client/src/vendor/shared/contracts/*`. **Why:** There is no vendor-sync script. The server route may return the field, but fastify's zod serializer strips keys not in the schema, and the client's vendored zod won't expose them — so a one-sided edit fails quietly with no type error.

## 2026-07-31 — PR-list per-PR aggregates are computed on-read, one IN-query each
**Problem:** Where to add a new per-PR column (SCORE, COST, FINDINGS) on `GET /repos/:id/pulls`. **Decision:** Follow the existing block in `modules/pulls/routes.ts`: collect `prIds`, run ONE `inArray(...)` query per metric, group in JS into a `Map<prId, …>`, then read it in the final `rows.map`. No FK denormalization. **Why:** The list is small; on-read keeps the schema clean and avoids write-path coupling. Use `null` (not `0`) when a PR has no data so the UI renders "—".
