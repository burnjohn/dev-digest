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

### 2026-08-14 — `/skills` selection + tab live in query params, not a `[id]` route

**What:** the skill detail panel is `/skills?skill=<id>&tab=<tab>`, both parsed
from `useSearchParams()` in `SkillsListView`, not `/skills/[id]` the way
`/agents/[id]` is a dynamic route with its OWN `?tab=`.
**Why:** the mockup keeps the list and the detail panel on one screen at all
times (no drill-down), and the breadcrumb never grows a third "skill name"
crumb the way the agent editor's does — so there is no page-identity reason for
a second route. Encoding both the selection and the tab as query params on the
existing route gets "survives reload and back" for free from the URL, without a
new `[id]/page.tsx`, a loading skeleton for it, or a not-found route.
**Rejected:** an `/skills/[id]` route mirroring `/agents/[id]`. It is the more
"consistent" shape on paper, but it would have added a whole second page (with
its own loading/error states) to buy nothing the query-param version doesn't
already give, and it would have grown the breadcrumb in a way the design does
not show.
`client/src/app/skills/_components/SkillsListView/SkillsListView.tsx`

## What Works

- **2026-08-14** — When a clickable container (`PRRow`, `AgentCard`,
  `FindingCard`/`PromptBlock` headers) gains `role="button"` + `onKeyDown`, add
  `if (e.target !== e.currentTarget) return;` as the handler's first line.
  `keydown` bubbles, so without it Enter on any focusable descendant fires the
  container's action *as well as* its own — Enter on `AgentCard`'s delete button
  would both delete and navigate. The existing `onClick={(e) =>
  e.stopPropagation()}` wrappers only cover clicks; nobody had to think about
  keyboard because there was no keyboard path at all. One guard on the container
  beats adding `stopPropagation` to every child, and it degrades correctly as
  children are added. Which containers can be a plain `<button>` instead is
  decided by their children, not by how button-like they feel: `TraceSection`
  and `ToolCallRow` hold only spans and icons, so they are real buttons;
  `FindingCard` cannot be, because `MonoLink` renders an `<a>` when it has an
  `href` (`src/vendor/ui/primitives/MonoLink.tsx:26`) and interactive content
  inside a `<button>` is invalid HTML.
  `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx:33`

## What Doesn't Work

- **2026-08-07** — `@/lib/hooks` cannot be imported from a Server Component.
  `src/lib/hooks/index.ts` is a wildcard barrel (`export * from "./core"` ×5)
  over TanStack Query hooks, and Next.js's cross-boundary tree-shaking
  explicitly does not work through barrel files — a barrel that `export *`s
  client hooks into a server import path can fail the build outright
  (`nextjs.org/blog/next-14-2`, `vercel/next.js` discussion #65979). It has not
  bitten yet only because all 5 consumers already carry `"use client"`; that is
  a property of today's call sites, not of the module. The failure will point at
  the barrel, not at the import that caused it. Before adding the first server
  consumer, replace the wildcards with named re-exports — the file's own comment
  already promises a curated surface ("the platform hooks") that `export *` does
  not deliver. Check with:
  `for f in $(grep -rl 'from "@/lib/hooks' src --include=*.tsx --include=*.ts); do grep -q '"use client"' "$f" || echo "SERVER: $f"; done`
  `client/src/lib/hooks/index.ts:4`

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

- **2026-08-19** — when a new feature needs one more capability from an
  existing shared render component (`FileCard`/`CodeLine` in
  `client/src/components/diff-viewer`), extend it with OPTIONAL props that
  default to the prior behaviour rather than forking a second copy.
  `SmartDiffViewer`'s "click a finding → auto-expand + scroll + highlight that
  line" needed `FileCard` to accept a controlled `open`/`onOpenChange` (falls
  back to the original size-based auto-expand `useState` when omitted) and
  `highlightLine`/`onHighlightMount` (only affects rendering when a line
  number is passed). Every existing caller (`DiffViewer`) passes neither prop
  and is byte-for-byte unaffected — confirmed by the untouched existing
  behaviour still passing after the change, not just by reading the diff.
  `client/src/components/diff-viewer/FileCard/FileCard.tsx`,
  `client/src/components/diff-viewer/CodeLine/CodeLine.tsx`

- **2026-08-14** — `client/src/vendor/ui/` is documented as "do not touch"
  (root `AGENTS.md`), but a NEW feature's sidebar entry has to land in
  `vendor/ui/nav.ts` anyway — `Sidebar.tsx` imports the `NAV` constant
  directly with no prop-based extension point, so there is no non-vendor place
  to add a nav item. Confirmed by precedent, not by guessing: `git log -p --
  client/src/vendor/ui/nav.ts` shows `LAB_L02` added the "SKILLS LAB" section
  (`skills`/`agents` entries) the same way. `activeKeyFor` in
  `components/app-shell/helpers.ts` (NOT vendored) already anticipates routes
  the starter hasn't built yet — it maps `/conventions` to a `"conventions"`
  key before any Conventions nav entry or page existed, which is a signal a
  new feature's route was expected to land there, not an oversight to route
  around. `client/src/vendor/ui/nav.ts`,
  `client/src/components/app-shell/helpers.ts:31`

- **2026-08-14** — `jsx-a11y/no-static-element-interactions` (now `error`, see
  `client/eslint.config.mjs`) fires on the plugin's default handler set, which
  covers **mouse and focus, not just `onClick`** — so a wrapper carrying only
  `onMouseEnter`/`onMouseLeave` trips it with no click target in sight. That is
  the case on `diff-viewer/CodeLine`, where `role="button"` + `tabIndex={0}`
  would be actively wrong: it adds one tab stop per line of every diff. Use
  `role="presentation"` there.
  `FindingsHoverCard` is the constrained one — it must keep `role="tooltip"`
  **and** remain the fixed wrapper's first child, because `FindingsCell.test.tsx`
  locates it by role and `FindingsCell`'s `useLayoutEffect` measures
  `wrap.firstElementChild` for the flip-above logic (see the 2026-08-07 entry
  above). A stop-propagation handler there therefore has to go on a new inner
  `role="presentation"` node rather than on the card itself.
  Known remaining gap, not a lint problem: `CodeLine`'s "+" comment affordance
  is mouse-only — it is not rendered until hover, so it can never be tabbed to.
  Closing it needs a visible change (reveal on focus).
  `client/src/components/diff-viewer/CodeLine/CodeLine.tsx:39`

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

- **2026-08-14** — A wrapper `<div onClick={(e) => e.stopPropagation()}>` whose
  only job is to keep a click off the parent trips both
  `jsx-a11y/no-static-element-interactions` and
  `click-events-have-key-events`, and it has no honest role or key handler to
  give it. `role="none"` clears both: each rule bails out early on
  `isPresentationRole()`, and the claim is true — the wrapper contributes
  nothing to the a11y tree, the control inside it does. No `eslint-disable`
  needed. Do not reach for `onClickCapture` to dodge the handler list instead:
  it is not in the plugin's `interactiveHandlers`, but `stopPropagation` in the
  capture phase stops the child from ever receiving the click.
  `client/src/app/agents/_components/AgentCard/AgentCard.tsx:52`

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

- **2026-08-14** — `getByDisplayValue(multilineString)` silently fails to find
  a `<textarea>` whose value contains `\n\n`, even when the DOM clearly shows
  the right text (visible in `screen.debug()`). RTL's default normalizer
  collapses whitespace — including embedded newlines — before comparing, so a
  search string with a literal blank line never matches the (collapsed)
  rendered value. This bit `ConfigTab.test.tsx`'s skill-body field (a bare
  `<textarea>` in `SkillBodyEditor`, not the vendored single-line `Textarea`).
  Fix: don't query multi-line fields by display value at all — select the
  element directly, e.g. `container.querySelector('textarea[wrap="off"]')`,
  then assert/mutate on `.value` yourself. Single-line fields (name,
  description) are unaffected and keep using `getByDisplayValue` as normal.
  `client/src/app/skills/_components/SkillDetail/_components/ConfigTab/ConfigTab.test.tsx`

- **2026-08-14** — Giving a row/card container `role="button"` breaks its
  colocated test with `Found multiple elements with the role "button"` whenever
  that test used a bare `screen.getByRole("button")` to reach a control *inside*
  the row. Match by accessible name instead —
  `getByRole("button", { name: "1 findings" })`. Do not switch to
  `getAllByRole(...)[1]`: `role="button"` is name-from-content, so the
  container's own name is the concatenation of every string it renders, which
  means a `{ name: /findings/ }` regex matches the container too. Only an exact
  name is unambiguous.
  `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.test.tsx:78`

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
