# Findings by severity — PR list + Agent runs timeline

**Status:** done — implemented on `feat/findings-by-severity`, all 22 steps
landed, verified via automated tests + a manual browser pass (with the
`tableCard.overflow: hidden` clipping fix from step 22's manual pass, not
in the original plan).

## Context

Neither screen shows a severity breakdown today: `PRRow.tsx` has no
FINDINGS column at all, and `RunHistory.tsx`'s timeline shows a plain-text
total ("3 findings"). Mockups show compact per-severity badges
(🔴/🟡/🔵 + number) on both, opening a click-popover with the actual
findings (title, category, file:line, confidence%, rationale snippet).

Decisions already made: PR-list badge = the PR's **latest review** only
(not summed across agents — avoids double-counting the same finding flagged
by two agents). Counts are **live** (reflect current `dismissed_at`, not a
snapshot — an accepted finding still counts, only a dismissed one drops
out). Popover = click, reusing the existing `Dropdown` component (no hover,
no new floating-ui primitive). Both layers ship together.

Because counts must be live, they can't be a cheap static column
(unlike `cost_usd`/`score`/`blockers`) — they need a read-time query. That
makes Screen A (PR list) need real backend work, while Screen B (Agent runs
timeline) needs **none** — `GET /pulls/:id/reviews` already returns every
review's full findings (with `dismissed_at`) plus `run_id`, and the PR
detail page already fetches it; it just isn't threaded down to
`RunHistory` yet.

`server/src/modules/pulls/status.ts` already has `rollupSeverities()` /
`SeverityCounts` — written, unit-tested, unused. Reuse it, don't rewrite it.

## Plan

1. `server/src/vendor/shared/contracts/platform.ts` **and**
   `client/src/vendor/shared/contracts/platform.ts` — add to `PrMeta`:
   `latest_review_id: z.string().nullish()` and
   `findings: z.object({ critical: z.number().int(), warning: z.number().int(), suggestion: z.number().int() }).nullish()`.
2. `server/src/modules/pulls/routes.ts` — extend the existing
   `latestReviewByPr` map to also select `t.reviews.id`.
3. Same file — new query mirroring the existing `costByPr` block: select
   `{ reviewId, severity }` from `findings` where
   `reviewId IN (latestReviewIds) AND dismissedAt IS NULL`, group in JS by
   `reviewId` (fixed 2-query pattern, not N-query).
4. Same file — feed each group through `rollupSeverities()` (import from
   `./status.js`, already imports `deriveReviewStatus` from there) instead
   of writing new grouping logic.
5. Same file — add `latest_review_id` and `findings` to the row-mapping
   return; delete the stale "intentionally not surfaced" comment. No DB
   migration — pure read-time aggregation.
6. `client/src/vendor/ui/kit/Dropdown.tsx` — make `items` optional, add
   `children?: React.ReactNode` and `onOpenChange?: (open: boolean) => void`;
   backward compatible with all 6 existing callers.
7. New `client/src/vendor/ui/primitives/SeverityCounts.tsx` — stateless row
   of `SeverityBadge` (already supports `compact`+`count`) for nonzero
   severities only; export from `primitives/index.ts`.
8. New `client/src/components/findings-popover/helpers.ts` —
   `liveFindings()` (drops `dismissed_at`-set findings) and
   `sortForPopover()` (severity order, then confidence desc).
9. New `client/src/components/findings-popover/FindingsPopoverList.tsx` —
   popover body styled like `FindingCard`'s collapsed header
   (`SeverityBadge`, `CategoryTag`, `MonoLink`+`githubBlobUrl`,
   `ConfidenceNum`), plain-text truncated rationale (~140 chars, not
   `<Markdown>` — truncating markdown mid-token renders broken syntax),
   scrollable body (`maxHeight`/`overflow: auto`, no hard cap on count).
10. `client/src/lib/hooks/reviews.ts` — add `enabled` param:
    `usePrReviews(prId, enabled = true)`, backward compatible.
11. Same file — fix `useFindingAction`'s `onSuccess` to also
    `invalidateQueries({ queryKey: ["pulls"] })`. Real bug fix: today
    dismissing a finding never invalidates the list's cache key at all.
12. `client/src/app/repos/[repoId]/pulls/constants.ts` — add `"findings"`
    to `COLUMN_KEYS` (between `"score"` and `"status"`) + a matching `GRID`
    track.
13. `client/src/app/repos/[repoId]/pulls/styles.ts` — add a `findingsCell`
    style.
14. `PRRow.tsx` — new cell: `pr.findings == null` → "—"; all-zero → green
    "No findings"; otherwise a `Dropdown` (trigger = `SeverityCounts`,
    `onOpenChange` drives a lazy `usePrReviews(pr.id, open)` filtered to
    `latest_review_id`, content = `FindingsPopoverList`). Wrap the whole
    cell in `onClick={(e) => e.stopPropagation()}` from the **outside** of
    `<Dropdown>` — the row itself navigates on click and `Dropdown`'s
    trigger doesn't stop propagation on its own (same pattern already used
    by `ReviewRunAccordion`'s delete button).
15. `FindingsTab.tsx` — pass `reviews={runs}` to its existing `RunHistory`
    call (the data's already fetched on this page, just not threaded down).
16. `RunHistory.tsx` — accept `reviews?: ReviewRecord[]`, match each run by
    `run_id`, replace the plain-text findings line with
    `SeverityCounts`+`Dropdown` (no lazy fetch needed, no `stopPropagation`
    needed — this list has no row-level click to guard against).
17. `client/messages/en/prReview.json` — add `list.columns.findings`,
    `list.findingsNone`, and a `findingsPopover.{header,empty,loading}`
    block.
18. `server/test/reviews.it.test.ts` — extend the existing map-reduce test
    to assert `latest_review_id`/`findings` on the list response; add an
    assertion that dismissing a finding then re-fetching the list drops the
    count (the one test proving "live," not snapshot, behavior).
19. `PRRow.test.tsx` — extend the `pr()` factory + add reviewed/zero/null
    cases (mock `@/lib/hooks/reviews` for the lazy fetch).
20. `RunHistory.test.tsx` — extend `renderRuns` with an optional `reviews`
    param; assert badges render for a matched run and the plain-text
    fallback for an unmatched one.
21. New `FindingsPopoverList.test.tsx` (happy path + empty) and
    `Dropdown.test.tsx` (first direct test of this shared component —
    cover both the new `children`/`onOpenChange` path and the existing
    `items` path, since 6+ other consumers depend on it staying correct).
22. Verify: `pnpm typecheck && pnpm test` in `server/` and `client/`, then
    a manual pass — badges render and match the mockups; clicking one opens
    a popover with the right findings; dismissing a finding and returning
    to the list shows the dropped count without a manual refresh; the
    timeline's per-run badges reflect that run's own findings, not the PR's
    latest-review findings, when a non-latest run is shown.

## Reference

Rendered version (design pass, same content): https://claude.ai/code/artifact/5d10c33e-a8cb-4b44-9f60-7d97408861a0
