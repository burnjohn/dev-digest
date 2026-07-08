# Plans

Implementation plans produced by the implementation-planner agent. One file per feature or task.

## Naming convention

`YYYY-MM-DD-<feature-slug>.md`

Example: `2026-06-29-researcher-agent.md`

## Lifecycle

1. **researcher** — gathers codebase snapshot and external context before planning.
2. **implementation-planner** — reviews the spec's requirements (or captures them standalone when no spec exists), asks targeted clarifications, reads module insights, writes the plan here after user confirmation.
3. **implementer** — reads the plan, picks one assigned task, executes it to green.

One implementer instance per task — spawn them in parallel for independent tasks.

## Plan document structure

Each plan must have 8 sections:

| # | Section | Purpose |
| --- | --- | --- |
| 1 | Context | What is being built and why |
| 2 | Architecture Fit | How it slots into the existing module structure |
| 3 | Skills & Patterns Applied | Mandatory skills the implementer must follow |
| 4 | Project Constraints | Invariants from AGENTS.md and module insights |
| 5 | Implementation Steps | Atomic steps, each with owned paths, dependencies, verify checklist, commit message |
| 6 | Acceptance Criteria | Measurable pass/fail criteria |
| 7 | Testing Plan | Server integration vs. hermetic; client RTL |
| 8 | Out of Scope | Explicit exclusions |
