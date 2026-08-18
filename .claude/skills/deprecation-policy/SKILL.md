---
name: deprecation-policy
description: >-
  How to mark an exported function, Zod contract field, Fastify route,
  CLI flag, or DB column as deprecated instead of silently deleting it — a
  visible marker, an unchanged behavior, a named replacement, and a removal
  trigger that actually gets checked later. Use whenever a diff removes or
  plans to remove something an existing caller could depend on, but the
  removal doesn't need to happen in this PR. Trigger terms: "deprecate",
  "mark as deprecated", "sunset", "phase out", "remove later", "keep for
  backward compat", "@deprecated".
version: 1.0.0
---

# Deprecation Policy

Silent removal is a broken promise with no warning label: the code compiles,
the tests pass (they don't exercise the caller that's about to break), and
the first anyone hears about it is a production error. Deprecation is the
alternative — keep the old surface **working**, make its retirement
**visible at the call site**, name the **replacement**, and set a **removal
trigger** that someone will actually check. A `@deprecated` tag with no
removal trigger is not deprecation, it's permanent debt wearing an apology.

This skill is about the *mechanism*. `semver-discipline` answers the prior
question — is this removal breaking at all, does a caller exist — and
`response-schema` covers the specific ripple of an *existing* contract field
changing shape. Deprecation is how you convert a `semver-discipline` MAJOR
into a MINOR now (old callers unaffected, new callers get a warning) with the
MAJOR paid off later, on a schedule, instead of both happening in one PR.

## When to deprecate vs. when to just delete

Deprecate only if a caller could exist outside this diff. If you can grep the
whole repo (including `client/`, `e2e/`, and any script) and find zero call
sites, **delete it — do not deprecate dead code**. A deprecation notice on
something nobody calls is theater; it adds a permanent-looking comment for a
problem that doesn't exist. This mirrors
`docs/agent-prompts/api-contract-reviewer.md`'s reviewer restraint: "no
'consider deprecating' without a broken caller" — the same restraint applies
to writing the deprecation, not just reviewing one.

If a caller does exist (a client page, another package, a script, a stored
row, or an external consumer you can't fully see), deprecate.

## The four things every deprecation needs

1. **A visible marker at the call site** — not just a PR description or a
   commit footer nobody reads later. See the per-surface table below for
   where that marker goes.
2. **Unchanged behavior** — a deprecated function still returns the same
   thing, a deprecated route still responds, a deprecated flag still does
   what it did. Deprecation warns; it does not break early. Changing
   behavior "underneath" something you've marked deprecated, while claiming
   it's still backward compatible, is worse than not deprecating at all —
   callers see the same interface and trust it.
3. **A named replacement** — "use `newFn()` instead", not "this will be
   removed." A deprecation with nowhere to migrate to just tells callers to
   panic.
4. **A removal trigger that's checked, not just written down** — a date, a
   version, or a condition ("once `client/` stops calling this — see grep
   below"). Pick one you can actually verify later, and re-grep for the
   marker when that trigger arrives instead of letting it sit indefinitely.

## Per-surface: where the marker goes and how behavior stays intact

| Surface | Marker | Behavior stays intact by |
| --- | --- | --- |
| Exported TS function/class/type (`reviewer-core`, `server/src/modules/**`) | `/** @deprecated ... */` JSDoc directly above the export | Old implementation keeps running; if replaced internally, the deprecated export becomes a thin wrapper calling the new one — never a stub that throws |
| Zod contract field (`server/src/vendor/shared/contracts/*.ts`) | A `.describe('@deprecated — use X. Removal: <trigger>.')` on the field, mirrored in `client/src/vendor/shared/contracts/*.ts` per `response-schema`'s ripple | Field stays in the schema, still populated by the adapter, still `optional()` if it already was — narrowing it now defeats the point |
| Fastify route (`server/src/modules/**/routes.ts`) | A comment on the route registration **and** a `Deprecation` response header (or this repo's chosen equivalent) set in the handler, so a caller's tooling can detect it without reading source | Route keeps its existing status code and response shape; do not 410 or redirect during the deprecation window — that's the removal, done early |
| CLI flag (`scripts/*.sh`) | A one-line `echo "... is deprecated, use --y instead ..." >&2` when the flag is passed, plus a comment in the flag-parsing block | Flag keeps doing what it always did; the warning is additive output, not a behavior change |
| DB column (`server/src/db/schema/*.ts`) | A comment above the column definition; this is expand/contract, not a single-step deprecation — see `drizzle-orm-patterns`/`postgresql-table-design` for adding the replacement column and backfilling before anything reads only the new one | Column stays readable and writable through the whole window; nothing stops writing to it until every reader has moved |

## Recording the removal trigger

This repo has no `CHANGELOG.md` and no published semver (`semver-discipline`
covers why — every package sits at `0.0.0`). So the trigger lives in two
places, and both need it independently because they serve different readers:

1. **Inline, at the marker** — the thing a future editor sees while touching
   that code. State the trigger concretely: a date, "once `client/` stops
   calling this", or "next time `reviewer-core`'s prompt schema changes".
   Vague triggers ("eventually", "when we have time") never fire.
2. **The commit/PR**, per `semver-discipline`'s convention — name what's
   deprecated, the replacement, and the same trigger, so `git log` and PR
   history can be grepped without reading every file's JSDoc.

If the deprecation is a cross-cutting decision (affects more than one
package, or is likely to be forgotten because the trigger is far in the
future), also record it in the nearest `INSIGHTS.md` per
`engineering-insights` — that file is exactly the place for "we decided X
instead of Y, here's why" that would otherwise only live in a PR nobody
revisits.

## Enforcement gap in this repo (know this before relying on tooling)

`typescript-eslint` v8 is present in all three TS packages, and its
`no-deprecated` rule can flag call sites of a `@deprecated`-tagged symbol —
but none of the flat configs here
(`server/eslint.config.js`, `client/eslint.config.mjs`,
`reviewer-core/eslint.config.js`) enable the type-checked config
(`recommendedTypeChecked`) that rule requires. A `@deprecated` JSDoc tag in
this repo is **advisory only** — it will not fail CI, and an IDE may or may
not surface it depending on the editor. That makes `grep -rn "@deprecated"`
across the repo the actual audit mechanism when a removal trigger comes due;
don't assume the tag alone will surface stale usages.

## Anti-patterns

- **Silent removal** — deleting an exported function, route, column, or flag
  in the same PR that stops using it internally, with no warning period for
  callers outside the diff. This is the thing this skill exists to prevent.
- **Deprecating dead code** — see "when to deprecate vs. delete" above.
- **A deprecation with no removal trigger** — becomes permanent debt; the
  apology comment outlives everyone who remembers why it's there.
- **Changing behavior while claiming backward compatibility** — a deprecated
  surface that also silently narrows its type, changes its default, or
  returns a different shape is a breaking change wearing a deprecation
  notice as camouflage. If behavior must change, that's `semver-discipline`
  MAJOR territory now, not deferred.
- **Removing on the trigger date without re-checking callers** — the trigger
  says "safe to remove *if* nothing still calls it"; re-grep at removal time,
  don't remove on a calendar reminder alone.

## Related skills

- `semver-discipline` — decides whether the eventual removal is MAJOR and
  whether a caller exists at all; read it first.
- `response-schema` — the DB/adapter/client ripple when the deprecated
  surface is an existing contract field.
- `drizzle-orm-patterns`, `postgresql-table-design` — the expand/contract
  mechanics for a DB column deprecation.
- `pr-self-review` — routes diffs that remove or narrow an existing surface
  to this skill (see `routing.md`).
- `engineering-insights` — where a cross-cutting deprecation decision gets
  recorded so it isn't only discoverable by reading one file's JSDoc.

## References

- `docs/agent-prompts/api-contract-reviewer.md` (the "no deprecating without
  a broken caller" restraint this skill's delete-vs-deprecate rule mirrors)
- `.claude/skills/semver-discipline/SKILL.md`
- `.claude/skills/response-schema/SKILL.md`
- [typescript-eslint `no-deprecated`](https://typescript-eslint.io/rules/no-deprecated/)
