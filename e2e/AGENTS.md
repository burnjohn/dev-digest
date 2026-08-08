# e2e/ — @devdigest/e2e

Deterministic browser e2e flows via Vercel agent-browser (CDP). No Playwright, no LLM, no API key.

## Stack

- agent-browser CLI (Rust + CDP), TypeScript 5.7, tsx
- JSON flow specs in `specs/*.flow.json` — no test framework, just ordered commands
- Assertions = `wait --text` / `wait --url` (timeout = failure)

## Commands

```sh
npm test                # run flows against running stack (localhost:3000)
npm run e2e:hermetic    # isolated stack on alternate ports (recommended)
../scripts/e2e.sh       # same as above, from repo root
```

## Where things live

- `specs/*.flow.json` — test flow definitions (ordered agent-browser commands)
- `run.ts` — runner that executes flows against a shared browser session
- `test-results/` — failure screenshots (git-ignored, CI artifact)

## Conventions

- Flows target read-only seeded data (demo repo `acme/payments-api`, PR #482)
- Locators are deterministic only: `--url`, `--text`, `find role|text|label` — never AI `chat`
- `{BASE}` placeholder in specs → replaced with `E2E_BASE_URL`

## Gotchas

- Flows assume freshly-seeded DB with ONLY the demo repo — running against a dev DB with other repos will fail (flows 02/04/05 pick the first repo)
- Use hermetic runner (`e2e.sh`) to avoid touching your dev DB
- NEVER `docker compose down -v` to "reset" — it deletes your real data volume

## Env knobs

`E2E_BASE_URL` (localhost:3000) · `E2E_STEP_TIMEOUT` (60000ms) · `AGENT_BROWSER_BIN` · hermetic ports: `E2E_PG_PORT` (5433) · `E2E_API_PORT` (3101) · `E2E_WEB_PORT` (3100)

## Deep docs (read on demand)

- [INSIGHTS.md](INSIGHTS.md) — what past sessions learned in this package; read before non-trivial work
- [README.md](README.md) — flow format, hermetic runner, coverage table
- [specs/](specs/) — all flow definitions
- [../TESTING.md](../TESTING.md) — CI workflow (`e2e-web.yml`)
