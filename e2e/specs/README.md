# e2e/specs — executable flows, not written specs

This directory holds **runnable** browser flows: `NN-name.flow.json`. `run.ts`
discovers them by the `.flow.json` suffix and runs them in filename order
against one shared session, so this README is ignored by the runner.

Written specs for this package go in `../docs/` instead — do not add prose files
here.

Adding a flow:

- Deterministic locators only (`--url`, `--text`, `find role|text|label`). Never
  the AI `chat` command.
- `wait --text` / `wait --url` **are** the assertions — they exit non-zero on
  timeout.
- Read-only against seeded data (`acme/payments-api`, PR #482, seeded agents).
  Nothing that writes, and nothing that triggers a model call.
- Verify with `npm run e2e:hermetic`, not against your dev DB.
