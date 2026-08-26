# mcp/specs

Specs for `@devdigest/mcp`, the local stdio MCP server — tool contracts, the resolution
layer, response shaping, idempotency and the error catalogue.

[`mcp-server.md`](mcp-server.md) is this package's **authoritative architecture
document**, not merely a feature spec: `mcp/AGENTS.md` scopes the `onion-architecture`
skill through it. Read it before specifying anything here.

## Two kinds of spec live here

| | Prescriptive — written **before** the code | Descriptive — written **after** it shipped |
|---|---|---|
| File | `SPEC-NN-<slug>.md` | `<feature>.md` |
| Header | `Spec ID: SPEC-NN` · `Status:` · `Supersedes:` | none |
| Written by | [`spec-creator`](../../.claude/agents/spec-creator.md) | [`doc-writer`](../../.claude/agents/doc-writer.md) |
| Answers | what "done" means, in criteria you can check | how the server behaves today |
| Example | `SPEC-03-tool-cancellation.md` | [`mcp-server.md`](mcp-server.md) |

`SPEC-NN` is a **single repo-wide counter** across `server/`, `client/`, `reviewer-core/`
and `mcp/` — the filenames are the registry, there is no index file. Numbers are
allocated one at a time, never by two agents at once. `Status:` has one value, `draft`:
`approved` and `implemented` are gone — approval is a conversation, not a field.

The eleven-section template and the five EARS patterns are specified in
[`spec-authoring`](../../.claude/skills/spec-authoring/SKILL.md), not duplicated here. A spec for
a new tool should treat `## Inputs and provenance` and `## Untrusted inputs` as
load-bearing: every argument arrives from an MCP client this package does not control.
