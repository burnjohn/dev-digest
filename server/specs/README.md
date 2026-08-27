# server/specs

Feature specs and design proposals for `@devdigest/api` — what a module should do and
why. The reviewer engine can also be fed `specs` as a prompt slot in later lessons, so
keep them in sync with intent.

## Two kinds of spec live here

| | Prescriptive — written **before** the code | Descriptive — written **after** it shipped |
|---|---|---|
| File | `SPEC-NN-<slug>.md` | `<feature>.md` |
| Header | `Spec ID: SPEC-NN` · `Status:` · `Supersedes:` | none |
| Written by | [`spec-creator`](../../.claude/agents/spec-creator.md) | [`doc-writer`](../../.claude/agents/doc-writer.md) |
| Answers | what "done" means, in criteria you can check | how the thing behaves today |
| Example | `SPEC-01-blast-radius.md` | [`smart-diff.md`](smart-diff.md) |

`SPEC-NN` is a **single repo-wide counter** across `server/`, `client/`, `reviewer-core/`
and `mcp/` — the filenames are the registry, there is no index file. Numbers are
allocated one at a time, never by two agents at once. `Status:` has one value, `draft`:
`approved` and `implemented` are gone — approval is a conversation, not a field.

A prescriptive spec carries eleven fixed sections — problem, goals/non-goals, user
stories, EARS acceptance criteria, edge cases, module interactions, non-functional
requirements, inputs and provenance, untrusted inputs, design review, open questions.
The template and the EARS patterns are specified in
[`spec-authoring`](../../.claude/skills/spec-authoring/SKILL.md); it is not duplicated here.

A feature spanning packages gets **one** spec, in the package that owns the contract —
usually this one. Link the relevant spec from a module's code or PR when it exists.
