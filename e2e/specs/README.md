# e2e — Specs index
↑ [CLAUDE.md](../CLAUDE.md)

Each spec is a `NN-name.flow.json` = ordered list of agent-browser commands run by
[`../run.ts`](../run.ts). Format & run modes: [`../README.md`](../README.md).
Coverage is typological, not exhaustive.

| Spec | Flow |
|------|------|
| `01-app-boot.flow.json` | root → redirect to first repo's PR list → seeded PR #482 |
| `02-repo-pulls-detail.flow.json` | PR list → open PR #482 → review detail route |
| `03-agents.flow.json` | agents list renders the seeded reviewer agents |
| `04-pr-findings.flow.json` | PR #482 → Agent runs tab → seeded verdict + findings; expand → FindingCard |
| `05-pr-diff.flow.json` | PR #482 → Files changed tab → seeded file in the diff viewer |
| `06-onboarding.flow.json` | `/onboarding` → add-repository form renders (no submit) |
| `07-settings.flow.json` | `/settings/api-keys` + `/settings/models` → section titles render |

**Adding a flow:** deterministic locators only (`--url` / `--text` / `find`),
target seeded read-only data, never the AI `chat` command.
