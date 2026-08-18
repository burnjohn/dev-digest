# Zod contracts across layers: extend, don't fork

Classic Onion/Clean Architecture writeups often call for a strict split between a
"domain model" and a "DTO" per layer. DevDigest deliberately doesn't do that — and
this skill should not fight that design. Instead it codifies the pattern the
codebase already uses.

## What DevDigest does today

`@devdigest/shared` (vendored at `server/src/vendor/shared/`) defines one base
contract per concept — e.g. `Finding` in `contracts/findings.ts` — used
simultaneously as:

- the LLM's structured-output schema (`reviewer-core/`)
- the Fastify route response type (`server/`)
- close to the DB row shape

Narrower transport/DTO variants are built **on top of** the base contract via
`.extend()` or `.pick()`, never hand-duplicated:

```ts
// server/src/vendor/shared/contracts/review-api.ts (shape)
export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});

// A trimmed DTO for a list view — deliberately lossy, so it's its own schema
// rather than reusing Finding/FindingRecord and hoping callers only read a subset.
export const PrListFinding = Finding.pick({
  id: true,
  severity: true,
  // ...
});
```

`server/README.md` states the intended design directly: *"Zod contracts from
`src/vendor/shared` double as route schemas via `fastify-type-provider-zod` — one
definition drives request validation and response serialization."*

## The rule to apply

1. **A new domain concept gets one base contract**, added to `@devdigest/shared`
   first (per root `CLAUDE.md`: "Contracts change in `@devdigest/shared` first, then
   in consumers").
2. **A narrower or wider view of that concept is a new schema built from the base**
   via `.extend()`/`.pick()`/`.omit()` — never a copy-pasted object with the same
   field names redefined by hand. Hand-duplication is exactly how two schemas drift
   silently out of sync.
3. **Don't introduce a separate "pure domain model" type** parallel to the Zod
   contract "just because Onion Architecture usually has one." The Zod contract
   already is the domain model here; adding a shadow type would fight the codebase's
   actual design rather than clarify it.
4. Remember the vendoring gotcha (from root `INSIGHTS.md`, 2026-08-04):
   `server/src/vendor/shared/contracts/*.ts` and `client/src/vendor/shared/
   contracts/*.ts` are independent copies with no sync script — edit server's first,
   then mirror the change to client's.

## Reading

- [TypeScript, Zod and MongoDB: a guide to ORM-free data access layers](https://dev.to/zzdjk6/typescript-zod-and-mongodb-a-guide-to-orm-free-data-access-layers-2ah5) — using a Zod schema as the single source of truth for a domain contract instead of a separate hand-written type
