---
name: semver-discipline
description: >-
  Decides whether a change to any exported surface — a `@devdigest/shared`
  Zod contract, a `reviewer-core` export, a server module's public function,
  an HTTP route, or a CLI flag in `scripts/*.sh` — needs a MAJOR (breaking),
  MINOR (additive), or PATCH (non-observable) version bump, and what to write
  in the commit/PR to say so. Use whenever a diff removes, renames, or
  narrows something a caller outside the diff might depend on — even if
  typecheck and tests are green, since a breaking change to an external
  contract compiles fine on the changing side. Trigger terms: "does this need
  a major bump", "is this a breaking change", "semver", "version bump",
  "changelog entry", "BREAKING CHANGE", "is this backwards compatible".
version: 1.0.0
---

# Semver Discipline

A breaking change is not a bug — it is a promise the codebase already made to
someone who is not in this diff, and the reason it is easy to miss is that
the change compiles, the tests pass, and the caller is somewhere else
(`docs/agent-prompts/api-contract-reviewer.md`). This skill is the checklist
for catching that promise being broken, and for saying so in a way the next
person (or CI) can act on.

It is not a replacement for `response-schema` (the specific ripple of editing
one `@devdigest/shared` field through DB → adapter → route → client) or `zod`
(schema construction itself). This skill answers one narrower question first:
**given this diff, is the change MAJOR, MINOR, or PATCH** — then points at
those skills for the mechanics of making the change safely.

## The one question to ask per changed surface

For every exported function, Zod schema, HTTP route, or CLI flag the diff
touches, ask: **what would code written against the OLD shape do when it
meets the NEW one?** Name the caller — a client page, another package, a CI
script, a stored row. If you can't name one, it might still be MAJOR (an
external consumer you don't have visibility into) — silence isn't proof of
safety, but an unnamed caller is a weaker MAJOR case than a named one.

The recurring trap: **narrowing what you ACCEPT breaks senders; narrowing
what you RETURN breaks readers.** Widening either direction is usually safe.
People instinctively check the return type and forget the input side (or
vice versa) — check both.

## MAJOR — an existing caller breaks with no migration path

| Surface | Breaking signal |
| --- | --- |
| Exported function/class | Removed or renamed export; removed, reordered, or retyped parameter; a new **required** parameter; a narrowed return type (caller destructured a field that's now gone/optional) |
| Zod contract (`@devdigest/shared`) | Field removed; field goes `optional()` → required (see `response-schema` for the full ripple); a union/enum member removed; an accepted input type narrowed (e.g. `z.string()` → a stricter enum) |
| HTTP route | Route removed or renamed; a response field removed or retyped; a request field newly required; a status code or error shape a client branches on changes |
| CLI flag (`scripts/*.sh`) | Flag removed or renamed; a flag's default behavior changes (script now does something different when the flag is *absent*); positional argument meaning/order changes |
| DB-backed contract | Column dropped or narrowed — breaking for every row already written, not just new ones |

A **new required field or parameter** is the single most common accidental
MAJOR — it reads as "just adding something" but every existing caller that
doesn't know about it now fails.

## MINOR — additive, old callers unaffected

- A new optional field, parameter (with a default), export, route, or flag.
- Widening what you ACCEPT (a union gains a member, a parameter accepts a
  broader type) — old senders still work, new ones get new capability.
- A new flag whose absence preserves the exact old behavior.

## PATCH — no observable change to the contract

- Internal refactor, renamed *private*/unexported symbol, perf improvement.
- A bug fix that makes behavior match what was already documented/promised —
  if callers were relying on the *buggy* behavior, treat the fix as MAJOR for
  them and say so explicitly rather than assuming the bug was uncalled-for.
- Doc/comment-only changes, formatting.

## Two-axis trap (easy to conflate)

| Axis | Independent of |
| --- | --- |
| What the function/route/CLI **accepts** | What it **returns** — narrowing one is not evidence about the other |
| What changed **in this diff** | Pre-existing shape — a rule for the "when to use" checklist above is judging the delta, not auditing the whole surface |

Only flag what *this* diff changes. A pre-existing inconsistency the diff
doesn't touch is out of scope here (`pr-self-review`'s hunks-not-files rule
applies the same way).

## How to say it, in this repo specifically

This repo does not currently publish versioned packages — `server/`,
`client/`, and `reviewer-core/` all sit at `0.0.0` in `package.json`, and
there is no `CHANGELOG.md`. So "bump the version" has no file to land in
yet. What *does* exist and is worth being disciplined about:

1. **Commit message.** This repo's history already uses conventional-commit
   prefixes (`feat(reviews):`, `fix(dev):`, `ci(server):`). For a MAJOR
   change, use the `!` marker (`feat(contracts)!: ...`) or a `BREAKING
   CHANGE:` footer describing the old shape, the new shape, and the caller
   that needs to change. Don't let a breaking change hide behind a plain
   `feat:` or `fix:` — that's the one signal a future `git log` skim has.
2. **PR description.** Name the broken caller and the migration explicitly —
   this is exactly what `docs/agent-prompts/api-contract-reviewer.md`'s
   CRITICAL findings require, and what `pr-self-review`'s verdict surfaces
   for `server/src/vendor/shared/contracts/**` changes.
3. **If/when a package here does start publishing with real semver**
   (`@devdigest/shared` as an installable package, `reviewer-core` as a
   library), MAJOR/MINOR/PATCH here map directly onto `package.json`'s
   version field per the SemVer spec — this skill's classification doesn't
   change, only where you record it does.

## Related skills

- `response-schema` — the specific ripple (DB → adapter → route → client
  mirror) once you've decided a `@devdigest/shared` field change is MAJOR.
- `zod` — constructing/composing a schema, as opposed to judging a change to
  an existing one.
- `pr-self-review` — routes diffs to this skill and turns a MAJOR finding
  into a blocking verdict (see `routing.md`).
- `docs/agent-prompts/api-contract-reviewer.md` — the reviewer-core agent
  prompt this skill's "name the caller" framing and severity split are
  aligned with; read it if you're touching that prompt itself.

## References

- `docs/agent-prompts/api-contract-reviewer.md`
- `.claude/skills/response-schema/SKILL.md`
- [Semantic Versioning 2.0.0](https://semver.org/)
