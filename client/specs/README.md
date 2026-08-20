# client/specs

One file per UI feature: `NN-feature-name.md`. If it also needs a new endpoint,
put the spec in the root `../../specs/` so both sides stay in one document.

```markdown
# <Feature>

**Status:** draft | agreed | in progress | shipped

## Problem
## Route(s)          <!-- src/app/**/page.tsx path -->
## Data              <!-- which hook in src/lib/hooks, which endpoint -->
## States            <!-- loading / empty / error / success -->
## Copy              <!-- keys to add under messages/<locale>/ -->
## Acceptance criteria
```
