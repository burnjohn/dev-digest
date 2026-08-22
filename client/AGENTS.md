# client (@devdigest/web)

## Before answering
Search `client/docs/`, `client/specs/`, `client/INSIGHTS.md` first.

## Conventions (not obvious from code)
- Types/contracts come from `@devdigest/shared` (Zod) — never hand-duplicate them.
- All API access goes through `src/lib/api.ts`.

## Use when
- Page/route map, commands → read `client/README.md`
- Deep-dives → read `client/docs/` · UI/flow specs → read `client/specs/` · findings → read `client/INSIGHTS.md`
