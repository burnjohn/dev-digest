# server/insights.md

Accumulated non-obvious findings about `@devdigest/api`. Add an entry whenever something surprises you.

---

## 2025-06 Migrations do not run on server boot

**Context**: First-time setup after cloning the repo.
**Discovery**: The server starts without error even when migrations haven't been applied. The first DB query fails with `relation "x" does not exist` — not on startup.
**Impact**: Always run `cd server && pnpm db:migrate` before `pnpm dev` on a fresh DB. The error happens at runtime, not at startup, so it looks like a request bug.
**Status**: current

---

## 2025-06 Secrets are not in AppConfig — by design

**Context**: Adding a new service that calls the LLM or GitHub API.
**Discovery**: `process.env.OPENAI_API_KEY` is `undefined` even when set in `.env`. Keys flow through `SecretsProvider`, which reads from `~/.devdigest/secrets.json` first, then falls back to `process.env`.
**Impact**: In services, get secrets via `container.secrets.get('openai')`. Never read `process.env` for API keys directly. The chokepoint is intentional — it enables UI-based key entry without restarting the server.
**Status**: current

---

## 2025-06 Integration tests spin up a real Postgres via testcontainers

**Context**: Running `pnpm test` for the first time without Docker running.
**Discovery**: `*.it.test.ts` files pull a Postgres Docker image and create an ephemeral DB per suite. First run is slow due to image pull. Docker daemon must be running.
**Impact**: Use `pnpm exec vitest run --exclude '**/*.it.test.ts'` for fast hermetic-only runs in environments without Docker.
**Status**: current

---

## 2025-06 RunTrace is one JSONB document, not event rows

**Context**: Debugging a review run and looking for individual event records in the DB.
**Discovery**: There are no per-event rows. The entire run log (PromptAssembly + RunLogLine[] + stats + grounding summary) is stored as a single `run_traces.trace` JSONB column.
**Impact**: To inspect a run: `SELECT trace FROM run_traces WHERE run_id = '...'`. Don't look for individual event tables — they don't exist.
**Status**: current

---

## 2025-06 SSE streaming assumes a single API process

**Context**: Considering running two API instances or horizontal scaling.
**Discovery**: `runBus` is an in-memory event emitter. A client connected to instance A won't receive events emitted by a review running on instance B.
**Impact**: One API process only for local use. Scaling would require replacing `runBus` with Redis Pub/Sub or a similar external bus.
**Status**: current — known limitation

---

## 2025-06 L02–L08 tables exist but modules are not registered

**Context**: Exploring the DB schema and finding tables for skills, eval, memory, etc.
**Discovery**: All lesson tables are created by the initial migration set. They are empty until the lesson's module is registered in `src/modules/index.ts`.
**Impact**: Don't be confused by empty tables. Check `modules/index.ts` to see what's actually active. Empty tables are expected before a lesson is implemented.
**Status**: current

---

## 2026-06-26 JSONB-stored Zod schemas need .nullish(), not .nullable()

**Context**: Adding a new optional field to `RunStats`, which is persisted as part of a JSONB document in `run_traces.trace`.
**Discovery**: Old stored documents simply omit keys that didn't exist when they were written. Zod's `.nullable()` expects the key to be present with value `null`; parsing an old document that lacks the key entirely fails. `.nullish()` = `optional + nullable` accepts both absent and null.
**Impact**: For any field added to a schema that is deserialized from JSONB (not from a DB row), use `.nullish()`. Fields on `RunSummary` (constructed fresh from DB columns) can safely use `.nullable()`. `server/src/vendor/shared/contracts/trace.ts:68`
**Status**: current

---

## 2026-06-26 Numeric computed fields can be derived at read time — no migration needed

**Context**: Implementing the cost badge, which initially looked like it required a new `cost_usd` column in `agent_runs`.
**Discovery**: `estimateCost(model, tokensIn, tokensOut)` computes the USD cost from three columns that already exist on `agent_runs`. Calling it during the `rows.map()` in the repository avoids adding a column, avoids a migration, and keeps pricing logic up-to-date when the pricing table changes.
**Impact**: Before adding a column for a derived numeric value, check whether it can be computed from existing columns at read time. Only persist when the source data will change after the fact (e.g., retroactive repricing). `server/src/modules/reviews/repository/run.repo.ts:68`
**Status**: current

---

## 2026-06-26 WSL-installed node_modules break vitest and drizzle-kit in Windows PowerShell

**Context**: Running `pnpm exec vitest run` or `pnpm db:generate` from Windows PowerShell after dependencies were installed inside WSL.
**Discovery**: Native platform packages (`@rollup/rollup-linux-x64-gnu`, `@esbuild/linux-x64`) are installed for the Linux ABI. Loading them in a Windows Node.js process fails immediately with `Cannot find module '@rollup/rollup-win32-x64-msvc'`. The error is the same for esbuild and tsx.
**Impact**: If node_modules were installed in WSL, tests and migrations cannot run from Windows PowerShell without reinstalling deps natively. Either always use WSL for tooling, or run `pnpm install` from a Windows shell to get the correct native binaries.
**Status**: current

---
*Last updated: 2026-06-26 · Entries: 8*
