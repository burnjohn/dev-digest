# Development Plan: New Sub-Agents — Test Writer, Architecture Reviewer, Plan Verifier, Doc Writer

**Date:** 2026-06-30
**Status:** Implemented
**Scope:** meta — `.claude/agents/` and `.claude/skills/` tooling layer only
**Affects modules:** `.claude/agents/`, `.claude/skills/`, `docs/` — no product code

---

## Overview

Expand the agent catalog from 3 agents (implementer, planner, researcher) to 7 by adding four domain-specific agents covering the full development lifecycle: writing tests, reviewing architecture, verifying plan requirements, and producing documentation. Three supporting skills were also created to give the new agents their domain knowledge.

---

## Deliverables

### New Skills

| Skill | Directory | Purpose |
| --- | --- | --- |
| `server-testing` | `.claude/skills/server-testing/` | Backend test patterns for Fastify/Drizzle/Vitest |
| `plan-verifier` | `.claude/skills/plan-verifier/` | Verification methodology — how to map plan requirements to code |
| `doc-writer` | `.claude/skills/doc-writer/` | Documentation standards — output formats, where to write by doc type |

### New Agents

| Agent | File | Tools | Skills |
| --- | --- | --- | --- |
| `test-writer` | `.claude/agents/test-writer.md` | Read, Glob, Grep, Edit, Write, Bash | react-testing-library, server-testing, react-best-practices, fastify-best-practices, drizzle-orm-patterns |
| `architecture-reviewer` | `.claude/agents/architecture-reviewer.md` | Read, Glob, Grep *(read-only)* | backend-onion-architecture, frontend-architecture, typescript-expert, security |
| `plan-verifier` | `.claude/agents/plan-verifier.md` | Read, Glob, Grep, Bash *(read-only)* | plan-verifier, backend-onion-architecture, react-best-practices |
| `doc-writer` | `.claude/agents/doc-writer.md` | Read, Glob, Grep, Edit, Write, Bash | doc-writer, mermaid-diagram, engineering-insights |

---

## Architecture Decisions

- **Read-only enforcement**: agents that must not write (architecture-reviewer, plan-verifier) simply omit `Edit`/`Write` from their `tools:` list — this is the mechanism, not a comment or convention.
- **Skills encode methodology, agents encode workflow**: skills (`server-testing`, `plan-verifier`, `doc-writer`) contain domain rules reusable by any agent; agent files contain the workflow orchestration that sequences those rules.
- **Domain detection is path-based and mechanical**: `test-writer` determines frontend vs backend from file path (`client/` → RTL, `server/` → Fastify inject). No inference needed.
- **Topological skill loading**: `doc-writer` and `test-writer` read their relevant skills before writing anything — this is the anti-hallucination guarantee.
- **`server-testing` fills a gap**: `react-testing-library` already covered frontend; no equivalent backend skill existed. Created `server-testing` as the canonical backend testing skill. Any agent writing tests for `server/` must load `server-testing`, never `react-testing-library`.

---

## Implementation Steps

Tasks 1–7 are independent; Task 8 depends on all prior tasks.

### Task 1 — Create `.claude/skills/server-testing/SKILL.md`

- Test split strategy (`*.it.test.ts` integration vs `*.test.ts` unit)
- Vitest-only rules (`vi.fn()`, `vi.mock()`)
- Route testing via `app.inject()`
- Service unit testing with mocked injected dependencies
- AppError assertion pattern
- Coverage strategy table per module type

### Task 2 — Create `.claude/skills/plan-verifier/SKILL.md`

- Input format (plan document with Steps/Criteria/Testing sections)
- 6-step verification process (parse → evidence → status → report)
- Evidence types table (file existence, Grep for symbols, route registration, test files, AGENTS.md, migrations)
- ✅/⚠️/❌ status definitions with examples
- Verification report format (`Requirement | Status | Evidence | Notes`)
- Scope boundary: completeness only, not quality/architecture/style

### Task 3 — Create `.claude/skills/doc-writer/SKILL.md`

- Doc type → location mapping table (5 doc types)
- Per-symbol documentation structure (5 fields: Functionality, Parameters, Behavior, Notes, Examples)
- Topological generation order (leaf deps first)
- Mermaid conventions (C4Component, sequenceDiagram, flowchart TD)
- Converting implementation plan to design doc (strip implementation details, keep API surface, add diagrams)
- Quality checks before writing (Glob for paths, Grep for symbols, Mermaid validity)

### Task 4 — Create `.claude/agents/test-writer.md`

- Path-based domain detection table
- Conditional skill loading (frontend: react-testing-library + react-best-practices; backend: server-testing + fastify-best-practices)
- Critical rules block (vi.fn(), userEvent, inject(), test split suffixes)
- 7-step workflow (read source → detect → load skills → check existing tests → write → typecheck → run)
- Coverage strategy table (always/if-branching/skip) with target counts per module type

### Task 5 — Create `.claude/agents/architecture-reviewer.md`

- Read-only (no Edit/Write in tools)
- Scope table (checks vs skips)
- 5-phase workflow (map structure → trace imports → check onion rules → side-effect contamination → project invariants)
- 4-tier severity findings table (Critical/High/Medium/Low with meanings)
- Never-do list

### Task 6 — Create `.claude/agents/plan-verifier.md`

- Read-only (no Edit/Write in tools)
- 4-phase workflow (parse plan → gather evidence → assign status → output report)
- Explicit evidence type search per requirement
- Status assignment with file:line citation
- Scope boundary: completeness only

### Task 7 — Create `.claude/agents/doc-writer.md`

- Input type detection table (plan → design doc, code → README, routes → API ref, conversation → feature spec)
- Conditional skill loading (doc-writer skill always; mermaid-diagram before any diagram)
- 7-step workflow
- Quality gate (hard stop on any missing entity)
- Location mapping per doc type

### Task 8 — Update READMEs

- `.claude/agents/README.md`: catalog table with all 7 agents, pipeline diagram, `## <name>` sections for all 4 new agents with skill routing and use-when
- `.claude/skills/README.md`: 3 new rows (server-testing, plan-verifier, doc-writer)

---

## Acceptance Criteria

```sh
# Agent name frontmatter matches filename stem
grep -qE "^name: test-writer$" .claude/agents/test-writer.md
grep -qE "^name: architecture-reviewer$" .claude/agents/architecture-reviewer.md
grep -qE "^name: plan-verifier$" .claude/agents/plan-verifier.md
grep -qE "^name: doc-writer$" .claude/agents/doc-writer.md

# Skill files exist
test -f .claude/skills/server-testing/SKILL.md && echo "exists"
test -f .claude/skills/plan-verifier/SKILL.md && echo "exists"
test -f .claude/skills/doc-writer/SKILL.md && echo "exists"

# Read-only agents have no Edit/Write in tools
grep -vE "Edit|Write" .claude/agents/architecture-reviewer.md | grep "^tools:"
grep -vE "Edit|Write" .claude/agents/plan-verifier.md | grep "^tools:"

# Skills README updated with all 3 new skills
grep -c "server-testing\|plan-verifier\|doc-writer" .claude/skills/README.md
```

Expected outputs:

- The four `grep -qE` commands produce no output (silent success)
- Both `test -f` commands print `exists`
- Both read-only `tools:` lines appear without Edit/Write
- The final `grep -c` returns `3`

---

## Out of Scope

- No changes to product code (`server/`, `client/`, `reviewer-core/`, `e2e/`)
- No changes to `@devdigest/shared` contracts
- No changes to existing agents (researcher, planner, implementer)
- No DB migrations
