# specs/ — cross-package

Forward-looking specs for work that spans more than one package. One file per
feature: `NN-feature-name.md`. Work that lives inside a single package goes in
that package's `specs/` instead.

A spec describes **what to build and why it is done** — not how the code works
today (that is `docs/`) and not what we already rejected (that is `INSIGHTS.md`).

Suggested shape:

```markdown
# <Feature>

**Status:** draft | agreed | in progress | shipped
**Packages touched:** server, client

## Problem
## Scope — in / out
## Contract changes        <!-- @devdigest/shared first, always -->
## Acceptance criteria     <!-- how we know it is done -->
## Open questions
```

Once shipped, either delete the spec or set `Status: shipped` and move any
durable explanation into `docs/`. Stale specs are worse than missing ones — an
agent reads them as current intent.
