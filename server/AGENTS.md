# server (@devdigest/api)

## Before answering
Search `server/docs/`, `server/specs/`, `server/INSIGHTS.md` for the topic before reading code.

## Conventions (not obvious from code)
- Multi-tenancy: every domain table has `workspace_id`; queries are scoped by the base-repository guard.
- DI via `src/platform/container.ts`: services depend on interfaces (`@devdigest/shared`), not classes; tests inject mocks via `ContainerOverrides`.
- repo-intel is reached ONLY through the facade `container.repoIntel.*` — never touch the pipeline directly.
- Context enrichment is best-effort: on error/unindexed, omit the section, don't throw.
- New feature = new module + one line in `src/modules/index.ts`; new columns = your own migration only.

## Use when
- Overview, commands, route/API map → read `server/README.md`
- Indexer internals → read `server/src/modules/repo-intel/README.md`
- Deep-dives → read `server/docs/` · feature specs/acceptance → read `server/specs/` · gotchas/findings → read `server/INSIGHTS.md`
