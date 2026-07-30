# LEARNINGS — client/@devdigest/web

> append-only: add entries, never overwrite existing ones. Review monthly, delete stale notes.

## What Works

<!-- Approaches and solutions that worked well in this module -->

## Codebase Patterns

**2026-07-31** · **Components** · Cost badge returns `null` (not empty string, not "—") for running/missing runs so the table cell stays empty — "—" is reserved for completed runs that have no cost data. Two distinct states, two distinct outputs (client/src/app/repos/[repoId]/pulls/_components/RunCostBadge/RunCostBadge.tsx) · Confidence: high

## Recurring Errors & Fixes

<!-- Repeated mistakes + their fixes -->

## What Doesn't Work

<!-- Dead ends, anti-patterns, wrong turns — most valuable section, most often skipped -->

## Session Notes

**2026-07-31** · Реалізовано Run Cost Badge (L01). Новий компонент `RunCostBadge`, колонка в PR list і Agent runs tab, stat в sidebar. Додано i18n ключі `list.columns.cost` і `trace.stat.cost`. Тести не написані — залишено на наступну сесію.

## Tool & Library Notes

<!-- Quirks and gotchas of Next.js 15, TanStack Query, next-intl, etc. -->

## Open Questions

**2026-07-31** · Коли додається нова колонка в таблицю PR list або рядок stats в sidebar — потрібно також додавати i18n ключ. Чи є конвенція де саме і в якому форматі? Перевірити `messages/en/` при наступній зміні UI.
