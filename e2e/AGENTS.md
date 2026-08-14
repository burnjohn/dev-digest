# AGENTS.md — `@devdigest/e2e`

Deterministic UI end-to-end flows driven by Vercel **agent-browser** (native CDP CLI).
**No Playwright, no LLM, no API key.** Full runner details: **[README.md](README.md)**.

## Commands (run from `e2e/`, npm — not pnpm)

- `pnpm e2e:hermetic` (or `../scripts/e2e.sh`) — **recommended.** Boots an isolated,
  freshly-seeded stack on alt ports (PG :5433, API :3101, web :3100), runs flows, tears down.
- `pnpm test` — `tsx run.ts` against your own running stack (only safe with a clean DB, below).
- `pnpm typecheck`.

## Where things live

- `specs/NN-name.flow.json` — each flow is a JSON list of agent-browser commands run in order.
  `{BASE}` → `E2E_BASE_URL`. `wait --text` / `wait --url` **are** the assertions.
- `run.ts` — the runner. `lib/assert.ts` — assertions. `agent-browser.json` — CLI config.

## Non-default conventions

- **Deterministic locators only** (`--url`, `--text`, `find role|text|label`). Never use the AI
  `chat` command — that keeps runs stable and key-free.
- Flows target **read-only seeded data** (`acme/payments-api`, PR #482, seeded agents) so nothing
  triggers a model call.

## Gotchas

- **Precondition: a freshly-seeded DB with ONLY the demo repo.** Flows 02/04/05 follow the home
  redirect to the *first* repo. Your dev DB usually has other repos → they land wrong and fail.
  **Prefer the hermetic runner**, which spins up its own isolated stack.
- **NEVER `docker compose down -v`** to reset your dev DB — it deletes `devdigest_pgdata` and all
  your imported repos/reviews.
- Failure screenshots → `test-results/` (git-ignored; uploaded as a CI artifact).

## On-demand docs

[README.md](README.md) · [specs/](specs) (the flow specs) · [docs/](docs) (design notes) ·
[INSIGHTS.md](INSIGHTS.md) (gotchas & decisions log)
