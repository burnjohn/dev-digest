# Insights — client

Running log of non-obvious findings, decisions, and gotchas for `@devdigest/web`.
Append newest at the top. Keep entries short: what surprised you, why it is that
way, and what to do about it. [CLAUDE.md](CLAUDE.md) stays lean by pointing here.

<!-- Format: ### YYYY-MM-DD — short title, then 1–3 lines. -->

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
