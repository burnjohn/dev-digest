# e2e/ — @devdigest/e2e

Deterministic browser flows using agent-browser (Rust + CDP). No Playwright, no LLM, no API key.
Read `e2e/README.md` for full setup, flow format reference, and coverage table.

## Always use the hermetic runner

```sh
./scripts/e2e.sh   # isolated Postgres :5433 + API :3101 + web :3100
```

Running `npm test` against your dev DB breaks flows 02/04/05 — they assume only the seeded demo repo exists.
**Never `docker compose down -v`** — it deletes your dev DB volume along with all imported repos.

## Flow conventions

- Flows live in `specs/NN-name.flow.json`
- Locators must be deterministic: `--url`, `--text`, `find role|text|label`
- **Never use the AI `chat` command** — runs must be stable and key-free
- `wait --text` / `wait --url` are the assertions (non-zero exit = step failed)
- Target read-only seeded data only — no flows should trigger a model call

## Session protocol

- **Start:** silently read `e2e/LEARNINGS.md` before responding — treat as high-confidence guidance.
- **End:** run `/engineering-insights` only if something substantial and new was found. If nothing non-obvious happened, write nothing. Before writing any entry, re-read LEARNINGS.md to avoid duplicates.

## Read when

- Flow format, env knobs, coverage table → `e2e/README.md`
- Lessons and session learnings → `e2e/LEARNINGS.md`
- Technical docs → `e2e/docs/`
