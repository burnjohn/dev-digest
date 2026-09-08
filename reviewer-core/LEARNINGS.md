# reviewer-core — engineering learnings

**While working:** append only. Read the file before writing — if the lesson
is already here, extend that entry instead of adding a second copy. If one
turns out wrong, add a new entry correcting it rather than editing history.

**During a scheduled review** (quarterly, or when this file stops being
useful): merge duplicates, delete entries about code that no longer exists,
and resolve contradictions explicitly — two entries giving opposite advice
make the agent pick at random. Treat this file as a draft under review, not
as truth; a bad entry is worse than a missing one.

## What Works

## What Doesn't Work

## Codebase Patterns

### 2026-08-12 — activating a long-reserved optional prompt slot (`specs`) needs a grep of consumers OUTSIDE this package too, not just `reviewer-core/src` + `reviewer-core/test`

specs/09-project-context-folder.md widened `PromptParts.specs` /
`ReviewInput.specs` from `string[]` to `{ path: string; content: string }[]`
(`prompt.ts`, `review/run.ts`) so each document's repo-relative path travels
with its content as the `wrapUntrusted` label (AC-15/AC-25). The plan
justified this as safe with "zero producers exist today — grep confirms the
only mentions are the type, the renderer, and `run-executor.ts`'s `specs:
null`" — but that grep was scoped to `reviewer-core` itself and missed two
**server-side** test files that call `assemblePrompt`/`wrapUntrusted`
directly via `@devdigest/reviewer-core` (or its `server/src/platform/
prompt.ts` re-export shim): `server/test/prompt-callers.test.ts` and
`server/test/prompt-structured.test.ts`, both still passing the old
`specs: ['some string']` shape. Because reviewer-core's own `tsc` only
type-checks `reviewer-core/src` + `reviewer-core/test`, this compiled clean
there and only broke at `server`'s test runtime — `parts.specs.map(d =>
wrapUntrusted(d.path, d.content))` treats each string as `{path: undefined,
content: undefined}`, and `wrapUntrusted`'s new label-sanitizer
(`label.replace(...)`) throws a `TypeError` on `undefined`. Lesson: before
widening/narrowing a `reviewer-core` export's shape, grep `server/test/**`
and `server/src/**` too (anything importing `@devdigest/reviewer-core` or the
`platform/prompt.ts` shim) — "reviewer-core is a pure engine with no
producers yet" can still be false one layer out, in a consumer's tests.

### 2026-08-12 — `wrapUntrusted`'s label is now attacker-influenceable; sanitize it before interpolating

Every `wrapUntrusted(label, content)` call before specs/09 used a hardcoded
label constant (`'diff'`, `'repo-map'`, `'pr-description'`, …). The Project
Context Folder feature makes the label a **repository-controlled path**
(`d.path` from the resolved document), and the wrapper interpolated it
verbatim into `source="${label}"` with no escaping — a path containing `"`
or `>` could close the attribute early and inject markup into the prompt
just outside the untrusted boundary. Fixed by stripping `"`, `<`, `>`, CR,
LF from the label before interpolating (`sanitizeLabel` in `prompt.ts`) —
content escaping (`</untrusted>` neutralization) was already correct and is
unchanged. Any FUTURE new `wrapUntrusted` caller that derives its label from
anything other than a hardcoded string constant must sanitize it the same
way; the function itself now does this for every caller, so no caller-side
fix was needed beyond this one change.

### 2026-08-13 — `INJECTION_GUARD` was module-private for a whole feature (specs/09) before anything outside `assemblePrompt` needed it

specs/10-onboarding-generator.md's onboarding module makes its own one-off
structured LLM call (server-side, outside the PR-review path — D9) that
handles the SAME class of untrusted repo-controlled input `assemblePrompt`
does (paths, script strings, route strings). Rather than writing a second
guard paragraph (which `server/CLAUDE.md`'s "one shared guard, not denylists"
rule exists to prevent), the fix was exporting the existing
`const INJECTION_GUARD` in `prompt.ts` (`export const`) and adding it to this
package's `index.ts` export list — the guard STRING itself is byte-identical,
`assemblePrompt` is untouched, and `test/prompt.test.ts` needed zero edits.
Consumed from the server via the existing `platform/prompt.ts` re-export shim
(which already re-exported `wrapUntrusted`), so the server module never
imports `reviewer-core/src/prompt.ts` directly. Lesson for the next
server-side feature that makes its own structured call outside the review
path but handles equally-untrusted repo content: check whether
`INJECTION_GUARD` (now exported) already covers it before writing new guard
text — duplicating the paragraph is the failure mode "one shared guard" is
meant to prevent, and the export makes reuse a one-line append (`+
INJECTION_GUARD` on the system prompt), not a new file.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions

### 2026-09-07 — `assemblePrompt`'s `## Skills / rules` section is the only optional prompt slot NOT wrapped in `wrapUntrusted`, and `INJECTION_GUARD`'s own text doesn't name it

Verified directly (`src/prompt.ts`, ~line 176) while implementing specs/15-skill-eval-cases.md's R6 check: `if (skillsBlock) userSections.push(`## Skills / rules\n${skillsBlock}`);` pushes the rendered skill blocks straight into the user message with no `wrapUntrusted(...)` call, unlike every other slot in the same function — `pr-description`, `intent`, `intent-scope`, `repo-map`, `specs` (per-doc), `callers`, and `diff` are all wrapped. `INJECTION_GUARD`'s own enumerated list of `<untrusted>` content ("the diff, PR title/description, code comments, README, derived intent/scope") doesn't mention skills either. This is a pre-existing gap affecting every real agent run that injects ANY skill (L02+), not something specs/15 introduced — it just never surfaced because nothing before specs/15 asked this question directly (specs/15's R6 named it as a thing to verify before claiming its own AC-50, not to fix). Deliberately not patched here: it's out of specs/15's scope (`reviewer-core` is a consumer-only dependency for that spec) and `reviewer-core/CLAUDE.md`'s do-not-touch covers `INJECTION_GUARD`. Whoever next touches `assemblePrompt` or does a security pass on skill injection should wrap `skillsBlock` the same way `specsBlock` is wrapped (per-block, since `parts.skills` is already an array of separately-sourced bodies) and update `INJECTION_GUARD`'s own enumerated list to name skills explicitly.
