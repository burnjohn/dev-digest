# INSIGHTS — client

Practical findings hit while working in this module. Append-only: correct a
stale entry with a new dated line, never edit or delete history silently.

Before writing here, check [CLAUDE.md](CLAUDE.md) — a finding that should
*always* apply belongs there as a standing rule; this file is for things too
specific, too contextual, or too unproven for that yet.

**Anti-vague test:** if someone who just read the code wouldn't be surprised,
don't write it. See the repo's `engineering-insights` skill for the full
workflow and quality bar.

## What Works

## What Doesn't Work

## Codebase Patterns

- 2026-08-05 — `Dropdown` (`src/vendor/ui/kit/Dropdown.tsx`) now supports two
  mutually-exclusive content modes behind one component: the original
  `items: DropdownItemDef[]` list, or a free-form `children` render (used by
  the findings click-popover). `items` became optional and `children ?? items?.map(...)`
  picks whichever was passed; a new `onOpenChange` callback exposes open state
  without changing the 6 existing `items`-only call sites. Worth reusing this
  "optional items + optional children" shape for the next shared `kit`
  component that needs one consumer to render arbitrary rich content while
  every other consumer keeps using the simple declarative list.
  (`src/vendor/ui/kit/Dropdown.tsx:62-100`)

- 2026-07-27 — `src/vendor/shared` here is a **trimmed subset** of the
  server's `@devdigest/shared`, hand-copied — not just a mirror. It's missing
  `AgentManifest`, the OpenRouter `sessionId` field, and the `'openrouter'`
  provider id that exist server-side. Before assuming a contract is "not
  built yet," check whether it simply wasn't copied over.
  (`client/src/vendor/shared/contracts/eval-ci.ts` and
  `client/src/vendor/shared/adapters.ts` vs
  `server/src/vendor/shared/contracts/eval-ci.ts:144-172`,
  `server/src/vendor/shared/adapters.ts:64-69,83`)

## Tool & Library Notes

- 2026-08-04 — A real review run against the live OpenRouter API (deepseek-v4-flash,
  a small diff) cost exactly `$0.000272979` — i.e. a normal, non-degenerate
  review can legitimately land under $0.001. `formatCost`'s `<$0.001` branch
  isn't a theoretical edge case for a broken/free model; it's the realistic
  common case for a cheap model on a small PR, so don't assume it's rare.
  (`client/src/lib/format.ts:10`)

## Recurring Errors & Fixes

- 2026-08-05 — The PR list's `tableCard` container had `overflow: "hidden"`
  (for its rounded corners), which silently clipped the FINDINGS column's
  new click-popover — an absolutely-positioned `Dropdown` child — whenever it
  opened on a row near the bottom of the table. `pnpm typecheck` and the full
  Vitest/RTL suite (53 tests) stayed green through this the whole time:
  JSDOM has no real layout engine, so `overflow: hidden` clipping is
  invisible to RTL assertions — it only surfaces as a real, rendered
  screenshot. Only caught during the manual browser verification pass, not
  by any automated check. Fix: `tableCard.overflow: "visible"` (safe here
  because rows' default background is transparent, so no square corners
  show through the parent's rounded ones). Generalizable lesson: any
  absolutely-positioned popover added inside an existing `overflow: hidden`
  card needs a manual screenshot check near the container's edges — tests
  passing is not evidence the popover is visible.
  (`src/app/repos/[repoId]/pulls/styles.ts:91-99`)

## Open Questions

## Session Notes

- 2026-08-05 — Implemented `docs/findings-by-severity-plan.md` end-to-end
  (all 22 steps): server-side live per-severity findings aggregation on the
  PR list, click-popovers on both the PR list and the Agent-runs timeline,
  and the `Dropdown`/`SeverityCounts`/`FindingsPopoverList` primitives behind
  them. Verified via `pnpm typecheck` + full test suites (server unit +
  integration, client) in both packages, then a manual browser pass against
  seeded data — which is what caught the `overflow: hidden` clipping bug
  above; the plan itself didn't anticipate it.

- 2026-08-04 — `engineering-insights` did not auto-invoke during the whole
  `feat/review-cost` session (a multi-file feature with real findings — see
  above) despite matching its own "end of a non-trivial coding session"
  trigger in its `SKILL.md` description. It only ran because the user
  explicitly asked whether it had fired. Confirms the skill's own
  "Course arc" note in `references.md`: a description/manual trigger alone
  is not reliable enough without a `Stop` hook forcing it.
