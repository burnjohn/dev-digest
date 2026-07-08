# semver-discipline

## MANDATORY SCOPE GATE

**Before doing any analysis, check the filename of the file you are currently reviewing.**

Only produce findings when reviewing one of these files:

- `package.json` or `server/package.json` or `client/package.json`
- `CHANGELOG.md`
- `server/src/modules/*/routes.ts`
- `server/src/vendor/shared/contracts/*.ts`

If the file does NOT match any of those, output **zero findings** and stop immediately.
Do not cite files other than the one currently being reviewed. Do not invent paths.

## What to check (only if file passed the gate above)

Flag when a breaking API change was shipped without a semver major version bump,
or when the PR title/commit message labels a breaking change as "fix" or "feat" instead of "feat!".

## When a major bump is required

A major bump (X.0.0) is required whenever a published API has a **breaking change** (see `breaking-change` skill).
Specifically, in this codebase:

- Any route removal or rename → **major**
- Any response field removal or rename → **major**
- Any narrowing of accepted input (required param added, type narrowed) → **major**
- Any authentication/authorization model change (removing a public endpoint, adding mandatory auth) → **major**

## When a minor bump is enough

A minor bump (x.Y.0) is enough when:

- New optional query params or request body fields are added.
- New routes are added.
- New optional response fields are added.
- Behaviour is extended in a backwards-compatible way.

## When a patch is enough

A patch (x.y.Z) is enough when:

- Bug fixes that restore documented behaviour.
- Performance improvements with no visible contract change.
- Documentation or comment changes only.

## Examples

### ❌ Bad — breaking change shipped as patch

PR title: `fix: remove deprecated createdAt field from /users response`

Removing a field is a **major** change, not a fix. This must be `feat!: remove deprecated createdAt` with a major bump.

### ✅ Good — additive change as minor

PR title: `feat: add avatar_url to /users response`

New optional field → minor bump. Correct.

## Rule

If a PR contains even ONE breaking change (per `breaking-change` rules), the semver bump must be major.
Flag the inconsistency with the exact breaking change and the incorrect version label.

## How to detect version bumps in this codebase

Check these files in the diff:

```text
package.json          ← "version": "X.Y.Z"
server/package.json
client/package.json
CHANGELOG.md          ← ## [X.Y.Z]
```

If none of these files were changed — no version bump happened at all. That is also a violation
when a breaking change is present.

## Examples with code

### ❌ Bad — breaking rename shipped as patch

```diff
// server/src/modules/pulls/routes.ts
-  cost_usd: costByPr.get(r.id) ?? null,
+  cost: costByPr.get(r.id) ?? null,
```

```diff
// package.json
-  "version": "1.4.2",
+  "version": "1.4.3"   // ← WRONG: renaming a response field is major
```

Correct: bump to `2.0.0` and document the rename in `CHANGELOG.md`.

### ❌ Bad — breaking change with no version bump

Diff contains a removed route or renamed field but no `package.json` change exists.
Flag: "Breaking change detected but no semver bump found in this PR."

### ✅ Good — breaking change with correct major bump

```diff
// package.json
-  "version": "1.4.2",
+  "version": "2.0.0"
```

```diff
// CHANGELOG.md
+## [2.0.0] - 2025-06-29
+### Breaking
+- Renamed `cost_usd` → `cost` in `GET /repos/:id/pulls` response.
+  Callers must update field access from `.cost_usd` to `.cost`.
```

Correct: major bump + migration note.
