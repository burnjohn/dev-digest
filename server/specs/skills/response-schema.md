# response-schema

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

Flag any change to the shape of an API response that could cause a client to fail when deserialising or accessing fields.
"Shape" means: field names, field types, nullability, optionality, nesting depth.

For each finding: cite the exact `file:line` in the diff, show the before/after diff, state which clients are at risk, and show what the correct fix should be.

## Examples

### ❌ Bad — field renamed

```diff
- { "userId": "abc123" }
+ { "user_id": "abc123" }
```

`userId` is now `user_id`. Any client reading `.userId` gets `undefined` — silent data loss.

### ❌ Bad — field removed

```diff
- { "id": "1", "email": "a@b.com", "role": "admin" }
+ { "id": "1", "email": "a@b.com" }
```

`role` removed. Clients that branch on `user.role` will behave incorrectly.

### ❌ Bad — optional field became required

```diff
- total?: number
+ total: number
```

Clients that conditionally access `total` may now receive unexpected nulls if the server logic changes.

### ✅ Good — additive field

```diff
  { "id": "1", "email": "a@b.com"
+ , "avatar_url": "https://..." }
```

New optional field. Existing clients ignore it; new clients can use it.

## Rules

1. Renaming any field in a response body is breaking — even if the old name was "wrong".
2. Removing a field that clients currently read is breaking.
3. Changing a field type (e.g. `string` → `number`, `string` → `string[]`) is breaking.
4. Making a nullable field non-nullable (or vice versa) is breaking.
5. Changing the nesting level of an existing field is breaking.
6. Reordering array elements in a stable response is breaking when clients index by position.

## Zod / TypeScript schema patterns to watch

### ❌ Bad — Zod schema field renamed

```diff
// server/src/vendor/shared/contracts/platform.ts
 export const PrMetaSchema = z.object({
   id: z.string(),
-  cost_usd: z.number().nullish(),
+  cost: z.number().nullish(),
 })
```

The field name changed in the Zod schema. Any generated TypeScript type now has `cost` instead of
`cost_usd`. Clients destructuring `{ cost_usd }` or reading `.cost_usd` receive `undefined`.

**Cross-check:** also look at route handlers — does the JS object literal use the new or old name?

```diff
// server/src/modules/pulls/routes.ts
-  cost_usd: costByPr.get(r.id) ?? null,   // ← was this renamed too?
+  cost: costByPr.get(r.id) ?? null,
```

If the schema was updated but the route still uses the old key (or vice versa), the mismatch is a bug.

### ❌ Bad — nullish() → non-null changes client assumptions

```diff
-  score: z.number().nullish(),
+  score: z.number(),
```

Clients that guard `if (score != null)` before using it may stop guarding. Future null values will crash.

### ❌ Bad — flat field moved into nested object

```diff
- { "authorName": "alice" }
+ { "author": { "name": "alice" } }
```

Client code `response.authorName` now returns `undefined`; must become `response.author.name`.

### ✅ Good — additive nullable field

```diff
 z.object({
   id: z.string(),
+  avatar_url: z.string().nullish(),
 })
```

New optional field. Existing clients unaffected.
