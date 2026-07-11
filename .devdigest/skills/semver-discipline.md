# semver-discipline

Flag when a change to the API requires a semver major version bump but one has not been made,
or when the commit message / PR title suggests a "minor" or "patch" change that is actually a major.

## When a major bump is required

A major bump (X.0.0) is required whenever a published API has a **breaking change** (see `breaking-change` skill).
Specifically in this codebase:

- Any route removal or rename → **major**
- Any response field removal or rename → **major**
- Any narrowing of accepted input (required param added, type narrowed) → **major**
- Any authentication/authorization model change (removing a public endpoint, adding mandatory auth) → **major**

## When a minor bump is enough

- New optional query params or request body fields are added.
- New routes are added.
- New optional response fields are added.
- Behaviour is extended in a backwards-compatible way.

## When a patch is enough

- Bug fixes that restore documented behaviour.
- Performance improvements with no visible contract change.
- Documentation or comment changes only.

## Rule

If a PR contains even ONE breaking change (per `breaking-change` rules), the semver bump must be major.
Flag the inconsistency with the exact breaking change and the incorrect version label.