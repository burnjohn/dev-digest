# E2E Gotchas

## agent-browser must be installed globally before running

```bash
npm i -g agent-browser && agent-browser install
```

`agent-browser install` downloads the browser binary. Without it, `npm test` fails with a binary-not-found error, not a meaningful test failure. This is a one-time setup per machine.

## Hermetic mode tears down the stack automatically — even on failure

`./scripts/e2e.sh` starts an isolated Postgres + API + web stack, runs all flows, and tears everything down regardless of whether flows pass or fail. If you need to inspect the state after a failure, run against a live stack (`./scripts/dev.sh` + `cd e2e && npm test`) instead.

## Flows share nothing — each starts fresh from seed state

There is no shared browser session between flows. Each flow opens a new browser context. Do not write flows that depend on state created by a previous flow (e.g., "create a repo in flow A, verify it in flow B"). Use seed data.

## Text assertions are substring matches

`--text "Repositories"` passes if "Repositories" appears anywhere on the page — in a heading, a link, a tooltip. If you need to assert a specific element has specific text, use `find` with a precise selector instead.

## CI runs hermetic mode — live stack mode is for local development only

GitHub Actions uses `./scripts/e2e.sh` (hermetic). The `cd e2e && npm test` shortcut (live stack) is for local development speed only. If a flow passes locally but fails in CI, check whether it depends on state that is not in the seed.

## `find` with CSS selectors fails silently if selector is too broad

A selector like `div` will always match. Use `data-testid` or compound selectors (`[data-testid="repo-card"]`) so failures are meaningful. A `find` that always passes regardless of page state provides no value.

## Port conflicts break hermetic mode

`./scripts/e2e.sh` starts services on ports 3000 and 3001. If those ports are in use (e.g., from a `./scripts/dev.sh` session), the hermetic stack fails to start. Kill the dev stack before running hermetic e2e.
