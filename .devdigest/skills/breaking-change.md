# breaking-change

Flag any change that breaks the existing public API contract for callers who have not updated their code.
A "breaking change" is one that forces clients to change their code to avoid a runtime error or behaviour change.

Flag the offending `file:line` and explain exactly what the contract was and what it became.

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