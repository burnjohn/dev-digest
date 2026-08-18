# e2e (`@devdigest/e2e`) — agent notes

**npm, not pnpm.** Own `package-lock.json`.

## Commands

```sh
npm i -g agent-browser && agent-browser install   # once — downloads Chrome for Testing
npm run e2e:hermetic    # RECOMMENDED: isolated seeded stack (:5433/:3101/:3100)
npm test                # runs flows against whatever is on E2E_BASE_URL
npm run typecheck
```

## Conventions

- A flow is `specs/NN-name.flow.json`: a JSON list of agent-browser commands run
  in order against one shared browser session by `run.ts`.
- `{BASE}` is substituted with `E2E_BASE_URL` (default `http://localhost:3000`).
- **`wait --text` / `wait --url` are the assertions** — they exit non-zero on
  timeout. Optional `"assert": { "stdoutIncludes": … }` adds a stdout check.
- **Deterministic locators only**: `--url`, `--text`, `find role|text|label`.
  Never use the AI `chat` command — runs must stay stable and key-free.
- Flows target read-only seeded data (`acme/payments-api`, PR #482, seeded
  agents) so nothing triggers a model call. Do not add a flow that writes.

## Gotchas

- **Flows assume a freshly-seeded DB with exactly one repo.** Flow `02` follows
  the home redirect to the *first* repo. Your dev DB usually has other imported
  repos, so plain `npm test` against it fails flows 02/04/05. Use
  `npm run e2e:hermetic`.
- **Never `docker compose down -v`** to fix this — `-v` deletes the
  `devdigest_pgdata` volume and every real repo and review in it. The hermetic
  runner exists precisely so you never need to touch the dev DB.
- This is a CLI wrapper, not a test framework: a failing step fails the flow with
  the raw agent-browser exit, so read stderr rather than expecting a matcher diff.

## Read when

- Read `INSIGHTS.md` first for what was already tried here, and run the
  `engineering-insights` skill at the end of the task to add to it.
- Read `README.md` for the flow format and the full hermetic-runner walkthrough.
- Read `docs/` for this package's written specs — `specs/` holds executable
  `*.flow.json` files, so prose lives in `docs/` instead.
- Read `../client/README.md` when a flow breaks after a UI route change.
- Read `../TESTING.md` for where this suite sits in the overall strategy.
