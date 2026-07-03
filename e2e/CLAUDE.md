# e2e (@devdigest/e2e) — agent guide

Deterministic browser end-to-end flows via Vercel **agent-browser** (Rust + CDP CLI).
**No Playwright/Cypress, no LLM, no API key** — determinism is the point.

## Where things live
- `specs/NN-name.flow.json` — each flow is an ordered list of agent-browser commands; `run.ts` runs them all in one shared session.
- Assertions: `wait --text` / `wait --url` (non-zero exit = fail) + optional `assert.stdoutIncludes`. **Deterministic locators only — never the AI `chat` command.**
- Failure screenshots → `test-results/`.

## Assumptions
Runs against a **freshly-seeded** DB (only `acme/payments-api`, PR #482). New UI must keep these locators/flows green.

## Run
- Hermetic (isolated stack on alt ports): `../scripts/e2e.sh`.
- Against a running stack: `npm test`. Env: `E2E_BASE_URL`, `AGENT_BROWSER_BIN`, `E2E_STEP_TIMEOUT`.
