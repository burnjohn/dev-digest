# Findings severity counters

**Status:** shipped
**Packages touched:** server, client (`@devdigest/shared` contract change)

## Problem

A review's output is a list of findings, but nowhere in the product can you see
**how bad** a PR is at a glance. The PR list shows a score ring and a cost; the
Agent runs timeline shows `2 findings · 2 blockers`. Both collapse three very
different things — a leaked secret, an N+1 query, a magic number — into one
number. Triage ("which PR do I open first?") is the core job of the list, and it
currently cannot be done without opening every PR.

The fix is a per-severity counter — `⛔2 ⚠2 💡2` — on both surfaces, where each
chip is clickable and opens a popover listing **only that severity's** findings.

Note: `server/src/modules/pulls/status.ts` already claims the PR list shows "a
FINDINGS severity breakdown" and exports a tested-but-unused `rollupSeverities`;
`client/src/lib/types.ts:38` declares a dead `PrRowView` with a
`findings: { CRITICAL; WARNING; SUGGESTION }` field. This spec finishes work
that was scaffolded and never wired.

## Scope — in / out

**In**

- A `FINDINGS` column on the PR list (`/repos/:repoId/pulls`), between SCORE and
  STATUS, showing up to three severity chips with counts.
- The same chips on each run row of the PR detail → **Agent runs** tab timeline,
  replacing the `{n} finding(s)` text line (the `· {n} blockers` suffix stays).
- Clicking a chip opens a popover listing only that severity's findings: title,
  category tag, `file:start-end`, confidence, rationale excerpt.
- A reusable `SeverityCounters` + `FindingsPopover` pair used by both surfaces.

**Out**

- `ReviewRunAccordion` (the "Review runs" section below the timeline) keeps its
  current `N findings · M blockers` header — it already expands to the full
  `FindingsPanel`, so a counter there is redundant.
- No severity **filter** on the list (chips open a popover; they do not filter
  the table). No sort-by-severity.
- No new column on the Eval Dashboard / Agent Performance pages.

## Decisions

| Question | Decision |
| --- | --- |
| Chip interaction | **Click** (not hover) → popover filtered to that severity. Row navigation must not fire; the chip stops propagation. |
| PR-list rollup scope | **Latest review per agent.** A PR reviewed by Security + Performance sums both agents' newest reviews; an older re-run of the same agent is ignored. |
| Which findings count | **Dismissed findings are excluded** (a dismissed finding is resolved and must stop alarming). Low-confidence findings **are** counted — `hideLowConfidence` in `FindingsPanel` stays a view-level toggle only. |
| Timeline chip scope | **Per run** — the breakdown of the review that run produced, not the PR total. |
| Zero state | A PR with no review shows `—` (same as the score column). A reviewed PR with zero findings shows a single muted `0 findings`. Severities with a count of 0 render no chip. |

## Contract changes

`@devdigest/shared` first, then consumers. **Both copies must be edited**:
`server/src/vendor/shared/` and `client/src/vendor/shared/`.

`contracts/findings.ts` — new, reusing the field name already used by
`observability.ts:111` and `productionize.ts:156`:

```ts
export const SeverityCounts = z.object({
  CRITICAL: z.number().int(),
  WARNING: z.number().int(),
  SUGGESTION: z.number().int(),
});
export type SeverityCounts = z.infer<typeof SeverityCounts>;
```

`contracts/platform.ts` — `PrMeta` gains one field:

```ts
  /** Per-severity findings across the LATEST review of each agent, excluding
   *  dismissed ones (list endpoint only). Null until the PR has been reviewed. */
  findings_by_severity: SeverityCounts.nullish(),
```

`RunSummary` (`contracts/trace.ts`) is **not** changed — see below.

## Server

Only the PR list needs new server work. The Agent runs timeline already loads
every review (with its findings) via `GET /pulls/:id/reviews`, so its per-run
breakdown is derived client-side from data already in the TanStack cache. That
keeps a single fetch, and makes the timeline chips update the instant a finding
is dismissed in the panel below.

### `GET /repos/:id/pulls` — `server/src/modules/pulls/routes.ts`

Add a third per-PR rollup block, structurally identical to the existing
latest-review SCORE (`:113-129`) and latest-run COST (`:131-148`) blocks: one
`inArray` query, newest-first, grouped in JS. Update the stale comment at
`:115-117` that says the breakdown is "intentionally not surfaced".

```
select reviews.prId, reviews.id, reviews.agentId, reviews.createdAt,
       findings.severity, findings.dismissedAt
from findings join reviews on findings.review_id = reviews.id
where reviews.pr_id in (:prIds) and reviews.kind = 'review'
order by reviews.created_at desc
```

Group per PR → keep only rows whose `reviewId` is the newest review for its
`agentId` → tally non-dismissed severities. Reviews with a null `agentId` each
count once (keyed by their own review id). Project
`findings_by_severity: counts ?? null` — null exactly when the PR has no
`kind='review'` row, matching the existing `score: null` behaviour.

### Pure helpers — `server/src/modules/pulls/status.ts`

Extend this file (it already holds the PR-list rollup helpers and is unit-tested
by `server/test/pulls-status.test.ts`):

- **Rewrite** `rollupSeverities` to return the contract's uppercase
  `SeverityCounts` instead of the current `{ critical, warning, suggestion }`,
  and to skip rows with a non-null `dismissedAt`. It is currently dead code, so
  only its test needs updating.
- **Add** `selectLatestReviewPerAgent(rows)` — takes newest-first review rows,
  returns the set of review ids to count.

### Schema

No new tables or columns. Add two indexes — `findings` and `reviews` have
**none** today, and this rollup joins across both on every list load:

```ts
// server/src/db/schema/reviews.ts
(t) => [index('findings_review_id_idx').on(t.reviewId)]   // on findings
(t) => [index('reviews_pr_id_idx').on(t.prId)]            // on reviews
```

Generate the migration with `pnpm db:generate`, never hand-write it.

## Client

No new dependency. There is no `Popover`/`Tooltip` primitive today, and
`src/vendor/ui/**` is off-limits, so the popover is a new app-level component
modelled on `src/vendor/ui/kit/Dropdown.tsx:60-110` (relative wrapper +
absolute panel, `mousedown` outside-close; add Escape-to-close).

### New components

- `src/components/severity-counters/SeverityCounters.tsx` — renders the chips.
  Uses the existing **`SeverityBadge`** (`src/vendor/ui/primitives/Badge.tsx:50`,
  already supports `count` and `compact`) so severity colour + icon stay on the
  single source of truth `SEV` map (`primitives/tokens.ts:5`). Skips zero
  counts; renders `—` when counts are null.
- `src/components/findings-popover/FindingsPopover.tsx` — the panel: header
  `{n} {SEVERITY} FINDINGS`, then rows of `FindingRecord` (title +
  `CategoryTag`, mono `file:start-end`, `{n}% conf`, 2-line rationale). Caps at
  8 rows with a `+N more` footer linking to the PR's Agent runs tab.

### New pure helper — `src/lib/findings.ts`

Mirrors the server rule so both surfaces agree:
`latestReviewPerAgent(reviews)`, `countBySeverity(findings)` (skips
`dismissed_at`), `findingsOfSeverity(findings, sev)`.

### PR list — `src/app/repos/[repoId]/pulls/`

Adding a column touches four declarations that the code comments already flag as
needing lockstep:

1. `constants.ts` — `GRID` gains a track after SCORE; `COLUMN_KEYS` gains
   `"findings"` after `"score"`.
2. `_components/PRRow/PRRow.tsx` — a new cell after the score cell:
   `<SeverityCounters counts={pr.findings_by_severity} prId={pr.id} />`. The
   chip's `onClick` **must** `stopPropagation()` — the whole row is a
   `router.push` target (`PRRow.tsx:25`).
3. `client/messages/en/prReview.json` — `list.columns.findings`.
4. Popover content is fetched lazily: `usePrReviews(pr.id)`
   (`src/lib/hooks/reviews.ts:51`) enabled only while the popover is open, so
   the list itself stays a single request. Show a `Skeleton` while it loads;
   the result is cached and reused when the user opens the PR.

### Agent runs timeline

- `FindingsTab.tsx` already holds the reviews array; build a
  `Map<run_id, FindingRecord[]>` from `review.run_id` and pass it to
  `RunHistory` as a new optional `findingsByRun` prop.
- `RunHistory.tsx:150-224` — replace the
  `{t("runStatus.findings", …)}{blockers}` text line with `<SeverityCounters>`,
  keeping the ` · {n} blockers` suffix. When a run has no matching review
  (failed run, or reviews still loading) fall back to today's text using the
  denormalized `run.findings_count`. `outcomeOf()` is unchanged — the badge
  still reflects the CI gate, not the breakdown.

### i18n

New keys in `client/messages/en/prReview.json`: `list.columns.findings`,
`findingsPopover.{titleForPr,titleInRun,conf,more,empty,loading}`, plus
`aria.severityChip` (`"{count} {severity} findings"`).

### Accessibility

Chips are real `<button>`s with `aria-haspopup="dialog"`, `aria-expanded` and an
`aria-label` spelling out severity + count. `SeverityBadge` already pairs colour
with an icon (never colour alone), which the counters inherit.

## Acceptance criteria

1. The PR list has a `FINDINGS` column. A PR reviewed by two agents shows the
   **sum of each agent's newest review**; an older re-run of the same agent does
   not inflate the numbers.
2. Dismissing a finding on the PR detail page and returning to the list shows a
   count lower by one. A low-confidence finding still counts.
3. Clicking the `⚠` chip opens a popover listing **only** WARNING findings, with
   the correct total in its header — never CRITICAL or SUGGESTION rows.
4. Clicking a chip does **not** navigate to the PR; clicking anywhere else on
   the row still does. Clicking outside, or pressing Escape, closes the popover.
5. A PR with no review shows `—`; a reviewed PR with zero findings shows a
   single muted zero state; a severity with count 0 renders no chip.
6. On the Agent runs tab, each run row shows the breakdown **of that run's own
   review**; the totals across run rows and the counters on the list agree for
   a single-agent, single-run PR.
7. A failed run (no review) still renders, with no counters and its error text
   intact.
8. `GET /repos/:id/pulls` issues one additional query regardless of PR count
   (no N+1); `findings_by_severity` parses against `PrMeta`.

## Testing

- `server/test/pulls-status.test.ts` — update for the new `SeverityCounts`
  shape; add cases for dismissed exclusion and latest-per-agent selection
  (including the null-`agentId` case).
- New `server/test/pulls-findings-rollup.it.test.ts` (DB-backed, testcontainers
  — the `.it.test.ts` suffix is what routes it there) seeding two agents × two
  reviews plus one dismissed finding, asserting the endpoint's counts.
- New client tests beside the components (`SeverityCounters.test.tsx`,
  `FindingsPopover.test.tsx`) — zero state, chip click opens a severity-filtered
  list, Escape closes, `stopPropagation` keeps the row from navigating.
- Extend `RunHistory.test.tsx` for the counters + the `findings_count` fallback.

## Open questions

- The `+N more` footer caps the popover at 8 findings. If a real PR routinely
  exceeds that, an inner scroll may read better than a link out.
- `SEV` in `primitives/tokens.ts` carries a fourth `INFO` entry that the Zod
  `Severity` enum does not define. The counters ignore it; whether `INFO` should
  be dropped from the token map is a separate cleanup.
