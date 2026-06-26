# server/src/db/CLAUDE.md

Drizzle ORM + Postgres 16 + pgvector. Schema split into per-domain files under `schema/`, re-exported via `schema.ts`.

## Migration rules

- Naming: `NNNN-description.sql` in `server/drizzle/`
- **Never edit an applied migration** — it breaks all environments that already ran it
- **Never alter existing columns** — L01–L08 lessons depend on schema stability; add only
- Workflow: edit `schema/` → `pnpm db:generate` → review the generated file → `pnpm db:migrate`

## Schema conventions

- Every domain table has a non-nullable `workspace_id` FK — enforced at schema level, not just query level
- pgvector columns exist but are inert unless `EMBEDDINGS_ENABLED=true`
- `run_traces.trace` is a single JSONB document (full run log) — not normalized into rows

## Gotcha

`relation "x" does not exist` on first run = migrations haven't been applied.
Server does **not** auto-migrate on boot. Run `cd server && pnpm db:migrate` explicitly.

## See also

- [../../../CLAUDE.md](../../../CLAUDE.md) — root conventions
- `server/drizzle/` — applied migration files
