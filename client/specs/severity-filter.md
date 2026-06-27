# Spec: Severity Filter (L01)

Filters the findings list by confidence level and sorts by severity.

## Where it appears

PR detail → **Agent Runs** tab → findings section beneath each run card (`FindingsPanel`).
One instance per run — a PR with multiple runs has multiple independent panels.

## What the filter actually is

The feature is a **"Hide low confidence" toggle** — not a severity dropdown. It is a boolean
`hideLow` state on `FindingsPanel`. When enabled, findings with `confidence < 0.65`
(`LOW_CONFIDENCE_THRESHOLD` in `constants.ts`) are hidden.

Severity sort is **always** applied (never filtered out), regardless of the toggle state:

| Sort order | Severity value |
|---|---|
| 1 (highest) | `CRITICAL` |
| 2 | `WARNING` |
| 3 (lowest) | `SUGGESTION` |

Both behaviours live in `visibleFindings()` (`helpers.ts`): filter by confidence, then sort by
`SEVERITY_ORDER`.

## Default state

Toggle is **off** (all findings shown) on initial mount. Not persisted — resets on navigation.

## Empty state

When all findings are hidden by the confidence toggle: `EmptyState` component renders with the
`Filter` icon and a message explaining the filter.

## Behavior

- Confidence filter: hide findings where `finding.confidence < 0.65`
- Sort: always CRITICAL → WARNING → SUGGESTION (ascending `SEVERITY_ORDER` value)
- Toggle is local component state (`useState(false)`) — each `FindingsPanel` instance is independent
- No effect on the run score, verdict, or finding-count badge — those are stored on the run record
  and do not react to UI filter state

## Keyboard shortcuts

| Key | Action |
|---|---|
| `j` / `k` | Move focus to next / previous finding |
| `a` | Accept focused finding |
| `d` | Dismiss focused finding |

## Interaction with other UI elements

- **Finding count badge** on the run card: reflects total findings from the run, not the visible
  subset
- **Verdict / score**: computed at run time from grounding; the UI filter has no effect
- **Diff tab**: unaffected — diff view has no awareness of the findings filter state
