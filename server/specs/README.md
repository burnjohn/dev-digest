# server/specs

One file per server-side feature: `NN-feature-name.md`. Anything that also
changes the UI belongs in the root `../../specs/` instead.

```markdown
# <Feature>

**Status:** draft | agreed | in progress | shipped

## Problem
## Routes            <!-- method + path + which @devdigest/shared schema -->
## Schema changes    <!-- tables/columns; remember: db:generate, never hand-write -->
## Adapters needed   <!-- new port behind the DI container? -->
## Acceptance criteria
```

Most course lessons land as a new `src/modules/<name>/` plugin — say which
module the spec creates or extends.
