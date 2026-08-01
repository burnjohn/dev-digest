# LEARNINGS — client/@devdigest/web

> append-only: add entries, never overwrite existing ones. Review monthly, delete stale notes.

## What Works

**2026-08-02** · **UI/Popups** · React Portal pattern for table popups: render via `ReactDOM.createPortal(..., document.body)`, position with `anchorRect = triggerRef.current.getBoundingClientRect()` on click, close on `mousedown` outside via `document.addEventListener`. Lazy-mount the portal component so data fetches only start when popup opens (client/src/app/repos/[repoId]/pulls/_components/FindingsSeverityBadge/FindingsSeverityBadge.tsx) · Confidence: high

## Codebase Patterns

**2026-07-31** · **Components** · Cost badge returns `null` (not empty string, not "—") for running/missing runs so the table cell stays empty — "—" is reserved for completed runs that have no cost data. Two distinct states, two distinct outputs (client/src/app/repos/[repoId]/pulls/_components/RunCostBadge/RunCostBadge.tsx) · Confidence: high

## Recurring Errors & Fixes

<!-- Repeated mistakes + their fixes -->

## What Doesn't Work

**2026-08-02** · **UI/Popups** · `position: absolute` inside a CSS grid cell or table row does NOT work for popups — any ancestor with `overflow: hidden` clips it silently. Always use `ReactDOM.createPortal(popup, document.body)` + `getBoundingClientRect()` on the trigger ref for any popup/dropdown inside a table · Confidence: high

## Session Notes

**2026-08-02** · Реалізовано findings severity breakdown (client частина). Новий `FindingsSeverityBadge` (portal popup у PR list), `SeverityChips` у `RunHistory` (portal по run_id), фільтр-кнопки у `FindingsPanel`. i18n: новий ключ `list.columns.findings` у `messages/en/prReview.json`. Тести не написані.

**2026-07-31** · Реалізовано Run Cost Badge (L01). Новий компонент `RunCostBadge`, колонка в PR list і Agent runs tab, stat в sidebar. Додано i18n ключі `list.columns.cost` і `trace.stat.cost`. Тести не написані — залишено на наступну сесію.

## Tool & Library Notes

<!-- Quirks and gotchas of Next.js 15, TanStack Query, next-intl, etc. -->

## Open Questions

**2026-08-02** · `findingsCount` у `PrDetailHeader` таб "Agent runs" рахує кількість findings (allFindings.length), а не кількість runs — tab показує неправильну цифру. Треба замінити на `runs.length`. Не виправлено в цій сесії (page.tsx:77)

~~**2026-07-31** · Коли додається нова колонка в таблицю PR list або рядок stats в sidebar — потрібно також додавати i18n ключ. Чи є конвенція де саме і в якому форматі?~~ → Відповідь: `messages/en/prReview.json` під `list.columns.<key>` для PR list, `messages/en/runs.json` під `trace.stat.<key>` для sidebar stats.
