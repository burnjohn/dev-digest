# engineering-insights — Examples

## Anti-banality test: fail vs pass

### Fail — too vague, discard

❌ "Promises can be tricky"
❌ "Be careful with async/await"
❌ "TypeScript types matter here"
❌ "Be careful with imports" ← abstract negative
❌ "Tests are important"

### Pass — specific, actionable, write these

Concrete negative beats abstract positive:
✅ "Avoid relative imports in /utils" ← tells you exactly what, where

---

## Real entry examples by section

### What Doesn't Work (most valuable, most often skipped)

✅
```
**2026-07-31** · **Async pipeline** · Promise.all() times out after 30 items on ingestion pipeline — use Promise.allSettled() with batches of 10 (server/src/modules/repos/service.ts:84) · Confidence: high
```

✅
```
**2026-07-31** · **e2e runner** · NEVER run npm test against local dev DB — flows 02/04/05 fail if more than seeded repo exists; ALWAYS use ./scripts/e2e.sh hermetic runner · Confidence: high
```

✅
```
**2026-07-31** · **pnpm link** · Tried sharing Zod contracts via pnpm link between server and client — breaks tsconfig path alias resolution. Correct: tsconfig path alias to server/src/vendor/shared/ directly · Confidence: high
```

### What Works

✅
```
**2026-07-31** · **Grounding gate** · groundFindings() + 1-based line refs is reliable; 0-based refs silently drop valid findings (reviewer-core/src/grounding.ts:42) · Confidence: high
```

### Codebase Patterns

✅
```
**2026-07-31** · **Secrets** · NEVER use process.env directly for API keys — ALWAYS go through LocalSecretsProvider; env vars are fallback only (server/src/adapters/secrets/local.ts) · Confidence: high
```

✅
```
**2026-07-31** · **State management** · Checkout flow state ALWAYS via Zustand (cartStore.ts) — 3 components share the cart; local state breaks sync · Confidence: high
```

### Decisions

✅
```
**2026-07-31** · **ORM** · Chose Drizzle relations over raw SQL joins — type inference breaks on complex joins with current pgvector version; revisit after pgvector 0.8 · Confidence: medium
```

### Tool & Library Notes

✅
```
**2026-07-31** · **OpenRouter** · Usage tokens nested under usage.prompt_tokens not data.usage — caused NaN in cost badge (server/src/modules/reviews/run-executor.ts:91) · Confidence: high
```

✅
```
**2026-07-31** · **TanStack Query** · staleTime defaults to 0 — setting 30_000 on /repos and /agents eliminated redundant re-fetches on tab focus (client/src/lib/hooks/useRepos.ts:12) · Confidence: medium
```

### Session Notes

✅
```
**2026-07-31** · **Session** · Implemented Run Cost Badge. Main blocker: OpenRouter usage token location (see Tool Notes). Resolved. Badge shows in PR list and verdict row.
```

---

## Confidence field guide

- **high** — reproduced, understood root cause, solution confirmed
- **medium** — worked in context but not fully understood; may have edge cases
- **low** — one observation, not verified; flag for future confirmation

Low-confidence entries are still worth writing if non-obvious — just mark them correctly.
