# Insights — client

Running log of non-obvious findings, decisions, and gotchas for `@devdigest/web`.
Append newest at the top. Keep entries short: what surprised you, why it is that
way, and what to do about it. [AGENTS.md](AGENTS.md) stays lean by pointing here.

<!-- Format: ### YYYY-MM-DD — short title, then 1–3 lines. -->

### 2026-08-22 — Capture a scroll position in the RENDER phase; `scroll` events are async and always lose the race
`_lib/use-tab-scroll-memory.ts` shipped three separate fixes for "the Files-changed offset is lost on
tab switch" while a `scroll` listener still owned the capture — all three failed in Chrome with a
green jsdom lane, because the browser's `scrollTop` clamp (fired when the shorter tab's content
mounts) reports **asynchronously**, after any suppression window a hook can hold open. The durable
answer is to read `container.scrollTop` synchronously in the component body on the render where the
tab changes: React renders before it commits, so the DOM still holds the outgoing content and the
value is the true pre-clamp one. Supersedes the rAF-guard entry below for this file — there is no
rAF and no listener left in it.

### 2026-08-22 — an rAF throttle guard keyed on the `requestAnimationFrame` RETURN VALUE deadlocks under a sync stub
`if (rafId != null) return; rafId = requestAnimationFrame(cb)` is correct in a browser, where rAF is
always async — but a test double that invokes `cb` synchronously (the natural way to make an
rAF-throttled hook deterministic under Vitest without fake-timer ceremony) runs `cb`'s own
`rafId = null` reset BEFORE the outer assignment lands, so the outer assignment writes a non-null id
back over it and every subsequent call is blocked forever. Key the guard on an independent `pending`
boolean; keep `rafId` only for `cancelAnimationFrame`.
(`_lib/use-tab-scroll-memory.ts`)

### 2026-08-18 — A hidden Browser pane freezes EVERY React Query query, and it looks like a dead API
When the in-app Browser pane is not displayed, `document.visibilityState` is `"hidden"` and no
query ever resolves: every page renders permanent `Skeleton`s and issues zero requests to :3001,
while a manual `fetch()` from the same page returns 200. It is uniform across pages (agents,
skills, repos), so treat "all skeletons + empty `read_network_requests`" as this, not a data-layer
bug — check `document.visibilityState` first. Redefining it from the page does NOT revive
already-mounted observers; verify UI through the RTL lane instead.

### 2026-08-18 — Never run `pnpm build` in `client/` while `pnpm dev` is running
The production build overwrites `.next/`, and the running dev server keeps requiring chunk paths
the build deleted — every route then 500s with `Cannot find module './vendor-chunks/<pkg>.js'`
and a reload cannot fix it. Recovery is: stop the dev server, `rm -rf .next`, restart. Run the
build only against a stopped dev server.

### 2026-08-17 — A `dragover` handler that returns before `preventDefault()` eats the drop silently
`SkillsTab` guarded `onDragOver` with `if (!dragRef.current || !isLinked) return`, so unchecked
rows never called `preventDefault()` and the browser refused every drop onto them — the row just
snapped back, no error. In a list where valid targets are interleaved with invalid ones, most
drags land on a dead row. Always `preventDefault()` on every potential target, then decide what
the drop *means* in `onDrop`. jsdom cannot catch this: `fireEvent.dragOver` has no default action
to prevent, so the tests passed the whole time.

### 2026-08-17 — HTML5 drag sources: `setData` is mandatory, and a `<button>` handle is not a source
Firefox aborts a drag whose `dragstart` wrote nothing, so always
`e.dataTransfer.setData("text/plain", id)` (guard the block — jsdom's `fireEvent` supplies no
`dataTransfer`). And a mousedown on a form control does not start an *ancestor's* drag: a grip
`<button>` inside a `draggable` row needs its own `draggable` + `dragstart`, plus
`setDragImage(row)` so the ghost stays the row rather than the icon.

### 2026-08-17 — `%5BrepoId%5D` is correct; GitHub's `html_url` disagrees with its own UI
For bracketed App Router paths, github.com's file-tree anchors link to
`…/repos/%5BrepoId%5D/pulls/%5Bnumber%5D` — what `encodeURIComponent` emits — while
`GET /repos/:o/:r/contents/:path`'s `html_url` reports bare brackets. Trust the UI form;
`encPath` in `lib/github-urls.ts` stays plain `encodeURIComponent`.
(Supersedes an earlier entry today that read `html_url` as authoritative and "fixed" `encPath`.)

### 2026-08-17 — You cannot test a github.com `/blob/` URL from this sandbox
Every `/blob/` request returns 404 or 503 here — including hrefs GitHub itself rendered, and
plain `README.md` — while `/tree/` URLs and the repo root load normally. A 404 on a blob URL
from Claude's browser, curl, or WebFetch is an environment artifact and proves nothing about
the URL; verify link *shape* against `/tree/` pages or the API instead.

### 2026-08-17 — `MonoLink` doesn't fit a file link that has to truncate
`vendor/ui/primitives/MonoLink` takes no `style` prop, so it can't carry the
`flex:1 / minWidth:0 / textOverflow:ellipsis` a constrained row needs, and its no-`href` branch
renders a dead `<button>` with no `onClick`. `FindingCard` gets away with it; `ConventionCard`
hand-rolls the `<a>` plus a local hover `useState` (inline styles can't express `:hover`) instead.

### 2026-08-17 — Conventions store no commit SHA, so their GitHub links pin to the default branch
`convention_scans` holds counts/model/cost only and `repos` has no head-sha column, so
`ConventionCard`'s blob link uses `activeRepo.default_branch` — the `#L` anchor drifts once main
moves past the scan. For an exact permalink, stamp `git.currentHead()` onto `convention_scans` in
`conventions/service.ts` (mirrors `repo_map_cache.commit_sha`) or reuse `repo_index_state.last_indexed_sha`.
Note `ConventionsView`'s `fullName` const falls back to `repoId` (a uuid) for the heading — never
build a URL from it; read `activeRepo?.full_name` directly.

### 2026-08-17 — `AppFrame`'s `<main>` has NO padding — every page supplies its own container
`vendor/ui/shell/AppFrame` renders `<main style={{ flex:1, minHeight:0, overflow:"auto" }}>`, so a
page that returns straight into `AppShell` sits flush against the sidebar and stretches edge to
edge — `ConventionsView` did exactly that and was the only list page that looked different. Copy
`page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" }` from `AgentsListView/styles.ts`
(Skills is identical). `components/page-shell`'s `PageContainer` exists but forces a
title/subtitle/actions shape and is used only by `FeaturePlaceholder`.

### 2026-08-17 — Fixed-order category sections silently outrank the sort you asked for
Grouping a ranked list into fixed-order sections means the ordering only holds *within* a section:
a 30%-confidence `naming` rule rendered above a 90% `typing` one. If the server already orders by
score (`desc(confidence), asc(createdAt)`), render one flat list and demote the grouping key to a
chip on the card.

### 2026-08-17 — `FormField required` folds the `*` into the label's accessible name
`FormField` renders `{label}<span>*</span>` inside one `<label>`, so a required field's
accessible name is `Name*` and `getByLabelText("Name")` throws "Unable to find a label".
Match a prefix (`/^Name/`) in tests, or the query breaks the moment a field becomes required.

### 2026-08-16 — Row order that outlives a checkbox must be client-held, not re-derived
`agent_skills` stores an order for LINKED skills only, so re-deriving "linked first, rest
alphabetical" (`orderForDisplay`) on every toggle made an unchecked row jump out of place.
`SkillsTab` now freezes the row order in state at the first edit and derives prompt order as
`displayOrder.filter(checked)`; `reorderLinked` permutes only the linked slots so unchecked
rows stay anchored at their index.

### 2026-08-16 — HTML5 drag reorder: keep the dragged id in a ref, not just state
In `SkillsTab`, `onDragOver`/`onDrop` read the dragged id set by `onDragStart`; from
`useState` alone they can see the pre-`dragstart` `null` (React batches, and `dragover` is a
continuous-priority event) and the drop silently no-ops. Mirror it into a `useRef` and read
that in the handlers — keep the state copy only for drag/drop-target styling.

### 2026-08-16 — `vendor/ui` interactive primitives have NO accessible name by default
`Toggle` and `Checkbox` render a `<button role="switch|checkbox">`, and a wrapping `<label>`
does not name them — implicit label association only works for *labelable* elements, which a
button is not. They now take an optional `ariaLabel`; pass it, or the control announces unnamed.
`FormField` likewise only labels its control when given `htmlFor` (+ a matching `id`).

### 2026-08-16 — A clickable card must not be a `<button>` if it contains one
Making a list card a `<button>` (or `<Link>`) and putting a `Toggle`/`IconBtn` inside it nests
interactive elements — invalid HTML the parser breaks apart, and the inner control drops out of
the tab order. Shape it as a plain container `<div>` + a `<Link>` over the navigable region +
the control as a SIBLING (see `app/skills/_components/SkillCard`).

### 2026-08-10 — React inline styles: `borderColor` is a shorthand, conflicts with `borderLeftColor`
In our inline-style-object convention, setting `borderColor` alongside `borderLeftColor` (e.g.
`FindingCard/styles.ts` focus ring) triggers React's "Updating a style property during rerender…
when a conflicting property is set" warning on re-render — `borderColor` expands to all four sides.
Use the three non-left side longhands (`borderTopColor`/`borderRightColor`/`borderBottomColor`)
when a distinct `borderLeftColor` accent is present. Dropping the `border` shorthand alone isn't enough.

### 2026-08-10 — Findings popups must portal + `position:fixed`, not absolute
The PR-list table card (`pulls/styles.ts` `tableCard`) sets `overflow:hidden`, so an in-flow
`position:absolute` popup is clipped. `FindingsIndicator` (`components/findings-indicator/`)
renders its panel via `createPortal(…, document.body)` with `position:fixed` measured from the
strip rect. Click-outside must test BOTH the strip ref and the portalled panel ref — the panel
is not a DOM descendant of the strip.

### 2026-08-10 — Hover popups need a single-instance registry + mouse-leave close
Hover-open with only click-outside/Esc stacks one popup per hovered row. `FindingsIndicator`
uses a module-level `Set<() => void>` registry (opening one closes the others) plus a ~140ms
grace-delay close on mouse-leave of strip OR panel, cancelled on either's mouse-enter. There is
no popover/tooltip primitive and no Floating UI in this repo — it's all hand-rolled.

### 2026-08-10 — PR-list finding counts share ONE dedup key with the server
`findingKey` (`components/findings-indicator/index.ts`) =
`severity|file|start_line|end_line|title.trim().toLowerCase()` and must stay identical to the
server's key in `server/src/modules/pulls/routes.ts`. The list badge counts are deduped
server-side; the lazily-loaded popup re-dedups client-side with the same key so the two agree.

### 2026-08-09 — seed
- **All server data flows through `lib/hooks/*` → `lib/api.ts`.** If you're writing
  a `fetch` inside a component, stop — add/extend a hook instead.
- **Pages are thin**; the real logic lives in colocated `_components/<Name>/`.
- **Tests never hit the network** — `fetch` is mocked under jsdom, so mock the hook
  boundary, not global `fetch`, when a test needs data.
