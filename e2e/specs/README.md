# e2e/specs

The end-to-end **flow specs**: `NN-name.flow.json`, each a JSON list of agent-browser
commands run in order by [`../run.ts`](../run.ts). `{BASE}` → `E2E_BASE_URL`;
`wait --text` / `wait --url` are the assertions (a non-zero exit fails the step).

Add a flow by dropping in the next-numbered file. Keep locators deterministic
(`--url`, `--text`, `find role|text|label`) and target **seeded read-only data** so no
model call is triggered. Coverage table: [../README.md](../README.md).
