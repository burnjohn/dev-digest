# Flow Authoring Guide

E2E flows are JSON files in `specs/` that drive the `agent-browser` CLI (Vercel, CDP-based).
They are NOT Playwright or Cypress — each step is a verbatim command passed to the browser agent.

## File structure

```jsonc
{
  "name": "Human-readable description of what this flow tests",
  "steps": [
    { "cmd": ["open", "{BASE}/"], "label": "Open home page" },
    { "cmd": ["wait", "--url", "/pulls"], "label": "Wait for redirect to pull list" },
    { "cmd": ["find", "role=link", "--text", "acme/payments-api"], "label": "Repo link is visible" }
  ]
}
```

`{BASE}` is replaced at runtime with `E2E_BASE_URL` (default `http://localhost:3000`).

## Available commands

| Command | Usage | Notes |
|---|---|---|
| `open` | `["open", "{BASE}/path"]` | Navigate to URL |
| `wait` | `["wait", "--url", "/path"]` | Wait until current URL contains value |
| `find` | `["find", "role=button", "--text", "Submit"]` | Assert element exists; fails if not found |
| `click` | `["click", "role=button", "--text", "Submit"]` | Click a located element |
| `type` | `["type", "role=textbox", "--text", "hello"]` | Type into a focused input |

## Hard rule: deterministic assertions only

Never use `chat` (LLM reasoning) commands in flows. Flows must be fully deterministic:
every assertion must be a structural check (`--url`, `--text`, `find role|text|label`).

Non-zero exit from `agent-browser` = flow failure. A `chat` step that "passes" by LLM
judgement is not a deterministic assertion and will produce flaky results.

## Seed dependency

All flows assume the seeded demo repo **`acme/payments-api`** with PR **#482** is present.
Hard-code against these fixture values — do not create flows that depend on dynamic data
created at test time.

To run against a clean isolated DB:
```sh
./scripts/e2e.sh   # seeds an isolated DB automatically, runs on alternate ports
```

Running `npm test` against a stale or empty DB will fail on the first `find` that expects
seeded content.

## Naming convention

Files are numbered sequentially: `01-app-boot.flow.json`, `02-repo-pulls-detail.flow.json`, etc.
Numbers determine execution order. Leave gaps (`01`, `03`) rather than renumbering existing files.

## Adding a new flow

1. Create `specs/NN-feature-name.flow.json`
2. Cover one user journey end-to-end — not individual component states
3. Only assert things that are deterministic from seed data
4. Add a row to the flow table in `CLAUDE.md`
5. Run `./scripts/e2e.sh` to verify the flow passes against the hermetic stack
