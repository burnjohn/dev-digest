# Spec — Findings surfaces (PR list + Agent-runs timeline)

Status: IMPLEMENTED (2026-06-17). One design change during build: the PR-list
endpoint returns the latest batch's findings as full `Finding[]` records (not just
counts) so the chips AND the hover popover share one source — counts are derived
client-side via `countBySeverity`. See §4.2 note.
Owner: client (UI) + server (one list-endpoint data addition)
Related: `FindingCard`, `FindingsPanel`, `FindingsSection`, `SEV` tokens, `RunHistory`, `pulls/routes.ts`

## 1. Goal

Surface a PR's review **findings** in two places where today only an aggregate
score/cost is shown:

1. **Pull Requests list** (`/repos/:repoId/pulls`) — a new **FINDINGS** column with
   per-severity count chips, and a **hover popover** listing the findings.
2. **PR detail → Agent runs timeline** (`RunHistory` rows in the "Agent runs" tab) —
   per-severity count chips on each run row, and a **hover popover** listing
   *that run's* findings ("N FINDINGS IN THIS RUN").

Both popovers reuse one compact, read-only finding preview. No new finding actions
(accept/dismiss stay on the detail Findings panel only).

## 2. Visual reference (from designs)

**PR list row** — column order becomes: `PULL REQUEST · AUTHOR · SIZE · SCORE ·
FINDINGS · STATUS · COST · UPDATED`. The FINDINGS cell shows only the severities
present, each as `‹icon› ‹count›`:

- CRITICAL → `AlertOctagon`, `var(--crit)` (red)
- WARNING → `AlertTriangle`, `var(--warn)` (yellow)
- SUGGESTION → `Lightbulb`, `var(--sugg)` (blue)

Not-yet-reviewed PR (score == null) → `—`. Reviewed with zero findings → `—` (or a
muted check; see open question Q3).

**Hover popover (list)** — anchored to the row/cell, header `⊙ {total} FINDINGS`,
then a scrollable list of compact previews. Each preview: severity icon + title +
`CategoryTag`, then `file:line` (mono) + confidence, then a 2-line-clamped rationale.

**Timeline run row** — under the agent name, the existing `N findings · M blockers`
text is replaced by per-severity count chips + a muted `· N blockers` suffix when
blockers > 0. Hover anywhere on the row → popover header `⊙ {count} FINDINGS IN THIS
RUN` + the same compact preview list, scoped to that run.

## 3. Reuse vs. new

### Reuse (no change)
- `SEV` map (`@devdigest/ui` → `client/src/vendor/ui/primitives/tokens.ts`) — color + icon per severity.
- `CategoryTag`, `ConfidenceNum`, `MonoLink`, `Icon`, `Markdown`.
- `githubBlobUrl` for `file:line` deep-links (when `repoFullName` + `headSha` known).

### New shared components (live in `client/src/components/` per the cross-route convention)
1. **`FindingsCountChips`** — props `{ counts: { CRITICAL: number; WARNING: number; SUGGESTION: number }, size? }`.
   Renders an inline chip (`SEV[sev].icon` + number, `SEV[sev].c`) for each severity
   with count > 0, in CRITICAL→WARNING→SUGGESTION order. Renders nothing if all zero
   (callers decide the `—` fallback). Used by both surfaces.
2. **`FindingPreview`** — compact, read-only single finding. Extracted from the
   `FindingsSection` card markup (severity icon/badge + title + `CategoryTag`,
   `file:line` mono link, `ConfidenceNum`, rationale clamped to ~2 lines). No actions,
   no expand. Props `{ f: FindingRecord, repoFullName?, headSha? }`.
3. **`FindingsHoverCard`** — the hover-popover primitive (none exists today). Anchor +
   floating panel:
   - Trigger: `onMouseEnter`/`onMouseLeave` on the anchor with a small open/close
     delay (~120 ms) so moving into the panel doesn't dismiss it.
   - Panel: absolutely positioned, `max-height` with internal scroll, `z-index` above
     rows, header slot + children. Closes on `Escape` and on scroll of the underlying
     list. Keyboard/focus: anchor is focusable; popover is `aria-hidden` decoration of
     already-visible counts (the full, actionable list remains the detail Findings
     panel), so it is hover/focus-reveal only — not a focus trap.
   - Props `{ header: ReactNode, children: ReactNode, anchor: ReactNode }`.

> Rationale for a bespoke popover: the repo has no Popover/Tooltip/HoverCard primitive
> and pulls in no positioning lib. Keep it dependency-free and minimal; if a third
> surface ever needs it, promote to `@devdigest/ui`.

## 4. Data

### 4.1 Timeline run popover — NO server change
Client already has both halves:
- `prRuns: RunSummary[]` (timeline rows, has `findings_count`, `blockers`).
- `runs: ReviewRecord[]` (each has `run_id` + `findings: FindingRecord[]`).

In `FindingsTab`, build `findingsByRunId = new Map(runs.filter(r => r.run_id).map(r => [r.run_id, r.findings]))`
and pass it into `RunHistory`. Per run row:
- counts = group that run's findings by severity (exact per-severity chips).
- popover list = that run's findings.
- Fallback: a run with no matching `ReviewRecord` (e.g. failed/cancelled, or summary
  kind) shows no chips; if `findings_count > 0` but findings aren't loaded, show a
  single neutral `{findings_count}` chip and no popover.

### 4.2 PR list — server change REQUIRED
`GET /repos/:id/pulls` today intentionally omits the per-severity breakdown
(`server/src/modules/pulls/routes.ts:114-117`). Add it, mirroring the existing
score/cost on-read IN-query + JS-grouping pattern.

**Contract change** (`@devdigest/shared` → `platform.ts` `PrMeta`, then re-vendored to
client + server `vendor/shared`):
```ts
// PrMeta, list endpoint only; null/absent until reviewed.
findings: z.object({
  CRITICAL: z.number().int(),
  WARNING: z.number().int(),
  SUGGESTION: z.number().int(),
}).nullish(),
```
(Note: `client/src/lib/types.ts` `PrRowView` already declares this exact shape — keep
them aligned; `PrRowView` is the UI view-model, `PrMeta.findings` is the wire field.)

**Server aggregation** — for each PR id, join `findings` → `reviews` and group by
severity. Scope to match the source of the visible findings:
- Selected default (Q1): the **latest review batch** per PR — same `BATCH_WINDOW_MS`
  grouping already used for `cost_usd`, so the chips, the score ring, and the cost all
  describe the same run batch. Implementation: collect the latest batch's `review` ids
  per PR (reviews whose run ran within the window), then one IN-query over `findings`
  grouped `(pr, severity)`.

> Do not hand-edit `server/src/db/migrations/` — no schema change is needed (findings
> table already stores `severity`); this is a read-side aggregation only.

## 5. Files touched

### Client
- `client/src/components/FindingsCountChips/` (new: component, styles, index, test)
- `client/src/components/FindingPreview/` (new: extracted compact card)
- `client/src/components/FindingsHoverCard/` (new: hover popover primitive)
- `client/src/app/repos/[repoId]/pulls/constants.ts` — add `"findings"` to `COLUMN_KEYS`
  (between `score` and `status`) AND widen `GRID` to 8 tracks (keep both length-aligned —
  known gotcha, `client/INSIGHTS.md`).
- `.../pulls/_components/PRRow/PRRow.tsx` — render the FINDINGS cell (chips + hover card),
  insert between score cell and status cell.
- `.../pulls/styles.ts` — `findingsCell` style if needed.
- `.../pulls/[number]/_components/FindingsTab/FindingsTab.tsx` — build `findingsByRunId`,
  pass to `RunHistory`.
- `.../RunHistory/RunHistory.tsx` — accept `findingsByRunId`; replace the plain
  `findings/blockers` text line with `FindingsCountChips` + blockers suffix; wrap the
  row in `FindingsHoverCard` showing that run's previews.
- `client/messages/en/prReview.json` — new keys: `list.columns.findings`,
  `findings.popoverHeader` (`{count} findings`), `timeline.findingsInRun`
  (`{count} findings in this run`). (en is the only locale; missing key renders the raw key.)

### Server
- `server/src/vendor/shared/contracts/platform.ts` (+ the `@devdigest/shared` source of
  truth, then client `vendor/shared`) — add `PrMeta.findings`.
- `server/src/modules/pulls/routes.ts` — add the per-severity aggregation block and emit
  `findings` in the list `.map(...)`; update the comment at L114-117 (no longer omitted).

## 6. Tests
- `FindingsCountChips`: renders only nonzero severities, correct order/colors, empty → null.
- `FindingPreview`: title/category/file:line/confidence render; rationale clamps; link
  present only with repoFullName+headSha.
- `FindingsHoverCard`: opens on enter, stays open moving into panel, closes on leave/Escape.
- `PRRow`: FINDINGS cell shows chips when counts present, `—` when reviewed-zero /
  unreviewed. Header/cell alignment count stays in sync (GRID vs COLUMN_KEYS).
- `RunHistory`: per-run chips reflect that run's findings; blockers suffix; popover scoped
  to the run; failed/cancelled run shows no chips/popover.
- Server `pulls` list: returns correct per-severity `findings` for the latest batch;
  null/absent for unreviewed PRs; workspace-scoped.

## 7. Decisions (resolved 2026-06-17)
- **Q1 — PR-list findings source → LATEST REVIEW BATCH.** Same `BATCH_WINDOW_MS`
  grouping as `cost_usd`, so chips, score ring, and cost all describe one "Review all"
  batch.
- **Q2 — popover list length → SCROLL ALL.** Show every finding; internal scroll,
  `max-height ~ 320px`. No `+K more` footer.
- **Q3 — reviewed-with-zero-findings cell → `—`.** Same as unreviewed; no green-check
  variant.
- **Q4 — tab rename → NO.** Keep the detail tab as-is. This feature only adds the
  FINDINGS column (per the mockup) + the timeline chips/popover; no tab renaming.
