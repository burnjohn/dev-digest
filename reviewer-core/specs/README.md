# reviewer-core/specs

Specs for the review engine's contracts and behaviour — the shape of prompts,
grounding rules, verdict/score semantics, and the optional prompt slots (`skills`,
`memory`, `specs`, `callers`) that later lessons feed in.

Because the engine is provider-agnostic and mock-tested, a spec here doubles as the
acceptance criteria for its hermetic vitest cases — which is why the prescriptive form
below writes them in EARS: an `AC-n` that names an observable maps onto a test case
without a translation step.

## Two kinds of spec live here

| | Prescriptive — written **before** the code | Descriptive — written **after** it shipped |
|---|---|---|
| File | `SPEC-NN-<slug>.md` | `<feature>.md` |
| Header | `Spec ID: SPEC-NN` · `Status:` · `Supersedes:` | none |
| Written by | [`spec-creator`](../../.claude/agents/spec-creator.md) | [`doc-writer`](../../.claude/agents/doc-writer.md) |
| Answers | what "done" means, in criteria you can check | how the engine behaves today |

`SPEC-NN` is a **single repo-wide counter** across `server/`, `client/`, `reviewer-core/`
and `mcp/` — the filenames are the registry, there is no index file. Numbers are
allocated one at a time, never by two agents at once. `Status:` has one value, `draft`:
`approved` and `implemented` are gone — approval is a conversation, not a field.

The eleven-section template and the five EARS patterns are specified in
[`spec-authoring`](../../.claude/skills/spec-authoring/SKILL.md), not duplicated here. Note that
`specs` is also the name of a runtime **prompt slot** in the engine — a different thing
from this directory.
