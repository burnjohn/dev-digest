# e2e/AGENTS.md

Deterministic browser flows — `@devdigest/e2e`. Root conventions in [../AGENTS.md](../AGENTS.md).

## Commands

```sh
npm test                # run flows against live stack (must be up at :3000 / :3001)
./scripts/e2e.sh        # hermetic isolated stack on alternate ports (recommended for CI)
```

## Flow format

Flows are JSON files in `specs/` — not Playwright, not Cypress. Commands are passed verbatim to the `agent-browser` CLI (Vercel, CDP-based).

```jsonc
{
  "name": "...",
  "steps": [
    { "cmd": ["open", "{BASE}/"], "label": "..." },
    { "cmd": ["wait", "--url", "/pulls"], "label": "..." }
  ]
}
```

`{BASE}` is replaced with `E2E_BASE_URL` (default `http://localhost:3000`).

## Hard rule — deterministic assertions only

Only use: `--url`, `--text`, `find role|text|label`.
Never use `chat` (LLM) commands — flows must be fully deterministic.
Non-zero exit from `agent-browser` = flow failure.

## Seed dependency

All flows assume the seeded demo repo **`acme/payments-api`** PR **#482** is present.
Use `./scripts/e2e.sh` which seeds an isolated DB automatically.
Running `npm test` against a stale or empty DB will fail.

## Existing flows

| File | Coverage |
|---|---|
| `01-app-boot.flow.json` | Root → redirect → seeded PR #482 |
| `02-repo-pulls-detail.flow.json` | PR list → open PR → review detail |
| `03-agents.flow.json` | Agents list with seeded reviewers |
| `04-pr-findings.flow.json` | Agent Runs tab → verdict + findings |
| `05-pr-diff.flow.json` | Files Changed tab → diff viewer |
| `06-onboarding.flow.json` | Add repository form renders |
| `07-settings.flow.json` | API keys + Models sections |

## Session Protocol

**Start of session:** Read `insights.md` and briefly summarize the most relevant entries for the current task.
**End of session:** Run `/engineering-insights` to capture discoveries. Do not skip after sessions > 30 min with a real problem or decision.

## See also

- [README.md](README.md) — flow authoring guide, hermetic runner details
- [docs/](docs/) — design decisions
- [specs/](specs/) — flow files live here
- [insights.md](insights.md) — accumulated gotchas
- [../AGENTS.md](../AGENTS.md) — root conventions
