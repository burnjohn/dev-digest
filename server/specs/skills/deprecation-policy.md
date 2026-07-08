# deprecation-policy

## MANDATORY SCOPE GATE

**Before doing any analysis, check the filename of the file you are currently reviewing.**

If the file does NOT end with one of these exact suffixes, output **zero findings** and stop immediately:

- `server/src/modules/*/routes.ts`
- `server/src/vendor/shared/contracts/*.ts`

Examples of files to **skip entirely** (output nothing):

- Any `*.md` file
- Any `*.test.ts` or `*.spec.ts` file
- Any file under `client/`
- Any `*.json`, `*.yml` file
- Any file not under `server/src/`

Do not cite files other than the one currently being reviewed. Do not invent paths.

## What to check (only if file passed the gate above)

Flag when a public API element (route, field, param, export) is silently removed or changed without first being
marked as deprecated and given a migration period.

Deprecation must be observable to callers before removal happens. Silent removal is always a breaking change.

## Required deprecation lifecycle

1. **Mark deprecated** — add a response header (`Deprecation: true`, `Sunset: <date>`) and/or a `deprecated: true`
   field in the response body, and document the replacement.
2. **Communicate** — the PR that introduces the deprecation must update API docs / changelog with the sunset date.
3. **Grace period** — at least one minor release must exist between the deprecation marker and removal.
4. **Remove** — only after the grace period and a major version bump.

## Examples

### ❌ Bad — silent removal in same PR

```diff
- GET /users/:id/profile   → 200 { name, bio, avatar }
```

Route removed without deprecation header or grace period. Callers will receive 404 with no warning.
**Flag this.** Request must add a deprecation cycle or restore the route.

### ❌ Bad — field removed with a comment but no deprecation marker

```diff
- // DEPRECATED: use profile.avatarUrl instead
- "avatar": "..."
```

Comment-only deprecation is not machine-observable. Clients have no programmatic way to detect it.

### ✅ Good — response includes deprecation hint

```json
{
  "avatar": "https://...",
  "_deprecated": { "avatar": "Use profile.avatarUrl; this field will be removed in v3.0" }
}
```

Callers can detect the deprecation hint and update before the field is removed.

### ✅ Good — HTTP header

```http
Deprecation: true
Sunset: Sat, 01 Mar 2025 00:00:00 GMT
Link: <https://docs.example.com/migration>; rel="deprecation"
```

RFC 8594-compliant deprecation signal.

## Rule

Any removal or renaming of a public API surface MUST be preceded by a deprecation marker in an earlier release.
If this PR removes or renames something that was never marked deprecated, flag it as a policy violation.

## Fastify + TypeScript patterns to watch

### ❌ Bad — field silently renamed in same PR (no prior deprecation)

```diff
// server/src/modules/pulls/routes.ts
-  cost_usd: costByPr.get(r.id) ?? null,
+  cost: costByPr.get(r.id) ?? null,
```

There is no evidence that `cost_usd` was previously marked as deprecated (no `_deprecated` hint,
no `Deprecation` header, no `@deprecated` JSDoc on the Zod schema field, no CHANGELOG entry).
This is a silent rename — a policy violation. Flag it.

### ❌ Bad — route removed without prior Sunset header

```diff
-app.get('/repos/:id/stats', async (req, reply) => { ... })
```

No prior release added a `Deprecation: true` + `Sunset: <date>` response header.
Callers receive 404 with zero warning. Flag it.

### ✅ Good — deprecation introduced before removal (step 1 of 2)

```typescript
// v1.5.0 — deprecation marker added, field still returned
app.get('/repos/:id/pulls', async (req, reply) => {
  reply.header('Deprecation', 'true');
  reply.header('Sunset', 'Mon, 01 Sep 2025 00:00:00 GMT');
  return rows.map(r => ({
    cost_usd: r.cost,   // kept for backward compat
    cost: r.cost,       // new canonical name
  }));
});
```

Then in v2.0.0 (after the grace period): `cost_usd` is removed. This is correct policy.

### ✅ Good — `@deprecated` JSDoc on shared Zod field

```typescript
// server/src/vendor/shared/contracts/platform.ts
export const PrMetaSchema = z.object({
  /** @deprecated Use `cost` instead. Will be removed in v2.0. */
  cost_usd: z.number().nullish(),
  cost: z.number().nullish(),
})
```

TypeScript callers see the deprecation warning at compile time.
