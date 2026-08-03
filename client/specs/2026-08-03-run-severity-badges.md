# Spec: Severity badges on timeline run rows

**Date:** 2026-08-03 · **Scope:** client-only · **Status:** approved

## What

In the PR page's "Agent runs" timeline, each settled run row replaces the flat
`{count} finding(s)` text with a **sorted severity badge group**:

- One badge per severity with a non-zero count, ordered CRITICAL → WARNING → SUGGESTION.
- Each badge: the severity's icon + count, in the severity's color (vendor `SeverityBadge compact`).
- The existing `· N blockers` suffix stays, rendered outside the group (unchanged semantics:
  `blockers` is the stored per-agent CI-gate count — findings with severity ≥ the agent's
  `ci_fail_on`; shown only when > 0).

**Hover** over the group opens a popover:

- Title `N FINDINGS` (uppercase by style).
- Findings sorted severity desc, then confidence desc; capped at 5 with a `+N more` footer.
- Each row: severity icon (SEV color), bold title, `CategoryTag`, mono `file:start-end`,
  `NN% conf` (vendor `ConfidenceNum`), `rationale` as plain text clamped to 2 lines.

**Click** on the group opens the existing run-trace drawer (`?trace=<runId>`), the same
path as the FileText icon button.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Counts include dismissed findings? | **Yes — count all** | Badges are a grouping of what the run produced; the sum matches the stored `findings_count` and the row's outcome color. Dismissed findings are visible in the hover. Toggle: `COUNT_DISMISSED` in `RunSeverityBadges/constants.ts`. |
| Scope | **Timeline rows only** | Matches the design screenshots. The component takes `{ findings, onClick? }` (independent of `RunSummary`), so dropping it into `ReviewRunAccordion` headers later is a one-line change. |
| Fallback | Plain `{count} finding(s)` text | When findings for a run are unavailable (running/failed/cancelled runs, deleted review, reviews query still loading) the row renders exactly what it does today — the feature is purely additive. |

## Client-only — rejected alternative

The timeline endpoint (`GET /pulls/:id/runs` → `RunSummary`) has no per-severity data,
but the page already fetches every finding via `usePrReviews(prId)` → `ReviewRecord[]`
(`run_id` + `findings[]`) and already joins reviews→runs client-side — that is how the
trace drawer gets its findings (`page.tsx`). `FindingRecord` carries every field the
hover needs. Dated precedent for the same choice: `server/INSIGHTS.md` 2026-08-02 —
run cost is joined client-side through `reviews.run_id` "because the timeline on the
same page has already fetched the run list".

**Rejected:** extending `RunSummary` with `findings_by_severity` (name already reserved
in `contracts/observability.ts`) plus a `groupBy` over `reviews ⋈ findings`. Not needed
while the data is already on the page; revisit only if the timeline is ever decoupled
from the reviews query. It would also touch `vendor/shared` in both packages (coordinate
policy) and want indexes on `findings.review_id` / `reviews.run_id`.

## Implementation notes

- New `_components/RunSeverityBadges/` (component + internal `RunFindingsPopover` +
  `constants.ts` + colocated tests).
- No Tooltip/Popover primitive exists in `vendor/ui` (and vendor is read-only) — the
  popover is local: React `open` state on a `position:relative` anchor, popover rendered
  as a DOM child so `mouseleave` doesn't fire when moving the pointer into the panel
  (no timers). Visual gap via the panel's own `paddingTop`, not an offset.
- A11y: the group is a real `<button>` (`aria-expanded`, `aria-label`), focus/blur mirror
  hover, panel has `role="tooltip"`. No focus trap — nothing interactive inside.
- Panel: `zIndex 40` (Dropdown precedent; trace drawer is fixed at 50), `width min(380px, 70vw)`,
  `maxHeight 320` + scroll. No viewport-flip logic.
- Data flow: `FindingsTab` builds `Map<run_id, FindingRecord[]>` from the reviews it
  already receives (`useMemo`) and passes it to `RunHistory` as an optional prop.
- Sorting reuses `SEVERITY_ORDER` from `../FindingsPanel/constants` — no fourth ad-hoc
  severity map.
