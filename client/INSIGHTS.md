# Insights — client

UI decisions and dead ends. Read before restructuring pages, state, or the data
layer.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it out.

Formats — `Decisions` takes prose; every other section takes a dated bullet:

```markdown
### YYYY-MM-DD — <short title>

**What:** the decision, in one sentence.
**Why:** the constraint that forced it.
**Rejected:** what we tried or considered, and how it failed.
```

```markdown
- **YYYY-MM-DD** — <the claim, specific enough to act on cold>.
  `src/path/to/file.tsx:42`
```

Roughly 5 entries per section. Promote stable entries into `docs/` and delete
them here.

---

## Decisions

_None yet. Add the first one the next time a UI approach is tried and
abandoned — that is exactly what this file is for._

## What Works

_None yet._

## What Doesn't Work

- **2026-08-07** — An absolutely-positioned popover inside a PR **list row** is
  clipped dead: `s.tableCard` sets `overflow: hidden` for its rounded corners,
  so the card mounts but is invisible below and to the right of the row. It
  works on the PR *detail* page only because nothing there clips. Flipping
  `tableCard` to `overflow: visible` is **not** the fix — it also un-clips the
  last row's `borderBottom` and hover background from the `borderRadius: 10`
  corners, giving a visible squared-corner artifact. What works: render the card
  into a **zero-sized `position: fixed` wrapper**. Not a portal — `createPortal`
  appears nowhere in this codebase, and a portal breaks the `mouseleave`
  DOM-containment the hover logic depends on. Zero-sized is the trick that keeps
  the card byte-identical across both call sites: its own
  `top: calc(100% + 8px)` resolves the percentage against a 0px height and lands
  at the same 8px gap. Pair it with a `useLayoutEffect` that measures the
  rendered card and flips it above the trigger when
  `triggerBottom + 8 + height` overflows the viewport — without that, the
  **last row** of a full table opens a 420px card straight off the fold.
  jsdom has no layout, so no unit test can see either failure; both were caught
  only by driving a real browser.
  `client/src/app/repos/[repoId]/pulls/_components/FindingsCell/FindingsCell.tsx`,
  `client/src/app/repos/[repoId]/pulls/styles.ts:89`

## Codebase Patterns

- **2026-08-04** — Before adding a new hook/endpoint to show "more detail on
  X" in a component, check whether the detail is already fetched elsewhere on
  the same page and can be threaded down as a prop instead. `RunHistory` only
  ever received `RunSummary[]` (denormalized `critical_count`/`warning_count`/
  `suggestion_count`, no finding detail), but `FindingsTab` — its direct
  parent — already holds the full `ReviewRecord[]` (each with a `findings:
  FindingRecord[]` and `run_id`) via `usePrReviews`. Adding a hover preview of
  a run's findings needed only `new Map(runs.map(r => [r.run_id,
  r.findings]))` in `FindingsTab` passed down as `findingsByRun`, zero new
  API/hook. `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx:75`

## Tool & Library Notes

- **2026-08-04, corrected 2026-08-07** — The seeded dev DB has zero `agent_runs`
  rows with `findings_count > 0`, but that is a statement about the *run
  counters* only — the `findings` **table is not empty**. `server/src/db/seed.ts`
  inserts findings on `acme/payments-api` PR #482. The actual obstacle for any
  UI scoped to a PR's **latest** review is that #482 carries ~6 *later* clean
  score-100 reviews that shadow the one holding the findings, so the list
  renders "—" and the feature looks broken when it is correct. Verify by
  `INSERT`ing a review dated `now()` plus its findings (or attaching findings to
  the newest `reviews.id`), screenshotting, then deleting — reversible on the
  local dev DB (`postgres://devdigest:devdigest@localhost:5432/devdigest`).
  Note `seed.ts` guards the findings block behind `if (!pr)`, so re-running
  `pnpm db:seed` on an existing DB will **not** add newly-seeded findings.

- **2026-08-07** — For one-off visual verification: the `claude-in-chrome` MCP
  extension may be unreachable ("Claude in Chrome is not connected"), and no
  `chromium-cli`/`agent-browser` CLI exists in this sandbox. The reliable
  fallback is a scratch `npm install playwright` + a small driver script;
  headless Chromium is already downloaded at `~/.cache/ms-playwright/`
  (otherwise `npx playwright install chromium`, without `--with-deps`, which
  needs sudo). Assert geometry rather than eyeballing a screenshot —
  `locator.boundingBox()` against `page.viewportSize()` is what proves a popover
  is on-screen and unclipped.

## Recurring Errors & Fixes

- **2026-08-04** — `fireEvent.mouseEnter` on a component whose hover-open
  logic uses `setTimeout` (e.g. an open delay to survive a mouse
  pass-through) needs `vi.useFakeTimers()` **and** the timer advance wrapped
  in `act()` from `@testing-library/react`:
  `act(() => { vi.advanceTimersByTime(150); })`. Without the `act()` wrapper,
  the state update from the timer callback doesn't flush before the
  assertion runs — `aria-expanded` stays `"false"` and the popover content is
  never found, even though the component logic is correct.
  `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.test.tsx`

- **2026-08-01** — A vitest failure whose two sides look identical —
  `expected '9 119 tok' to be '9 119 tok'` — is a look-alike Unicode space, not
  an environment difference. `formatTokenCount` had a literal THIN SPACE
  (U+2009) typed into `.replace(/,/g, " ")`, invisible in the diff and in the
  test output. Dump code points first —
  `[...s].map((c) => c.charCodeAt(0).toString(16))` — before theorising about
  ICU or jsdom locale data, which is where this was initially misdiagnosed.
  Group digits with `.replace(/\B(?=(\d{3})+(?!\d))/g, " ")` rather than
  `toLocaleString` plus a separator swap, so the separator is a plain U+0020 a
  test can type. Find strays with `rg '\x{2009}' src/`.
  `client/src/lib/format.ts:40`

## Open Questions

_None yet._
