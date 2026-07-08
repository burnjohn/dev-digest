# breaking-change

## MANDATORY SCOPE GATE

**Before doing any analysis, check the filename of the file you are currently reviewing.**

If the file does NOT end with one of these exact suffixes, output **zero findings** and stop immediately:

- `server/src/modules/*/routes.ts`
- `server/src/vendor/shared/contracts/*.ts`

Examples of files to **skip entirely** (output nothing):

- Any `*.md` file
- Any `*.test.ts` or `*.spec.ts` file
- Any file under `client/`
- Any `*.json`, `*.yml`, `*.sh` file
- Any file not under `server/src/`

Do not cite files other than the one currently being reviewed. Do not invent paths.

## What to check (only if file passed the gate above)

Flag any change that breaks the existing public API contract for callers who have not updated their code.
A "breaking change" is one that forces clients to change their code to avoid a runtime error or behaviour change.

For each finding: cite the exact `file:line` in the diff, state what the contract WAS (before) and what it BECAME (after), and show the correct fix.

## Examples

### ❌ Bad — silently breaks callers

```diff
- export async function getUser(id: string): Promise<User>
+ export async function getUser(id: string, includeDeleted = false): Promise<User | null>
```

Return type changed from `User` to `User | null`. All callers that wrote `const u = await getUser(id); u.name`
will throw at runtime. This is a **breaking change** — flag it.

### ✅ Good — backwards-compatible addition

```diff
- export async function getUser(id: string): Promise<User>
+ export async function getUser(id: string, options?: { includeDeleted?: boolean }): Promise<User>
```

Optional parameter, return type unchanged. Existing callers are unaffected.

## Rules

1. Any removal of a public export, route, or method is breaking.
2. Any narrowing of an accepted parameter type is breaking (e.g. `string | number` → `string`).
3. Any widening of a return type is breaking unless callers are guarded (`User | null` where `User` was expected).
4. A route path change (rename, reorder of segments) is breaking.
5. A required-parameter addition is breaking.
6. Status code change on a success path (200 → 201, 200 → 204) is breaking if clients branch on it.

## Fastify + Zod patterns to watch

### ❌ Bad — Zod response field renamed

```diff
// server/src/modules/pulls/routes.ts
 const row = {
   id: r.id,
-  cost_usd: costByPr.get(r.id) ?? null,
+  cost: costByPr.get(r.id) ?? null,
 }
```

Field renamed from `cost_usd` to `cost`. The shared contract (`PrMeta`) still declares `cost_usd`.
Every client reading `row.cost_usd` now gets `undefined` — silent data loss with no runtime error.
This is CRITICAL. Minimum bump: **major**.

### ❌ Bad — query param made required

```diff
// server/src/modules/pulls/routes.ts
 querystring: z.object({
-  page: z.coerce.number().optional().default(1),
+  page: z.coerce.number(),
 })
```

Existing callers that omit `?page=` will now receive a 400. Breaking.

### ❌ Bad — route path changed

```diff
-app.get('/repos/:id/pulls', ...)
+app.get('/repos/:repoId/pulls', ...)
```

Path parameter name change forces URL reconstruction in every caller. Breaking.

### ✅ Good — new optional field added to response

```diff
 const row = {
   id: r.id,
   cost_usd: costByPr.get(r.id) ?? null,
+  findings_count: countByPr.get(r.id) ?? 0,
 }
```

Additive change. Existing clients ignore the new field.
