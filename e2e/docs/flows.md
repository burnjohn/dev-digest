# E2E Flows

How to write, run, and debug agent-browser flow specs.

## What is agent-browser

A CLI tool that executes deterministic browser flows defined as JSON step sequences. No LLM, no Playwright, no API keys. Install once:

```bash
npm i -g agent-browser && agent-browser install
```

## Flow File Format

Each flow is a JSON file in `e2e/flows/`:

```json
{
  "name": "repo-list",
  "description": "Repos page renders seeded repo",
  "steps": [
    { "command": "--url",  "value": "http://localhost:3000" },
    { "command": "--text", "value": "Repositories" },
    { "command": "find",   "value": "[data-testid='repo-card']" },
    { "command": "--text", "value": "acme/payments-api" }
  ]
}
```

## Available Commands

| Command | What it does |
|---------|-------------|
| `--url` | Navigate to URL. Waits for page load. |
| `--text` | Assert text exists somewhere on the page. Fails if not found within timeout. |
| `find` | Assert element exists by CSS selector or accessible label. |
| `click` | Click element by CSS selector. |
| `--wait` | Wait N milliseconds (use sparingly). |

Steps execute sequentially. First failing step fails the flow immediately.

## Adding a New Flow

1. Create `e2e/flows/<name>.json` with the steps
2. Register it in `e2e/run.ts` flows array
3. Run locally against a seeded stack: `cd e2e && npm test`

**Rules:**
- Flows must be deterministic — same seed data, same result every time
- Do not depend on dynamic content (timestamps, generated IDs in text assertions)
- Use `data-testid` attributes for `find` commands where possible
- Keep flows independent — each flow starts from scratch (no shared state between flows)

## Selectors to Prefer (in order)

1. `data-testid="..."` — most stable, add to components if missing
2. ARIA role + label: `[role="button"][aria-label="Run review"]`
3. CSS class only as last resort

## Running Locally

```bash
# Against a running stack (fastest for development)
./scripts/dev.sh          # in another terminal
cd e2e && npm test

# Hermetic (isolated stack, no side effects)
./scripts/e2e.sh
```

## Debugging a Failing Flow

agent-browser outputs each step result with a pass/fail indicator. A `--text` failure shows what text was actually found on the page. A `find` failure shows which selector did not match.

To debug interactively: run the app (`./scripts/dev.sh`), open the page in a browser manually, and verify the text/selector before adding it to a flow.
