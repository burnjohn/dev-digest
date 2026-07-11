# deprecation-policy

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

Route removed without deprecation header or grace period. Callers will receive 404 with no warning.

### ❌ Bad — field removed with a comment but no deprecation marker

Comment-only deprecation is not machine-observable. Clients have no programmatic way to detect it.

### ✅ Good — HTTP header

```
Deprecation: true
Sunset: Sat, 01 Mar 2025 00:00:00 GMT
Link: <https://docs.example.com/migration>; rel="deprecation"
```

RFC 8594-compliant deprecation signal.

## Rule

Any removal or renaming of a public API surface MUST be preceded by a deprecation marker in an earlier release.
If this PR removes or renames something that was never marked deprecated, flag it as a policy violation.