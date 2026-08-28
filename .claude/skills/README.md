# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/`. Shared with the team via version control.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Where server code goes — rings, import matrix, DI via `Deps`, module boundaries |
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [frontend-ui-architecture](frontend-ui-architecture/SKILL.md) | Frontend | Where client code goes — file/folder placement, colocation, import boundaries |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |
| [spec-authoring](spec-authoring/SKILL.md) | Process | The prescriptive-spec format — eleven sections, the five EARS criteria patterns, the design partition, and the `AC-n` → `REQ-n` interlock |
| [engineering-insights](engineering-insights/SKILL.md) | Process | Appending a non-obvious finding to the right module's `INSIGHTS.md` |
| [dependency-checker](dependency-checker/SKILL.md) | Process | Read-only dependency audit across all five packages — size breakdown, a package-to-package Mermaid graph, internal (alias/relative-import) vs external (npm) findings tiered P0–Info, and a priority-ordered summary |
| [pr-self-review](pr-self-review/SKILL.md) | Process | Gate before a PR — scopes the diff, routes it to the skills above, runs the CI-equivalent checks, issues a blocking verdict |
| [run-plan](run-plan/SKILL.md) | Process | Drives an existing `docs/plans/NN-*.md` — waves to `implementer`, then the architecture review→fix→re-review loop, then `plan-verifier` |
| [workflow-retro](workflow-retro/SKILL.md) | Process | After a multi-agent run, **on request only** — measured token cost per agent, launch order, duplicated context, and proposed (never applied) edits to agent and skill files |

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **[Agents](../agents/README.md)** (`.md`) | Workflows | Via Task tool | Subagent orchestration |

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `examples.md` — Code examples showing good/bad patterns (recommended)
- `references.md` — Sources and rationale (optional)
