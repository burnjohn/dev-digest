# e2e/insights.md

Accumulated non-obvious findings about `@devdigest/e2e`. Add an entry whenever something surprises you.

---

## 2025-06 npm test fails against an empty or stale DB

**Context**: Running `npm test` after resetting Docker volumes or on a fresh clone.
**Discovery**: All 7 flows assume `acme/payments-api` PR #482 is in the DB. The flows don't seed data themselves — they rely on a pre-seeded state. Running against an empty DB causes the first flow to fail at the redirect step.
**Impact**: Always use `./scripts/e2e.sh` (hermetic isolated stack with its own seed) for reliable runs. Use `npm test` only when you know the stack is up and seeded.
**Status**: current

---

## 2025-06 agent-browser is CDP-based — not Playwright

**Context**: Looking for Playwright config files or browser launch options.
**Discovery**: The `agent-browser` CLI uses Chrome DevTools Protocol directly — there is no Playwright, no Cypress, no Puppeteer. Flow steps are JSON commands passed to the CLI, not script files.
**Impact**: Don't look for `.spec.ts` files or a `playwright.config.ts`. Flows are in `specs/*.flow.json`. The browser is controlled entirely by the CLI.
**Status**: current

---

## 2025-06 Non-zero exit from agent-browser = flow failure — no summary output

**Context**: A flow fails and you're looking for a structured error report or diff.
**Discovery**: `agent-browser` exits with a non-zero code on the first failed step. There is no summary report, no screenshot diff, no detailed failure log beyond what the CLI prints to stdout.
**Impact**: Read the CLI stdout carefully on failure — the failing step label and command are printed. Add descriptive `label` fields to every step to make failures readable.
**Status**: current

---

## 2025-06 {BASE} substitution is the only templating in flows

**Context**: Wanting to use a dynamic repo ID or PR number in a flow URL.
**Discovery**: The only substitution available is `{BASE}` → `E2E_BASE_URL`. There is no variable system for dynamic values. All IDs referenced in flows must match the seeded demo data exactly.
**Impact**: E2e flows are tightly coupled to seed data. If seed data changes (e.g., PR #482 is renamed), all flows that reference it must be updated. Keep seed data stable.
**Status**: current
