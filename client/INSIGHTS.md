# Insights — client

Running log of non-obvious findings, decisions, and gotchas for `@devdigest/web`.
Append newest at the top. Keep entries short: what surprised you, why it is that
way, and what to do about it. [AGENTS.md](AGENTS.md) stays lean by pointing here.

<!-- Format: ### YYYY-MM-DD — short title, then 1–3 lines. -->

### 2026-08-29 — a `useQuery` below an early return only crashes on a COLD mount; a warm cache and green unit tests both hide it
The skill `EvalsTab` called `useEvalBatch` (a `useQuery`) *after* its `if (isLoading)` / `if (isError)` returns, so
the loading→loaded transition rendered more hooks than the render before it and React threw
`Rendered more hooks than during the previous render` into the error boundary. It looked intermittent because a
warm React Query cache skips the loading branch entirely — navigating in from another tab worked, a direct
`/skills/:id?tab=evals` load did not — and the component's own 10 passing tests never exercised it either.
Every `use*` query hook belongs ABOVE the first conditional return, even when its argument is only computed later;
when a tab "sometimes" dies, load its URL directly rather than clicking into it.

### 2026-08-29 — two `Modal`s open at once is not a nesting problem, it is a `document` listener problem
`vendor/ui/kit/Modal.tsx` binds its Escape/Tab handler on **`document`**, not on its own dialog, and
portals to `<body>` — so a confirm `Modal` opened from inside another one gives you two live traps:
one Escape fires BOTH `onClose`s (the confirm and the screen behind it vanish together), and on Tab
the outer handler sees `dialog.contains(active) === false` for the portaled inner and yanks focus
back, fighting the inner handler that does the same in reverse. `VersionsTab` gets away with its
confirm `Modal` only because its parent is a tab, not a dialog. When the parent IS a dialog, put the
confirmation in that dialog's own `footer` and swap the footer's contents on a `confirming` flag —
`CompareModal`'s `Promote vN` does this. Same file as the 2026-08-29 opacity/portal entry, different
failure.

### 2026-08-29 — a restore endpoint's no-op is invisible in its response; you need the version from BEFORE the call
`POST /skills/:id/restore` and `POST /agents/:id/restore` both answer `200` with the entity whether
they wrote a new version or decided nothing changed, so "did that do anything?" is only answerable
against the version the owner held beforehand — which is what `VersionsTab` compares
(`saved.version === skill.version`). Comparing the response to the version you ASKED for looks
equivalent and is not: promote v20 once and v21 is current, promote v20 again and the no-op answers
21, which is `> 20` and reads as a fresh success. `CompareModal` gets `owner_kind`/`owner_id` from
the comparison and calls `useAgent`/`useSkill` (the inactive one passed `null`, so `enabled: false`
and no request) purely to hold that number.

### 2026-08-29 — a "do it for all N" button must catch PER ITERATION; one rejection kills the whole sweep
`for (…) { await m.mutateAsync(x) }` looks like N independent calls but is one promise chain: the
`/evals` `Run all agents` stopped at agent one, because `POST /evals/batches` 400s (`no_cases`) for an
agent with no eval cases and that workspace's first row is exactly such an agent — four agents never
ran and the only clue was a single toast. Wrap each iteration in its own `try/catch`; nothing is
hidden by doing so, since `lib/providers.tsx`'s `MutationCache.onError` toasts every rejection
globally whether or not the caller catches it. Related to the entry below on `isPending`: the same
sweep must also track busy in LOCAL state, as one observer follows only its latest call.

### 2026-08-29 — per-row busy state for a LIST comes from `useMutationState`, never from `isPending`/`variables`
One `useMutation` observer tracks only its LATEST call: `mutate` again while the first is in flight
re-points `isPending`/`variables` at the new mutation and detaches the observer from the old one, so a
row spinner derived from `variables` jumps to the row clicked second, and "disable everything while
`isPending`" is the workaround that hides it. `useMutationState({ filters: { mutationKey, status:
'pending' } })` reads the mutation CACHE instead and returns every in-flight call's variables —
`useRunEvalCase` returns that as `runningIds`, so several eval cases can run at once and each spins on
its own row. Mutation-level `onSuccess` still fires for a detached mutation (only per-call
`mutate(vars, { onSuccess })` callbacks are lost), so every concurrent run still invalidates the list.

### 2026-08-29 — a busy control needs the kit's `loading`, not `disabled` — and a queue needs a THIRD state
`vendor/ui` `Button` has a `loading` prop that swaps the configured icon for a spinning `RefreshCw`
(`ddspin` keyframes in `vendor/ui/styles.css`) and disables the button; `disabled` alone with an
unchanged label is what made the agent `EvalsTab`'s `Run` read as a dead click for a seconds-long
round trip, while the skill `EvalsTab`, which already passed `loading`, did not. A row waiting its turn
in a sequential batch is NOT running — `EvalsTab` gives it a still `Clock` + `Queued` instead, because
spinning every row would claim N live LLM calls where the server (by design) has exactly one.

### 2026-08-29 — a write-modal that by spec stays OPEN after saving owes its own confirmation
`EvalCaseEditor` deliberately never closes on save (REQ-11: stay put to see the run result), so the
confirmation was left to callers via `onSaved` — and all three call sites (`FindingCard`, agent and
skill `EvalsTab`) pass only `onClose`. With `Run on save` off the screen was byte-identical before
and after a successful `POST /evals/cases`, so Save read as a no-op. When a dialog is specified to
stay open after a write, the confirmation obligation moves INSIDE it — an optional callback nobody
passes is not a delivery mechanism.

### 2026-08-29 — derive a "saved" indicator from a serialized payload comparison, not a dirty flag
`EvalCaseEditor` builds its `EvalCaseWrite` at render (not inside `persist`) and keeps
`savedPayload = JSON.stringify(payload)` from the last successful write; `isSaved` is just
`savedCaseId !== null && savedPayload === payloadKey`. It withdraws itself on an edit to ANY field
with no onChange wiring, no `useEffect` and no timer — a boolean `saved` flag keeps claiming "saved"
over edited-since content, and a `setTimeout` note is a fake-timer hazard in the jsdom suite.

### 2026-08-29 — `window.confirm` is invisible to the Browser pane: the click silently does nothing
The agent `EvalsTab` per-case delete gates on `window.confirm` (its `onDelete`), unlike the skill
`EvalsTab` and `EvalCaseEditor`, which both use a `Modal`. Driven from the Browser pane it looks
like a dead button — no dialog renders and no DELETE fires. Stub it first (`javascript_tool`:
`window.confirm = () => true`), and prefer the `Modal` confirm in new code so the flow is drivable.

### 2026-08-29 — the agent-editor TAB shell already pads; a tab that adds its own is double-inset
`AgentEditor/styles.ts` `body` is `padding: 28`, so a tab's own `padding: "24px 28px 44px"` stacks
on top of it — `ContextTab`, `SkillsTab` and (until now) `EvalsTab` all pay ~52px of horizontal
inset while `ConfigTab`, which sets none, is the one that renders correctly. This is the INVERSE of
the 2026-08-17 "`AppFrame`'s `<main>` has NO padding" entry and easy to get backwards: that rule is
about a *page* dropped into `AppShell`, not about a *tab* inside an editor that already has a padded
body. A tab wrap should set vertical spacing only, and never `maxWidth` if it is meant to be fluid.

### 2026-08-29 — a NULL-defaulted server field can contradict the data it summarizes; reconcile, don't read it raw
`eval_cases.expectation_kind` is derived server-side (`evals/scoring.ts` `deriveExpectationKind`),
but `evals/helpers.ts` coalesces a NULL column to `'must_not_flag'` *regardless of the findings
stored beside it* — so a legacy row can arrive as `must_not_flag` while `expected_output` is
non-empty, and a UI reading the field raw renders a `MUST NOT FLAG` pill next to a `CRITICAL` badge.
When a served field is a summary OF other fields in the same payload, derive from (or reconcile
against) the underlying data — `EvalsTab/helpers.ts` `expectationKindOf` is the worked example, and
a test that sets the two in conflict is what pins it.

### 2026-08-29 — a query keyed by the resource id alone serves the WRONG body when the response depends on that resource's mutable state
`useFindingEvalDraft` used `["eval-draft", findingId]`, but `GET /findings/:id/eval-draft` stamps
`seeded_from` from `accepted_at`/`dismissed_at` — the only thing `EvalCaseEditor` labels its
POSITIVE/NEGATIVE banner from. So accept → open (POSITIVE) → revert → dismiss → open re-served the
accept-time entry inside `providers.tsx`'s `staleTime: 30_000` and opened POSITIVE for a dismissed
finding. **Invalidating on the write is NOT a sufficient fix here**: a stale-but-present entry keeps
`isSuccess`/`data` populated during the background refetch, so a fast click still reads the old body —
put the state in the KEY (`["eval-draft", id, decidedAs]`), which starts the new state at
`data: undefined`. Refines the "the resource IS the cache key" convention in that hook's doc comment:
the key must cover everything the RESPONSE varies on, not just the row it is fetched for.

### 2026-08-29 — putting a disabled control's REASON in `aria-label` renames it, breaking exact-name `getByRole` in other suites
Adding the revert flow to `FindingCard` disabled Dismiss on an accepted finding and named it
`Dismiss — Revert the acceptance first…` so the reason is announced, not hover-only. That silently
broke a `FindingCard.test.tsx` case querying `getByRole("button", { name: "Dismiss" })` — RTL matches
a string name EXACTLY, and this repo queries buttons that way in dozens of places, including suites
for components that only render the control transitively. Query a control whose name can gain a
reason with a prefix regex (`/^Dismiss/`), and grep the whole client for the literal name before
changing one. Same family as the 2026-08-17 `FormField required` note, different mechanism: that one
is label TEXT folding the `*` in, this one is an `aria-label` overriding the visible text entirely.

### 2026-08-29 — a `Modal` rendered inside a dimmed card is painted at the card's alpha — portal, don't raise z-index
`FindingCard` sets `opacity: .6` on an accepted/dismissed card, and its "Turn into eval case"
button (which only enables *because* the finding is decided) rendered `EvalCaseEditor`'s `Modal` as
a DOM child of that card. `opacity < 1` groups the whole subtree into one composited layer and
creates a stacking context, so the dialog came out see-through with page content over it — while
`getComputedStyle` still reported `rgb(28,28,28)` and `elementsFromPoint` still put the dialog on
top, so the DOM "looks" correct. Raising `z-index` does nothing (the context is the cage).
`vendor/ui/kit/Modal.tsx` now `createPortal`s to `document.body`; `Drawer.tsx` has the same shape
and the same exposure if it is ever mounted from a dimmed subtree.

### 2026-08-29 — the FIRST `useQuery` inside a reused leaf breaks every consumer's test, and `enabled: false` does not save you
`useQueryClient()` throws `No QueryClient set in QueryClientProvider` *before* it ever looks at the
query's own `enabled`, so gating the query does not help. Adding an eval-draft hook to `FindingCard`
broke all four suites that render that tree standalone (`FindingCard`, `FindingsPanel`,
`FindingsTab`, `pulls/[number]/page`) — none had a provider ancestor, because nothing under it had
ever called `useQuery`. Wrap those suites in a `QueryClientProvider` (copy `reviews.test.tsx`'s
shape); a **local** provider inside the component "fixes" the tests but isolates its cache, so its
mutations invalidate nothing the app reads.

### 2026-08-29 — Recharts `ResponsiveContainer` renders 0×0 under jsdom, so chart assertions pass vacuously
`getBoundingClientRect()` returns all zeros in jsdom, `ResponsiveContainer` settles on
`width/height = 0`, and the child chart emits **no SVG at all** — a test asserting on paths or
`stroke-dasharray` then passes while testing nothing. Stub `Element.prototype.getBoundingClientRect`
to a fixed size in `beforeEach`/`afterEach`, as `vendor/ui/charts/LineChart.test.tsx` now does.

### 2026-08-29 — `@testing-library/user-event` is NOT installed in `client/`, despite what the skills say
Absent from `package.json`, `pnpm-lock.yaml` and `node_modules`, while the `react-testing-library`
skill and several plan red-flag lists instruct `userEvent.setup()`. All 62 existing `*.test.tsx` use
`fireEvent`, which is the real convention here. Adding it means editing `package.json` + the lockfile
— both Tier A — so an implementer that hits this must use `fireEvent` and report the gap, not install.

### 2026-08-27 — `usePrReviews` returns every agent's every run — `reviews[0]` is not "the PR's review"
`reviewsForPull` returns EVERY historical `reviews` row for EVERY agent, newest-first, and until
2026-08-27 had no secondary sort key — so `reviews[0]` is whichever agent happened to finish LAST,
and on concurrently fanned-out runs (`created_at` is `defaultNow()`) it was not even stable across
refreshes. `PrBriefCard` rendered that one row as the PR's headline and showed "Approve · 0 findings
· 100" on a PR another agent had rejected with 4 blockers. **Any PR-wide number must group by
`agent_id` and keep the newest per agent first** (`_lib/verdict.ts` `aggregatePr`) — a plain sum over
the rows is also wrong, since re-running one agent adds a row rather than replacing one.

### 2026-08-27 — An aggregate that folds floats is order-dependent; sort before you fold
Summing `cost_usd` over a `Map`'s insertion order made `aggregatePr` return
`0.026600000000000002` or `0.0266` for the same three runs depending only on the order the caller
passed them — float addition is not associative, and a test asserting "stable however the reviews
are ordered" is what caught it. Any helper claiming order-independence must impose its own order
(here: newest-first, `id` breaking ties) before folding, not inherit the caller's.


### 2026-08-27 — Asserting a style is ABSENT needs `el.style`, not `getComputedStyle`
Refines the "jsdom reflects inline styles through `getComputedStyle`" note: that holds only for
properties you SET. An unset one resolves to its CSS default, so `getComputedStyle(el).background`
on a borderless box is `"rgba(0, 0, 0, 0)"`, never `""` — read `el.style.background` when the point
of the test is that the component draws no card box (`PrBriefCard/RiskAreas.test.tsx`).

### 2026-08-27 — A hand-rolled `api.post` opts out of cache invalidation, and `staleTime: 30_000` hides it for 30s
`useContextAutosave` (`lib/hooks/context.ts`) skips `useMutation` to get its own debounce and
issue-order sequencing, and so never touched the query cache — so after an attach/detach the
`["context-attachment", …]` entry kept serving pre-edit paths, and since both `Context` tabs seed
their attached set once at mount (deliberate, see 2026-08-16), switching agents and back reverted
the checkbox. Only a refresh or `gcTime` eviction cleared it. **If a write does not go through
`useMutation`, its `setQueryData`/`invalidateQueries` is on you.** Two traps when fixing this
shape: guard the cache write with the same superseded-write check the rest of the handler uses, and
prefer `refetchType: "none"` for a query the writing screen holds ACTIVE if its endpoint is
expensive (`listForRepo` re-walks the checkout on every GET). A test can also pin the bug — this
one was asserted as “the hook never writes into that query’s cache”.

### 2026-08-26 — A full-height page (inner-scrolling panes) works without touching `AppFrame`
`styles.css` sets `html, body { height: 100% }` and `AppFrame`'s `<main>` is
`flex:1; minHeight:0; overflow:auto` inside a `100vh` column, so a page container with
`height: "100%"` already gets a *definite* height — no `calc(100vh - 52px)` and no shell edit.
The part that actually bites: every flex ancestor between that container and the scrolling child
needs `minHeight: 0`, or the child refuses to shrink below its content and the whole page scrolls
instead of the pane (`app/repos/[repoId]/context/.../styles.ts` is the worked example). Such a page
opts out of the 2026-08-17 `maxWidth: 1100` container rule — that rule exists because `<main>` has
no padding, so a full-bleed page satisfies it by giving each pane its own padding.

### 2026-08-26 — `tsc` and vitest map `./x.js` → `x.ts`; Next's webpack does not, unless you tell it
The vendored `src/vendor/shared` is a byte-identical copy of the server's NodeNext contracts, so its
barrel re-exports `./contracts/*.js`. `moduleResolution: "Bundler"` and Vite both perform the TS
`.js`→`.ts` substitution, but Next's webpack only does it via `experimental.extensionAlias`
(`next.config.mjs`) — so a broken vendored import passes `pnpm typecheck` AND `pnpm test` and only
surfaces as `Module not found: Can't resolve './contracts/findings.js'` in the dev server. `pnpm build`
is the only gate that catches it. Corollary: `import type` from `@devdigest/shared` is erased by SWC
and never resolved, so the first runtime VALUE import of the barrel is what trips this.

### 2026-08-25 — a hook's `isError` branch does NOT cover a malformed payload; that one throws in render
`api.get<T>()` is a plain TypeScript cast with no runtime parse, so a partial or drifted response
resolves *successfully* and then throws when the component destructures it (`const { totals } = blast`).
TanStack Query never sees a failure, the card's `isError` branch never runs, and `app/error.tsx` blanks
the whole route segment. Wrap such cards in `components/error-boundary` — pass `resetKeys={[prId]}` so
the fallback clears on navigation — or validate the payload in the hook. The card's own error branch is
only for transport failures.

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
