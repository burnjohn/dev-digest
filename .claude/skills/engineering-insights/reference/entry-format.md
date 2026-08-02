# Entry format — worked pairs

## Contents

- The line format
- Routing table
- Good and bad, per section
- Re-confirming, superseding, graduating
- Pruning

The examples below are drawn from facts this repo genuinely holds, so the form can be judged against
real material. Several of them already live in a `CLAUDE.md` — they are shown here to illustrate
shape, not as things to go and write. When a fact is already documented, capture only the part that
is missing, which is usually the observable symptom.

## The line format

```
- `YYYY-MM-DD` — <finding, one line, specific enough to act on cold> → <evidence>
```

The date is stamped by `insights.mjs append`. Evidence is one of:

| Form | Example |
|---|---|
| File and line | `` → `server/src/app.ts:138` `` |
| Command that shows it | `` → `cd server && pnpm test routes-smoke` `` |
| Package and version | `` → `zod@3.23.8` `` |
| Pull request or commit | `→ PR #11` |

`Session Notes` uses `### YYYY-MM-DD` groups with plain bullets and no evidence requirement.
`Open Questions` is dated but needs no evidence.

## Routing table

| Path touched | Scope | File |
|---|---|---|
| `server/**` | `server` | `server/INSIGHTS.md` |
| `client/**` | `client` | `client/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e` | `e2e/INSIGHTS.md` |
| `server/src/vendor/shared/**` | `root` | `INSIGHTS.md` — every package consumes these contracts |
| `scripts/`, `.github/`, `docker-compose.yml`, root configs | `root` | `INSIGHTS.md` |

Run `node .claude/skills/engineering-insights/scripts/insights.mjs route <path>` instead of deciding
by hand.

## Good and bad, per section

### What Works

Bad — restates a convention anyone can read in the route file:

```
- `2026-08-01` — Use zod schemas for validation → `src/modules/repos/routes.ts:12`
```

Good — names the mechanism, the payoff, and the thing that would otherwise be written by hand:

```
- `2026-08-01` — Declaring the response schema in the route makes `fastify-type-provider-zod` serialize it too, so handlers can return rich objects without a manual DTO mapper → `src/modules/repos/routes.ts:12`
```

### What Doesn't Work

Bad — an opinion, and not one that was tested:

```
- `2026-08-01` — instanceof checks are unreliable in TypeScript → `src/app.ts:138`
```

Good — a proven failure with the mechanism that causes it:

```
- `2026-08-01` — `err instanceof ZodError` is always false for errors raised inside `src/vendor/shared/`: the shared contracts and the server resolve separate zod copies, so the prototype chains differ and nothing throws to make it visible → `src/app.ts:138`
```

### Codebase Patterns

Architectural decisions live here, and the reason is not optional.

Bad — the decision without its reason, which guarantees it gets re-litigated:

```
- `2026-08-01` — Packages are linked with tsconfig path aliases, not a workspace → `tsconfig.json`
```

Good:

```
- `2026-08-01` — `reviewer-core` is consumed as TypeScript source through a path alias and emits no JS, so the API can be edited and typechecked in one pass; the cost is that each package carries its own lockfile and its own zod copy → `reviewer-core/tsconfig.json`
```

### Tool & Library Notes

Bad — no version, so it cannot be trusted in six months:

```
- `2026-08-01` — drizzle-kit sometimes generates empty migrations → `server/drizzle.config.ts`
```

Good:

```
- `2026-08-01` — `reviewer-core/tsconfig.json` pins zod to its own `node_modules/zod` on purpose; removing the pin resurrects the dual-instance error where parsed values fail `instanceof` across the package boundary → `reviewer-core/tsconfig.json`
```

### Recurring Errors & Fixes

The symptom comes first, because that is what a future session starts from.

Bad — the resolution only, which cannot be matched from what a session actually sees:

```
- `2026-08-01` — Remember to run migrations → `pnpm db:migrate`
```

Good — recognisable from the symptom, and the fix follows:

```
- `2026-08-01` — A route 500 with `relation "..." does not exist` underneath means migrations never ran against this database, not a bug in the route; `pnpm db:migrate` is never automatic, including for a brand-new endpoint → `cd server && pnpm db:migrate`
```

Note this earns its place even though root `CLAUDE.md` already says migrations are not auto-applied:
the existing line states the rule, this one makes the rule reachable from the error text.

### Session Notes

Bad — a changelog git already keeps, and four bullets where three are allowed:

```
- Added the runs endpoint
- Fixed a bug
- Ran the tests
- Committed
```

Good — only the state the next session needs:

```
### 2026-08-01

- Runs SSE endpoint works end to end; the polling fallback path is still untested
- `EMBEDDINGS_ENABLED=true` is set locally to exercise RAG — revert before pushing
```

### Open Questions

Bad — unanswerable as phrased:

```
- `2026-08-01` — Should we improve the architecture?
```

Good — answerable, with the trade-off named:

```
- `2026-08-01` — Is the dual-zod duck-typing tax worth keeping, or should `shared` be hoisted to one copy? Hoisting breaks the separate-lockfile property the packages rely on
```

## Re-confirming, superseding, graduating

**Re-confirmed** — the same finding bit again. Append the marker to the existing line by hand; this is
the only in-place edit allowed:

```
- `2026-08-01` — `err instanceof ZodError` is always false … → `src/app.ts:138` ×2 (2026-09-14)
```

**Superseded** — the finding turned out wrong or went stale. Mark the old entry, add a new dated one.
Never delete or reword the original:

```
- `2026-08-01` — Grounding drops findings whose line numbers fall outside the diff hunk → `reviewer-core/src/grounding.ts:44` ~~superseded~~ see 2026-09-20
- `2026-09-20` — Grounding also accepts context lines inside the hunk, not just changed lines, so a finding on an unchanged line inside a hunk now survives → `reviewer-core/src/grounding.ts:51`
```

**Graduated** — re-confirmed, or hardened into a rule everyone must follow. Extend the package's
`CLAUDE.md` and mark the entry. The `INSIGHTS.md` line stays where it is:

```
- `2026-08-01` — `err instanceof ZodError` is always false … → `src/app.ts:138` → CLAUDE.md
```

and in `server/CLAUDE.md` under `## Gotchas`, the existing line gains the symptom rather than being
replaced:

```
- Error handler duck-types ZodError (shape check, not just instanceof) due to dual zod instances — an unexpected 500 on a malformed body is this; validation answers 422 here, never 400
```

## Pruning

`status` warns past 60 entries in one file. Prune in this order: entries marked `→ CLAUDE.md` (the
rule now lives in the handbook), then `~~superseded~~` entries older than a quarter, then
`Session Notes` groups older than a quarter. Never prune an unresolved `Open Questions` entry — answer
it or leave it.
