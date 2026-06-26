# e2e/specs/

Browser flow files for `@devdigest/e2e`. Each `.flow.json` is a deterministic browser scenario.

## Conventions

- Filename: `NN-<short-name>.flow.json` — numbered for stable ordering
- Assertions are deterministic only: `--url`, `--text`, `find role|text|label`
- Never use `chat` (LLM) commands — flows must produce the same result on every run
- Every flow assumes the seeded demo state (`acme/payments-api` PR #482)
- New flows that cover L01+ features should be added here with the next available number
