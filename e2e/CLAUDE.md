# e2e — browser end-to-end suite (`@devdigest/e2e`)
↑ [Root map](../CLAUDE.md)

Map of this module for AI agents. Flow format & run instructions live in the
README (linked below) — this file is the map, not the docs.

## Stack & commands
- Vercel **agent-browser** (Rust + CDP). **No Playwright, no LLM, no API key.**
- `pnpm e2e:hermetic` (recommended — isolated freshly-seeded stack on alt ports,
  leaves your dev DB untouched) · `pnpm test` (against your own running stack).
- `./scripts/e2e.sh` from repo root does the hermetic run.

## Map (where things live)
| Path | Purpose |
|------|---------|
| `run.ts` | runs each flow's commands in order against one shared browser session |
| `specs/NN-name.flow.json` | a flow = ordered JSON list of agent-browser commands |
| `lib/` | helpers for the runner |

## Conventions (non-default)
- **Deterministic only:** locators are `--url` / `--text` / `find role|text|label`.
  Never the AI `chat` command — keeps runs stable and key-free.
- `wait --text` / `wait --url` **are the assertions** (non-zero exit fails the flow).
- `{BASE}` → `E2E_BASE_URL` (default `http://localhost:3000`).
- Flows target read-only seeded data (`acme/payments-api`, PR #482) so nothing
  triggers a model call.

## Do-not-touch / gotchas
- **Precondition: a freshly-seeded DB with only the seeded repo.** Flows 02/04/05
  follow the home redirect to the *first* repo — a dev DB with other repos makes
  them land wrong. Use the hermetic runner.
- ⚠️ **Never `docker compose down -v`** to reset your dev DB — `-v` deletes the
  `devdigest_pgdata` volume and every imported repo/review.

## Read when…
- Read `./README.md` for the flow format, run modes, and env knobs.
- Read `./specs/README.md` for the flow coverage table.
- Read `./docs/README.md` when you need deeper e2e design notes.
- Read `./INSIGHTS.md` at the START of any task here; append substantial,
  non-duplicate insights at the END (engineering-insights skill).
