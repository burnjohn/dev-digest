# client/specs

Feature/UX specs for `@devdigest/web` — screen behaviour, states, and interaction
contracts. Reference the relevant spec from a page/component or its PR when it exists.

## Two kinds of spec live here

| | Prescriptive — written **before** the code | Descriptive — written **after** it shipped |
|---|---|---|
| File | `SPEC-NN-<slug>.md` | `<feature>.md` |
| Header | `Spec ID: SPEC-NN` · `Status:` · `Supersedes:` | none |
| Written by | [`spec-creator`](../../.claude/agents/spec-creator.md) | [`doc-writer`](../../.claude/agents/doc-writer.md) |
| Answers | what "done" means, in criteria you can check | how the screen behaves today |
| Example | `SPEC-02-agent-editor.md` | `review-detail.md` |

`SPEC-NN` is a **single repo-wide counter** across `server/`, `client/`, `reviewer-core/`
and `mcp/` — the filenames are the registry, there is no index file. Numbers are
allocated one at a time, never by two agents at once. `Status:` has one value, `draft`:
`approved` and `implemented` are gone — approval is a conversation, not a field.

A prescriptive spec carries eleven fixed sections, specified in
[`spec-authoring`](../../.claude/skills/spec-authoring/SKILL.md) rather than duplicated here.
Two of them matter most on this side of the wire:

- **Design review** — when a spec is written against a mockup, it partitions the image
  three ways: what is binding, what is artistic licence nobody should implement, and what
  the design leaves open. A mockup shows the happy path; the states it omits (loading,
  empty, error, partial, offline) get specified as edge cases instead.
- **Module interactions** — which endpoint a screen depends on, and what it renders when
  that endpoint is slow, refuses, or returns a shape the hook did not expect.
