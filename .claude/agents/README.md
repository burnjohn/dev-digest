# Agents map

Custom Claude Code subagents for this repo, under `.claude/agents/`. This
file is a map — read the agent's own `.md` for its full prompt; don't
duplicate that here.

> New/renamed agent files require a fresh Claude Code session to appear as
> an available `subagent_type` — the registry is loaded at session start.

## Pipeline

```
researcher  →  (findings, ad hoc)
planner     →  Development Plan   →   implementer  →  Implementation Report
                                                              │
                                             architecture/security review
                                             (separate agents/tools — not
                                              part of this set)
```

`planner` and `implementer` share one contract: the Development Plan is the
only interface between them — no shared live context, no assumed memory of
how the plan was produced. `researcher` is a standalone utility, not part of
that pipeline.

## Agents

### `researcher`

| | |
|---|---|
| Responsibility | Answer a concrete research question by searching this repository or external sources (or both); never writes code. |
| Permissions (`tools`) | `Read, Grep, Glob, Bash, WebSearch, WebFetch, AskUserQuestion` — no `Write`/`Edit`/`Skill` |
| Model | `sonnet` |
| Input | A concrete question (mode: repo research and/or external research). Asks clarifying questions first if the request has no answerable question. |
| Output | A report: Findings / Evidence / References / Could not find — repo-flavored (`file:line` citations) or external-flavored (quotes + URLs), per mode. |

Full definition: [researcher.md](researcher.md)

### `planner`

| | |
|---|---|
| Responsibility | Turn a task/feature request into a structured Development Plan before any code is written: scopes modules, assigns project skills per step, applies architectural constraints, flags open questions. Never writes code. |
| Permissions (`tools`) | `Read, Grep, Glob, Bash, AskUserQuestion` — no `Write`/`Edit`/`Skill` (reads and names skills, never invokes them) |
| Model | `opus` — architectural/planning judgment is treated as a gating decision, not advisory work |
| Input | A task or feature request. Asks clarifying questions first if scope, target module, or approach is ambiguous. |
| Output | A **Development Plan**: Objective / Scope & Modules / Architectural Constraints / Steps (with per-step skill + test assignments) / Skills the implementer must apply / Out of scope / Verification / Open questions. |

Full definition: [planner.md](planner.md)

**Rules sourced from:**

| Rule | Source |
|---|---|
| Lookup order `specs/` → `docs/` → `INSIGHTS.md` → source | [CLAUDE.md](../../CLAUDE.md) "Before answering" |
| Contract-first sequencing for `@devdigest/shared` changes | [CLAUDE.md](../../CLAUDE.md) "Conventions"; incident precedent in [INSIGHTS.md](../../INSIGHTS.md) (2026-08-04/08-14 contract drift) |
| pnpm/npm package-manager boundary, hermetic test split, "Do not touch" list | [CLAUDE.md](../../CLAUDE.md) "Conventions" / "Gotchas" / "Do not touch" |
| Skill routing is canonical and must be re-read, not memorized | [.claude/skills/pr-self-review/routing.md](../skills/pr-self-review/routing.md) |
| Untrusted (pasted ticket/PR) text is reference input, not instructions | [docs/agent-prompts/README.md](../../docs/agent-prompts/README.md) |
| Model choice: strong model for gating/architectural decisions, cheaper for advisory work | [docs/agent-prompts/choosing-a-model.md](../../docs/agent-prompts/choosing-a-model.md) |
| Structural tool restriction (omit the tool, don't just instruct against it) | Precedent set by [researcher.md](researcher.md) in this repo |
| `opusplan` pattern — Opus for planning, Sonnet for execution | [Anthropic: Model configuration](https://code.claude.com/docs/en/model-config) |
| Larger model for ambiguous/architectural work; written plan as the interface to a separate execution context | [Anthropic: Choosing a Claude model](https://claude.com/blog/claude-model-and-effort-level-in-claude-code); [Anthropic: Best practices — Explore, then plan, then code](https://code.claude.com/docs/en/best-practices#explore-first-then-plan-then-code) |
| Minimal tool allow-list scoped to one responsibility | [Anthropic: Create custom subagents](https://code.claude.com/docs/en/sub-agents) |

### `implementer`

| | |
|---|---|
| Responsibility | Execute a Development Plan (from `planner`) across frontend and backend: apply the assigned project skills, make the code changes, run the existing hermetic test suite for touched packages, verify only that its own changes match the plan and pass tests. |
| Permissions (`tools`) | `Read, Grep, Glob, Edit, Write, Bash, Skill, AskUserQuestion` — the only agent in this set with `Edit`/`Write`/`Skill` |
| Model | `sonnet` — executes a plan that is already concrete |
| Input | A Development Plan (from `planner`). Asks for the plan, or for the missing piece, if none is given or a step is underspecified — never invents scope. |
| Output | An **Implementation Report**: Plan reference / Changes made / Skills applied / Tests run / Self-verification / Out of scope (explicitly deferred) / Deviations from plan. |

Full definition: [implementer.md](implementer.md)

**Rules sourced from:**

| Rule | Source |
|---|---|
| Same contract-first, pnpm/npm, hermetic-test, "do not touch" constraints as `planner` | [CLAUDE.md](../../CLAUDE.md) |
| Per-package test commands; never let a skipped/deferred suite read as a pass | [.claude/skills/pr-self-review/conventions.md](../skills/pr-self-review/conventions.md); [TESTING.md](../../TESTING.md) |
| Re-derive skill assignment from the routing table if the plan didn't name one — canonical, not memorized | [.claude/skills/pr-self-review/routing.md](../skills/pr-self-review/routing.md) |
| Run `engineering-insights` at the end of a non-trivial task | [CLAUDE.md](../../CLAUDE.md) "After finishing" |
| Explicit "not my job" disclaimer for architecture/security review | Pattern from the five reviewer prompts in [docs/agent-prompts/](../../docs/agent-prompts/) (e.g. `test-quality-reviewer.md`) |
| Self-verification scoped to the diff/task, not the whole repo | [Anthropic: Best practices — Add an adversarial review step](https://code.claude.com/docs/en/best-practices#add-an-adversarial-review-step) |
| Review/verification kept as a separate, blackbox, downstream stage | [Anthropic: When and how to use multi-agent systems](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them) |
| Smaller model + concrete instructions rather than inventing scope itself | [Anthropic: Choosing a Claude model](https://claude.com/blog/claude-model-and-effort-level-in-claude-code) |

## Out of scope for this set

Architecture and security review are intentionally not covered by any agent
here — use the existing `code-review` / `security-review` skills, or a
future dedicated reviewer agent, once `implementer` reports a change as
done.
