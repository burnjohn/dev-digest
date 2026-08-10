# Implementation Plan — Severity findings indicators (PR list + Agent runs timeline)

> Self-contained brief for a fresh session. All paths are relative to the repo root
> `C:\D\Youtube Personal Brand\AI Engineer Channel\neoversity\DevDigest`.
> DevDigest is **four standalone packages** (no root `package.json`): run every command
> from inside the package with **pnpm**. Touched modules: `client/` and `server/`.

## Session protocol (do this first)

Per `CLAUDE.md`, before writing code read the `INSIGHTS.md` of each module you touch and
summarize the most relevant points back:
- `client/INSIGHTS.md`
- `server/INSIGHTS.md`

Contracts are **shared Zod schemas** vendored in two mirrored copies that must stay identical:
`server/src/vendor/shared/contracts/*` (source of truth) and `client/src/vendor/shared/contracts/*`.
Edit the contract, not the two ends separately.

---

## 1. Goal & behavior

Add a **row of clickable severity icons with counts** to two places:

- **Pull Requests list** (`/repos/:repoId/pulls`) — a new **FINDINGS** column, one summary per PR
  aggregated across **all runs, excluding dismissed findings, de-duplicated** so the same finding
  surfacing in multiple runs counts once (product decision, confirmed). See the dedup key in §8.
- **Agent runs timeline** (PR detail → "Agent runs" tab) — one indicator **per agent run**.

Interaction (identical on both):
- Show an icon **only** for a severity that has ≥1 finding. Three severities exist in data:
  `CRITICAL`, `WARNING`, `SUGGESTION` (see `Severity` enum,
  `client/src/vendor/shared/contracts/findings.ts:11`). `INFO` in the UI tokens is unused here.
- **Hover** the strip → popup listing **all** findings.
- **Click a specific severity icon** → popup **filtered to that level**. In-popup filter chips
  switch between levels / all.
- Each finding row in the popup **deep-links to GitHub** at the exact line range (see §5).
- Close popup on click-outside, `Esc`, **and when the pointer leaves the icons + popup area**.
- **Only ONE popup is ever open at a time** across the whole page (see §3a — a global single-instance
  registry). Hovering row after row must NOT stack multiple popups.

The supplied screenshots are the **design spec** — this UI does not exist yet.

Icon note: CRITICAL renders as an **octagon** (`AlertOctagon`), not a literal red circle — that is
the existing token; keep it for consistency.

> ⚠️ **Two bugs bit the first implementation — read §3a before writing the popup.**
> 1. **Clipping:** an in-flow absolutely-positioned panel is **cut off** by the PR-list table card,
>    which sets `overflow: hidden` (`pulls/styles.ts` `tableCard`). Fix: render the popup through a
>    **portal to `document.body`** with `position: fixed`. A portalled panel is not a DOM descendant
>    of the card, so it *cannot* be clipped.
> 2. **Stacking / never closing:** opening on `onMouseEnter` with only click-outside/`Esc` to close
>    leaves a popup open per hovered row → many stacked popups. Fix: close on mouse-leave (grace
>    delay) **and** a global single-instance registry.

---

## 2. Reused building blocks (do NOT re-create)

| Thing | Where | Notes |
|---|---|---|
| `SeverityBadge({ severity, count?, compact? })` | `client/src/vendor/ui/primitives/Badge.tsx:52` | icon + optional count; `compact` drops the text label. Exported from `@devdigest/ui`. |
| `SEV` tokens (icon/color/label per severity) | `client/src/vendor/ui/primitives/tokens.ts:6` | CRITICAL→`AlertOctagon`/`--crit`, WARNING→`AlertTriangle`/`--warn`, SUGGESTION→`Lightbulb`/`--sugg`. |
| `CategoryTag`, `MonoLink`, `ConfidenceNum`, `Markdown`, `Icon` | `@devdigest/ui` | already used by `FindingCard`; reuse for compact popup rows. |
| `lineLabel(f)` | `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/helpers.ts` | formats `start_line`/`end_line` → "12" or "45-52". |
| `githubBlobUrl(repoFullName, sha, file, startLine?, endLine?)` | `client/src/lib/github-urls.ts:24` | builds `…/blob/{sha}/{file}#L{start}[-L{end}]`. |
| `rollupSeverities(rows) → { critical, warning, suggestion }` + `SeverityCounts` | `server/src/modules/pulls/status.ts:16` | pure tally helper; unit-tested. |
| `usePrReviews(prId)` → `ReviewRecord[]` (with `findings`) | `client/src/lib/hooks/reviews.ts:51` | `enabled: !!prId` — pass `null` to defer the fetch. |
| `Dropdown` click-outside pattern | `client/src/vendor/ui/kit/Dropdown.tsx:75-81` | reference for the `mousedown` document listener ONLY. There is **no** popover/tooltip primitive and **no** positioning engine (Radix/Floating UI are not deps). **Do NOT copy its `position:absolute` panel** — that gets clipped by `overflow:hidden` ancestors (the PR-list `tableCard`). Portal + `position:fixed` instead (§3a). |
| Global CSS keyframes `ddpop` / `ddspin` | app-wide (used by `Dropdown` / `FindingsTab`) | reuse for the popup pop-in and the loading spinner; already defined, don't redeclare. |

Key data linkage: `ReviewRecord.run_id` === `RunSummary.run_id` (`reviews.run_id` column,
`server/src/db/schema/reviews.ts:19`) — this joins a timeline run row to its findings.

**Dedup key** (used by the PR-list summary only — see §5, §8):
```ts
const findingKey = (f) =>
  `${f.severity}|${f.file}|${f.start_line}|${f.end_line}|${f.title.trim().toLowerCase()}`;
```
The per-run **timeline** indicator does NOT dedup — each run shows its own findings verbatim.

Finding shape consumed by the UI — `FindingRecord`
(`client/src/vendor/shared/contracts/review-api.ts:15`): `Finding` +
`{ review_id, accepted_at, dismissed_at }`. Base `Finding`
(`.../findings.ts:47`): `id, severity, category, title, file, start_line, end_line, rationale,
suggestion, confidence, kind`.

---

## 3. New shared component — `FindingsIndicator` (presentational)

Location: **`client/src/components/findings-indicator/`** — a cross-route shared component (like
`components/app-shell`), NOT in `vendor/ui`, so it may import `FindingRecord` from
`@devdigest/shared` without coupling the design system to contracts.

Files: `FindingsIndicator.tsx`, `styles.ts`, `index.ts`, `FindingsIndicator.test.tsx`.

Props (fully presentational — no data fetching inside; callers supply data + filter dismissed):
```ts
interface FindingsIndicatorProps {
  counts: { CRITICAL: number; WARNING: number; SUGGESTION: number };
  findings: FindingRecord[];      // popup content; caller has already filtered dismissed
  loading?: boolean;              // popup shows a spinner while lazily-loaded findings arrive
  variant?: "run" | "pr";         // popup header only: "N findings in this run" vs "N findings"
  repoFullName?: string | null;   // for GitHub deep-links
  headSha?: string | null;        // pins blob links to the reviewed sha
}
```

Behavior:
- Render one clickable **`<button>`** wrapping `SeverityBadge compact count` per non-zero severity,
  in order CRITICAL → WARNING → SUGGESTION. Each button `aria-label`ed (e.g. "2 critical findings").
- Local state: `open: boolean`, `filter: Severity | "all"`. Refs: `stripRef`, `popupRef`.
  - `onMouseEnter` strip → cancel pending close, `open=true`. Set `filter="all"` **only when opening
    fresh** (`if (!open) setFilter("all")`) — re-entering the strip while already open must PRESERVE a
    filter the user picked (otherwise moving the pointer back over the icons resets it to "all").
  - `onClick` a badge → cancel pending close, `open=true`, `filter=<that severity>`.
  - `onMouseLeave` strip **or** popup → schedule close (grace delay ~140ms, see §3a).
  - Click-outside (document `mousedown`, checking **both** `stripRef` and `popupRef` — the portalled
    panel is not inside the strip's subtree) + `Esc` → `open=false`.
- Popup content (rendered into the portal panel — §3a): Header = count + label per `variant`.
  Filter chips (All / present severities) drive `filter`. Body = the filtered findings as **compact
  rows**: `SeverityBadge compact` · title · `CategoryTag` · `MonoLink` to
  `githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)` showing
  `f.file:{lineLabel(f)}` (only when `repoFullName && headSha`, else plain text) · `ConfidenceNum` ·
  optional one-line rationale snippet. If `loading`, show a spinner (`Icon.RefreshCw` + `ddspin`).
- User-facing strings via **next-intl** (`useTranslations("prReview")`), not hardcoded literals
  (client convention). Add keys under a new `findings.indicator` namespace in
  `client/messages/en/prReview.json`. Use ICU plural for the aria/header strings, e.g.
  `"{count, plural, one {# critical finding} other {# critical findings}}"`.

### 3a. Popup MUST portal + be a single self-dismissing instance (learned the hard way)

**Portal + fixed positioning** — the panel renders via `createPortal(panel, document.body)` with
`position: fixed`. An in-flow `position:absolute` panel gets clipped by the PR-list `tableCard`
(`overflow:hidden`); portalling to `document.body` removes it from that ancestor so it can't be
clipped. Positioning is collision-aware and recomputed on scroll+resize:
```ts
const recompute = () => {
  const r = stripRef.current!.getBoundingClientRect();
  const margin = 8, GAP = 6, WIDTH = 420, MIN_H = 220;
  const width = Math.min(WIDTH, window.innerWidth - margin * 2);
  const left  = Math.min(Math.max(r.left, margin), window.innerWidth - width - margin); // clamp into viewport
  const below = window.innerHeight - r.bottom - margin, above = r.top - margin;
  setPos(below >= MIN_H || below >= above           // flip above when there's more room up
    ? { left, top: r.bottom + GAP, width, maxHeight: Math.max(below, MIN_H) }
    : { left, bottom: window.innerHeight - r.top + GAP, width, maxHeight: above });
};
// useLayoutEffect(open): recompute(); window.addEventListener('scroll', recompute, true /*capture: ancestor scroll*/);
//                        window.addEventListener('resize', recompute);
```
Panel style: `{ ...visualStyle, position:'fixed', left, top, bottom, width, maxHeight, display:'flex',
flexDirection:'column', overflow:'hidden', visibility: pos ? 'visible' : 'hidden' }` (hide until first
measure so it never flashes at 0,0). The findings list is `flex:1; minHeight:0; overflowY:auto` so it
scrolls inside the capped panel. Guard the portal for SSR: `open && typeof document !== 'undefined' && createPortal(...)`.

**Close on mouse-leave (grace delay)** — since the portal panel is NOT a child of the strip, one
`onMouseLeave` can't cover both. Track a `closeTimer` ref: `scheduleClose()` (both strip & panel
`onMouseLeave`) sets `setTimeout(() => setOpen(false), 140)`; `cancelScheduledClose()` (both
`onMouseEnter`, and every open path) clears it. The delay lets the pointer cross the `GAP` between
strip and panel without closing. Clear the timer on unmount.

**Global single-instance registry** — module-level, so only one popup exists page-wide (each `PRRow`
and each timeline run mounts its own indicator; without this, hovering several stacks several popups):
```ts
const openPopups = new Set<() => void>();
function closeOthers(keep: () => void) { for (const c of openPopups) if (c !== keep) c(); }
// in component: const close = useCallback(() => setOpen(false), []);
// useEffect([open, close]): if (!open) { openPopups.delete(close); return; }
//                           closeOthers(close); openPopups.add(close);
//                           return () => openPopups.delete(close);
```

Test (`FindingsIndicator.test.tsx`, vitest + jsdom, `fetch` not needed — pure component):
- Only non-zero severities render an icon; renders nothing when all-zero.
- Clicking a severity badge opens the popup filtered to that level; hover opens it unfiltered.
- Filter chips switch the visible set; `loading` shows a spinner, not rows.
- **Preserves a picked filter on strip re-entry** — click a severity, then `mouseEnter` the strip
  again; the popup stays filtered to that severity (guards the `if (!open) setFilter("all")` rule).
- **Portals to `document.body`** — assert `container.contains(dialog) === false` and
  `dialog.parentElement === document.body` and `dialog.style.position === 'fixed'` (regression guard
  against reintroducing the clipped absolute panel).
- **Single instance** — render two indicators; opening the second closes the first
  (`getAllByRole('dialog')` has length 1).
- **Mouse-leave closes** (fake timers: `mouseLeave` strip → `advanceTimersByTime(300)` → gone) and
  **strip→popup does NOT close** (`mouseLeave` strip then `mouseEnter` dialog → still open).

Note: in jsdom `getBoundingClientRect()` returns zeros and `window.inner{Width,Height}` default to
1024×768 — positioning still computes fine, and `getByRole('dialog')` finds the portalled panel via
`screen` (it queries all of `document.body`).

---

## 4. Agent runs timeline (client only — NO server change)

The PR detail page already loads full findings: `page.tsx` fetches `reviews: ReviewRecord[]` and
passes them as `runs` to `FindingsTab`
(`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx`).

Steps:
1. In `FindingsTab`, build a map and pass it to `RunHistory`:
   ```ts
   const findingsByRun = new Map<string, FindingRecord[]>();
   for (const r of runs) {
     if (r.run_id) findingsByRun.set(r.run_id, r.findings.filter((f) => !f.dismissed_at));
   }
   ```
   `FindingsTab` already receives `repoFullName` and `headSha` props — thread both to `RunHistory`.
2. In `RunHistory.tsx`
   (`.../[number]/_components/RunHistory/RunHistory.tsx`), add props
   `findingsByRun: Map<string, FindingRecord[]>`, `repoFullName?`, `headSha?`. For each **settled**
   run row (`r.status === "done"`), look up `findingsByRun.get(r.run_id) ?? []`, derive
   `counts = { CRITICAL, WARNING, SUGGESTION }` by tallying `severity`, and render
   `<FindingsIndicator variant="run" counts findings repoFullName headSha />` **in place of / beside**
   the current plain findings/blockers text line (`RunHistory.tsx:192-197`). Runs with no matching
   review (e.g. failed) get no indicator.
3. Update `RunHistory`'s existing test to assert the indicator renders with the right per-severity
   counts for a run.

---

## 5. Pull Requests list (server + client)

### 5a. Server — add per-PR counts to the list response

**Contract** — extend `PrMeta` in **both** mirrored files (keep identical):
`server/src/vendor/shared/contracts/platform.ts` and
`client/src/vendor/shared/contracts/platform.ts` (`PrMeta` is at `platform.ts:157`):
```ts
findings_by_severity: z
  .object({ critical: z.number().int(), warning: z.number().int(), suggestion: z.number().int() })
  .nullish(),   // nullish for back-compat; default to all-zero when serving
```

**Handler** — `GET /repos/:id/pulls` in `server/src/modules/pulls/routes.ts` (add near the existing
score IN-query at `routes.ts:118-130`; it already builds `prIds` and returns rows at 149-174).
Add `isNull` to the drizzle import at `routes.ts:3` (`import { and, desc, eq, inArray, isNull, sum } from 'drizzle-orm'`).
Tables imported as `import * as t from '../../db/schema.js'`. Confirmed columns
(`server/src/db/schema/reviews.ts`): `t.reviews` = `{ id, prId, runId, kind, score }`;
`t.findings` = `{ id, reviewId, severity, dismissedAt, startLine, endLine, file }`.
```ts
// Per-PR FINDINGS breakdown: all runs, non-dismissed, de-duplicated across runs.
// Select the fields that form the dedup key; collapse duplicates per PR before tallying.
const findingsByPr = new Map<string, SeverityCounts>();
if (prIds.length > 0) {
  const rows = await container.db
    .select({
      prId: t.reviews.prId,
      severity: t.findings.severity,
      file: t.findings.file,
      startLine: t.findings.startLine,
      endLine: t.findings.endLine,
      title: t.findings.title,
    })
    .from(t.findings)
    .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
    .where(and(
      inArray(t.reviews.prId, prIds),
      eq(t.reviews.kind, 'review'),
      isNull(t.findings.dismissedAt),
    ));
  // Per PR, keep one row per dedup key (severity|file|start|end|title-lower), then rollup.
  const seen = new Map<string, Set<string>>();          // prId -> set of finding keys
  const deduped = new Map<string, { severity: string }[]>();
  for (const r of rows) {
    const key = `${r.severity}|${r.file}|${r.startLine}|${r.endLine}|${r.title.trim().toLowerCase()}`;
    const set = seen.get(r.prId) ?? seen.set(r.prId, new Set()).get(r.prId)!;
    if (set.has(key)) continue;
    set.add(key);
    (deduped.get(r.prId) ?? deduped.set(r.prId, []).get(r.prId)!).push({ severity: r.severity });
  }
  for (const [prId, list] of deduped) findingsByPr.set(prId, rollupSeverities(list));
}
```
Import `rollupSeverities` + `SeverityCounts` from `./status.js`. In the final `rows.map(...)`
(routes.ts:149), add:
```ts
findings_by_severity: findingsByPr.get(r.id) ?? { critical: 0, warning: 0, suggestion: 0 },
```

**Server test** — DB-backed integration test. ⚠️ **Location:** integration tests live in
**`server/test/*.it.test.ts`**, NOT colocated in `modules/` (despite the module-first layout). Create
`server/test/pulls-findings.it.test.ts` following the existing `test/reviews.it.test.ts` /
`test/pulls-comments.it.test.ts` pattern. The `.it.test.ts` suffix is mandatory (routes it to the
Docker lane; self-skips without Docker per `server/CLAUDE.md`).

Harness (copy from `test/pulls-comments.it.test.ts`):
- `import { startPg, dockerAvailable } from './helpers/pg.js'` → `const d = (await dockerAvailable()) ? describe : describe.skip`.
- `beforeAll`: `pg = await startPg(); await seed(pg.handle.db);` then read the seeded workspace id.
- Build the app **without** a GitHub override: `buildApp({ config: config(), db: pg.handle.db })`. No
  token in test config → the list route's `container.github()` throws → it serves the persisted rows
  you inserted (never fails the read). No need to mock GitHub.
- Insert `t.repos` → `t.pullRequests` → `t.reviews` (`kind:'review'`) → `t.findings`, then
  `app.inject({ method:'GET', url: \`/repos/${repo.id}/pulls\` })` and assert `findings_by_severity`
  on the matching row.

⚠️ **`reviews.run_id` / `runId` is a `uuid` column** — you **cannot** seed arbitrary strings like
`'run-1'` (Postgres `invalid input syntax for type uuid`). The dedup key is finding-content, not
`run_id`, so just **omit `runId`** (nullable) and model "distinct runs" as two separate `reviews` rows.

Assert: seed a PR with findings across **2 reviews** where **one identical finding appears in both**
(same severity/file/lines/title) and **one finding is dismissed** (`dismissedAt: new Date()`); expect
`findings_by_severity` to (a) count the duplicate **once** and (b) **exclude** the dismissed one.
Also assert a PR with no findings serves `{ critical:0, warning:0, suggestion:0 }`.

### 5b. Client — new FINDINGS column

1. `client/src/app/repos/[repoId]/pulls/constants.ts`:
   - `COLUMN_KEYS` (line 42): insert `"findings"` **after `"score"`** → `[pullRequest, author, size,
     score, findings, status, cost, updated]`.
   - `GRID` (line 27): add a track for findings after the score track. Current
     `"1fr 132px 92px 60px 118px 88px 78px"` → `"1fr 132px 92px 60px 120px 118px 88px 78px"`.
     `styles.ts` derives both header + row grids from `GRID` automatically.
2. `client/messages/en/prReview.json` → `list.columns.findings` label (e.g. "Findings").
3. `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx` — add the findings cell between
   the score cell and the status cell. Counts come from `pr.findings_by_severity` (map lowercase →
   the component's `{ CRITICAL, WARNING, SUGGESTION }`). The popup findings list is **lazy**:
   ```ts
   const [hovered, setHovered] = React.useState(false);
   const { data: reviews, isLoading } = usePrReviews(hovered ? (pr.id ?? null) : null);
   // Same rule as the server counts: non-dismissed, de-duplicated across runs by findingKey.
   const seen = new Set<string>();
   const findings = (reviews ?? [])
     .flatMap((r) => r.findings)
     .filter((f) => !f.dismissed_at)
     .filter((f) => {
       const k = `${f.severity}|${f.file}|${f.start_line}|${f.end_line}|${f.title.trim().toLowerCase()}`;
       return seen.has(k) ? false : (seen.add(k), true);
     });
   ```
   Render `<FindingsIndicator variant="pr" counts={...} findings={findings} loading={isLoading}
   repoFullName={repoFullName} headSha={pr.head_sha} />`. Set `hovered` on the cell's mouse-enter.
   Export a shared `findingKey(f)` helper (e.g. in the `findings-indicator` folder) and reuse it here
   so the client dedup exactly mirrors the server's.
   - `pr.id` (uuid) and `pr.head_sha` are on `PrMeta`. `repoFullName` is available on the list page
     via `useActiveRepo().activeRepo?.full_name`
     (`client/src/app/repos/[repoId]/pulls/page.tsx:33`); thread it into `PRRow` as a new prop from
     `page.tsx:130` (`filtered.map((pr) => <PRRow ... repoFullName={activeRepo?.full_name} />)`).
   - Guard: `PRRow`'s row `onClick` navigates to the PR — stop propagation on the indicator/popup so
     clicking an icon does not also navigate.
   - Server counts and the lazy popup use the **same** rule (all runs, non-dismissed, deduped by
     `findingKey`) → they agree.
4. Update `PRRow`'s test to assert the findings cell renders the expected badges from
   `findings_by_severity`.
   - ⚠️ **`PRRow` now calls `usePrReviews` (a TanStack Query hook)** — a bare render throws
     "No QueryClient set". Per client INSIGHTS, **mock the hook boundary**, not global fetch:
     `vi.mock("@/lib/hooks/reviews", () => ({ usePrReviews: () => ({ data: [], isLoading: false }) }))`.
     No `QueryClientProvider` needed then. Add `findings_by_severity` to the test's `pr()` factory
     default (all-zero) so existing cost/score cases keep working; add cases for present severities
     (strip buttons render) and all-zero / missing (`undefined`) → muted "—", no buttons.

---

## 6. Files to change / add (checklist)

**Add**
- `client/src/components/findings-indicator/FindingsIndicator.tsx`
- `client/src/components/findings-indicator/styles.ts`
- `client/src/components/findings-indicator/index.ts`
- `client/src/components/findings-indicator/FindingsIndicator.test.tsx`

**Edit — client**
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx` (+ test)
- `client/src/app/repos/[repoId]/pulls/page.tsx` (pass `repoFullName` to `PRRow`)
- `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx` (+ test)
- `client/src/app/repos/[repoId]/pulls/constants.ts` (`GRID`, `COLUMN_KEYS`)
- `client/messages/en/prReview.json` (`list.columns.findings` + `findings.indicator.*` strings)
- `client/src/vendor/shared/contracts/platform.ts` (`PrMeta.findings_by_severity`)

**Edit — server**
- `server/src/vendor/shared/contracts/platform.ts` (mirror `PrMeta` change — must match client copy)
- `server/src/modules/pulls/routes.ts` (add `isNull` import, findings IN-query, populate field)

**Add — server**
- `server/test/pulls-findings.it.test.ts` (DB-backed; NOT colocated in `modules/` — see §5a)

---

## 7. Verification

1. **Types/build:** `pnpm typecheck` in `client/` and in `server/`.
2. **Server tests:** in `server/`, `pnpm test` — the new `routes.it.test.ts` proves
   `findings_by_severity` sums non-dismissed findings across all runs and excludes dismissed ones.
   (Needs Docker/Postgres; self-skips otherwise.)
3. **Client tests:** in `client/`, `pnpm test` (vitest + jsdom, `fetch` mocked) — `FindingsIndicator`,
   `PRRow`, `RunHistory` tests as described above.
4. **Manual (real app):** only Postgres runs in Docker; API + web run on host.
   ```bash
   docker compose up -d db        # NEVER use `-v` (deletes the pgdata volume)
   ```
   Then in `server/`: `pnpm db:migrate` (migrations are NOT applied on boot) → `pnpm db:seed` →
   `pnpm dev` (:3001). In `client/`: `pnpm dev` (:3000).
   - On `/repos/:id/pulls`: FINDINGS column shows only present severities with counts; hovering lists
     all findings; clicking an icon filters to that level; finding rows link to GitHub at the right
     lines; clicking an icon does not navigate to the PR.
   - On a PR's **Agent runs** tab: each settled run row shows its own per-severity indicators + popup.
   - **Popup floats above the table (never clipped), only one is open at a time, and it closes on
     mouse-leave / click-outside / `Esc`.** If you still see clipping or stacking after editing, it's
     almost always **stale HMR** — React Fast Refresh doesn't reliably apply edits that add hooks
     (the portal work adds `useLayoutEffect`/refs). Do a full page reload (Ctrl+Shift+R) or restart
     `pnpm dev`. (These two symptoms together = the pre-portal absolute build is still being served.)
   - Optional: drive the browser via the in-app Browser MCP tools against `http://localhost:3000`.
     Note: the in-app Browser pane may not composite frames (screenshots time out); use `read_page`
     to inspect the DOM (e.g. confirm the `role="dialog"` panel is a child of `<body>`, not the row).

---

## 8. Notes / decisions

- **Rollup rule = all runs, non-dismissed, de-duplicated** (user-confirmed). Dedup key:
  `` `${severity}|${file}|${start_line}|${end_line}|${title.trim().toLowerCase()}` ``. This collapses
  the same finding re-emitted across multiple runs (e.g. an agent re-run) into one. Tradeoff: two
  genuinely different findings that share severity+file+lines+title would also merge (rare), and a
  re-run that **rewords** the title won't dedup (title is part of the key). Keep the key identical on
  server and client (`findingKey` helper) so counts and popup always match. Applies to the **PR-list
  summary only** — the per-run timeline indicator shows each run's findings verbatim.
- Popup findings are intentionally **not** shipped in the list response (would send findings arrays
  for every row); they lazy-load per PR on first hover via `usePrReviews`.
- `PrRowView` (`client/src/lib/types.ts:37`) is a pre-existing unused stub anticipating this; leave
  as-is. Contract field uses lowercase `SeverityCounts` keys (`critical/warning/suggestion`);
  the component API uses uppercase severities — map at the `PRRow` boundary.
- Keep the two vendored `platform.ts` copies byte-identical for the `PrMeta` change.
- **Popup = portal + fixed + single-instance + mouse-leave close** (§3a). This is the load-bearing
  UI decision — an absolute panel is clipped by the table card and hover-open without a close stacks
  popups. Both were real bugs in the first pass; §3a is written to prevent a repeat.
- The Web Interface Guidelines (Vercel) have **no** rules for popover clipping / portals / floating-
  element collision — don't expect the `web-design-guidelines` skill to catch this; it's a
  containing-block/`overflow` fact, handled by the portal.

## 9. Session wrap-up

Per `CLAUDE.md`, at the end append any substantial, non-obvious insight to the touched module's
`INSIGHTS.md` via the `engineering-insights` skill. The insights from this feature are **already
logged** in `client/INSIGHTS.md` (2026-08-10): (1) no popover primitive → portal anchored popups with
`position:fixed` (an absolute panel is clipped by `overflow:hidden` ancestors like the table card);
click-outside must check both the strip ref and the portalled panel ref. (2) server↔client finding
dedup must share one `findingKey`. If you re-derive anything new, add it; otherwise don't duplicate.
