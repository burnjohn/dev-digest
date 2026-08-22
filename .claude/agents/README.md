# Agent registry — dev-digest

Seven agents in this directory. Each runs as an isolated child process with its own context window and explicit tool allowlist.

**Invocation:** via the `Agent` tool with `subagent_type: <name>`, or automatically by Claude Code when a user message matches the `description` trigger phrases.

---

## Agents at a glance

| Agent | Model | Write/Edit | Web | permissionMode | maxTurns | Asks questions |
|-------|-------|-----------|-----|----------------|----------|----------------|
| researcher | sonnet-4-6 | no | yes | default | default | yes |
| planner | sonnet-4-6 | no | no | default | default | yes |
| implementer | sonnet-4-6 | yes | no | default | 40 | no |
| test-writer | sonnet-4-6 | yes (Write) | no | default | 30 | no |
| architecture-reviewer | opus-4-7 | no | no | plan | default | no |
| plan-verifier | opus-4-7 | no | no | plan | 10 | no |
| doc-writer | sonnet-4-6 | yes (Write) | no | acceptEdits | 26 | no |

---

## researcher

**File:** `researcher.md`

**Responsibility:** Read-only research in two modes. Mode A traces code in the repository (file:line evidence, data-flow). Mode B queries external sources (docs, RFCs, CVEs, changelogs). Combined mode produces both reports plus a Synthesis section.

**Tools:** `Bash`, `Read`, `WebFetch`, `WebSearch`, `Agent`, `ToolSearch`

**Preloaded skills:** none

**Input:** a specific research question + mode (repo / external / both). If the question is vague, asks up to three clarifying questions before starting.

**Output artifacts:**

- *Codebase Research Report* — findings table with `file:line` evidence, key code references, data/control flow, gaps & unknowns, confidence rating
- *External Research Report* — findings table with URLs, sources list, conflicts section, not-found list, confidence rating
- *Synthesis* — how repo findings relate to external findings (combined mode only)

---

## planner

**File:** `planner.md`

**Responsibility:** Read-only analysis of the codebase, CLAUDE.md files, and LEARNINGS.md → structured Development Plan. The plan is implementer-aware: every task row names the skill the implementer must apply, so the plan cannot contradict onion-architecture, drizzle, or React rules.

**Tools:** `Read`, `Bash`, `Glob`, `Grep`, `Skill`, `ToolSearch`, `AskUserQuestion`

**Preloaded skills:** `onion-architecture`, `frontend-architecture`, `next-best-practices`, `fastify-best-practices`, `drizzle-orm-patterns`

Skills are injected into the agent's system prompt before the first message, so the plan is constrained by implementation rules from the start.

**Input:** a feature description with clear goal and scope. If scope is missing, asks up to three clarifying questions before reading any files.

**Output artifact — Development Plan:**

```
## Development Plan — <name>
### Context       — affected packages, relevant skills, constraints from LEARNINGS.md
### Tasks         — table: task | package | primary files | skill to apply
### Architecture notes — decisions implementer must not override
### Out of scope  — explicit exclusions
### Implementer checklist — test commands, onion rule reminder, review hand-off note
```

**Rules that govern output:**
- Every task row must name a skill
- Tasks are specific (file + function + what changes), never vague
- Only one approach proposed — committed, briefly justified
- Past failures from LEARNINGS.md surfaced in Architecture notes

**Sources for planner rules:**

| Rule | Source |
|------|--------|
| No Write/Edit — explicit read-only allowlist | [Sub-agents docs — tools field](https://code.claude.com/docs/en/subagents): «if omitted, agent inherits ALL tools» |
| `skills:` preload injects rules before first message | [Sub-agents docs — skills field](https://code.claude.com/docs/en/subagents): «full skill content injected into subagent context at startup» |
| `description:` with trigger phrases drives routing | [Sub-agents docs — description](https://code.claude.com/docs/en/subagents): «anti-pattern: vague or missing trigger phrases» |
| `AskUserQuestion` in allowlist enables clarification | [Tools Reference](https://code.claude.com/docs/en/tools-reference): must be explicitly listed to be available |
| `name:` lowercase-hyphens, no colons | [Sub-agents docs — name field](https://code.claude.com/docs/en/subagents): «file silently skipped if name contains colons» |

---

## implementer

**File:** `implementer.md`

**Responsibility:** Executes a Development Plan produced by the planner. Loads the skill listed per task before writing code, runs tests after each task, and stops at the plan's scope boundary. Does not perform architectural review, security review, or PR review — those are handled by separate agents.

**Tools:** `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, `Skill`, `ToolSearch`, `TodoWrite`

**Preloaded skills:** none — skills are loaded dynamically via `Skill` tool as each task begins

**maxTurns:** 40 — sufficient for 5–8 tasks with tests; prevents runaway loops on test failures

**Input:** a Development Plan (output from planner) passed in the user message. If no plan is present, instructs the user to run planner first.

**Output artifact — Implementation Report:**

```
## Implementation Report — <name>
### Completed tasks  — table: task | files changed | skill applied | test result | status
### Skills applied   — one sentence per skill on how the rule was followed
### Deviations       — any task implemented differently than planned, with reason
### Blocked          — tasks not completed and why
### Test results     — raw output lines (pass/fail counts, failures)
```

**Rules that govern execution:**
- Skill loaded before code is written, not after
- No architectural decisions outside the plan
- No unrelated refactoring or bug fixes
- No `git add / commit / push` — committing is the user's responsibility
- Tests must pass before a task is marked completed; failures are fixed, not skipped

**Sources for implementer rules:**

| Rule | Source |
|------|--------|
| `maxTurns: 40` limits agentic turns | [Sub-agents docs — maxTurns field](https://code.claude.com/docs/en/subagents): «positive integer; limits turns before subagent stops» |
| `TodoWrite` for per-task progress tracking | [Tools Reference](https://code.claude.com/docs/en/tools-reference): dedicated tool for task state inside an agentic session |
| No `AskUserQuestion` — implementer follows the plan | [Sub-agents docs — tools field](https://code.claude.com/docs/en/subagents): tool absent from allowlist = unavailable to agent |
| No `git commit` in agent body | dev-digest `CLAUDE.md`: «only create commits when requested by the user» |
| `description:` states what agent does NOT do | `.claude/skills/` convention in this repo: descriptions explicitly exclude adjacent responsibilities |
| Skills loaded dynamically (not preloaded) | [Sub-agents docs](https://code.claude.com/docs/en/subagents): skills = context injection; load per-task to avoid bloating context with unused rules |

---

## test-writer

**File:** `test-writer.md`

**Responsibility:** Writes tests for `client/` (React Testing Library + vitest/jsdom) and `server/` (Vitest unit + `.it.test.ts` integration). Detects package from file path, loads the correct project skill, writes tests, runs them, and reports raw output. Does not fix application code.

**Tools:** `Read`, `Bash`, `Write`, `Glob`, `Grep`, `Skill`, `ToolSearch`

**Preloaded skills:** none — loaded dynamically per target context

**maxTurns:** 30 · prompt-level circuit breaker at 20 tool calls

**Input:** a file path, component/module name, or task number from a Development Plan.

**Output artifact — Test Report:**
```
## Test Report — <module>
### Tests written  — table: file | tests added | skill applied | run command | status
### Test results   — raw vitest/pnpm test output
### Skipped        — deferred integration tests (.it.test.ts), uncovered edge cases
```

**Sources:**
| Rule | Source |
|------|--------|
| Write + Bash in allowlist for file-writing agent | [Official sub-agents docs](https://code.claude.com/docs/en/subagents) — tools allowlist |
| Bash bypass workaround (prompt-level prohibition) | GitHub issue #31292 — `disallowedTools` does not block `echo >`, `sed -i` via Bash |
| `maxTurns` not reliably enforced → prompt circuit breaker | GitHub issue #41143 — maxTurns enforcement bug |
| Anti-patterns: over-mocking, weak assertions, watch mode | [Vitest AI testing guide](https://main.vitest.dev/guide/learn/writing-tests-with-ai) |

---

## architecture-reviewer

**File:** `architecture-reviewer.md`

**Responsibility:** Read-only architectural review of `server/` (onion-architecture layer boundaries, Drizzle constraints) and `client/` (RSC/client boundary, business logic placement). Returns BLOCKER/MAJOR/NIT findings with mandatory `file:line` evidence. Does not write code, suggest refactors, or perform security review.

**Tools:** `Read`, `Bash`, `Glob`, `Grep`, `ToolSearch`

**Preloaded skills:** `onion-architecture`, `frontend-architecture`

**permissionMode:** `plan` — blocks all writes at engine level

**Input:** file/directory path, module name, or pasted `git diff main...HEAD`. For diffs: reviews only `+` lines.

**Output artifact — Architecture Review:**
```
## Architecture Review — <scope>
### Summary        — PASSED / VIOLATIONS FOUND
### Findings       — table: severity | file:line | rule violated | evidence
### Out-of-scope   — security/performance observations (not findings)
### Confidence     — HIGH/MEDIUM/LOW
```

**Sources:**
| Rule | Source |
|------|--------|
| `permissionMode: plan` enforces read-only at engine level | [Official sub-agents docs — permissionMode](https://code.claude.com/docs/en/subagents) |
| BLOCKER/MAJOR/NIT taxonomy; file:line evidence required | [Tembo.io subagents guide](https://www.tembo.io/blog/claude-code-subagents) |
| Fastify layer invariants; Drizzle-in-repo-only rule | [fastify-boilerplate](https://github.com/marcoturi/fastify-boilerplate) |
| `model: opus` for complex multi-layer analysis | [Official sub-agents docs — model field](https://code.claude.com/docs/en/subagents) |

---

## plan-verifier

**File:** `plan-verifier.md`

**Responsibility:** Compares implemented code against every item in a Development Plan. Returns COMPLIANT/PARTIAL/NON-COMPLIANT per task with `file:line` evidence. Detects out-of-plan scope deviations. Zero general advice — only compliance verdicts.

**Tools:** `Read`, `Bash`, `Glob`, `Grep`

**Preloaded skills:** none — skill loading would introduce review opinions into a compliance check

**permissionMode:** `plan` · **maxTurns:** 10

**Input:** (both required) Development Plan text + `git diff main...HEAD` or branch name. Stops with a clear message if either is missing.

**Output artifact — Plan Compliance Report:**
```
## Plan Compliance Report — <plan name>
### Overall status  — COMPLIANT / PARTIAL / NON-COMPLIANT
### Task results    — table: # | plan task | status | evidence | notes
### Missing items   — checklist of non-compliant/partial tasks
### Scope deviations — files changed but absent from the plan
### Confidence      — HIGH/MEDIUM/LOW
```

**Sources:**
| Rule | Source |
|------|--------|
| Plan + git diff input (not file list) | [arxiv 2604.12147](https://arxiv.org/html/2604.12147v1) — compliance evaluation requires diff as bounded evidence |
| Plan re-injection at end of prompt (anti-drift) | [arxiv 2604.12147](https://arxiv.org/html/2604.12147v1) — «Reminded Plan Setting» reduces context dilution |
| Hard output schema prevents drift into general advice | [Aviator blog](https://www.aviator.co/blog/ai-code-review-best-practices/) — fixed table schema leaves no slot for opinions |
| `model: opus` for simultaneous plan + code reasoning | [Official sub-agents docs — model field](https://code.claude.com/docs/en/subagents) |
| No `Skill` in allowlist — prevents review opinion leakage | Derived from compliance-vs-review distinction |

---

## doc-writer

**File:** `doc-writer.md`

**Responsibility:** Reads source code and produces developer documentation with mandatory Mermaid diagrams for any multi-step flow. Writes to the correct `docs/` subdirectory per package. Works in an isolated worktree — the human reviews the diff before merging. Never writes `CLAUDE.md`, `LEARNINGS.md`, or `specs/`.

**Tools:** `Read`, `Bash`, `Write`, `Glob`, `Grep`, `Skill`, `ToolSearch`

**Preloaded skills:** `mermaid-diagram`

**isolation:** `worktree` · **memory:** `project` · **maxTurns:** 26

**Input:** Development Plan, file/module path, or feature description. Reads source before writing; marks unimplemented features as `[PLANNED — not yet implemented]`.

**Docs directory map:**
- `server/docs/` → endpoints, modules, repositories
- `client/docs/` → pages, components, data-fetch patterns
- `reviewer-core/docs/` → pipeline, grounding gate, scoring
- `e2e/docs/` → flows, hermetic runner
- `docs/` (root) → cross-cutting, architecture ADRs

**Output artifact — Documentation Written:**
```
## Documentation Written — <feature>
### Files created/updated — table: file | section | content summary
### Diagrams included    — table: file | diagram type | what it shows
```

**Sources:**
| Rule | Source |
|------|--------|
| Write to `docs/` only; never to source | [GitHub Blog — 2,500+ repo analysis](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/) |
| `isolation: worktree` sandboxes writes | [Official sub-agents docs — isolation field](https://code.claude.com/docs/en/subagents) |
| `memory: project` accumulates doc conventions | [Official sub-agents docs — memory field](https://code.claude.com/docs/en/subagents) |
| Mermaid as standard for agent-generated diagrams | [Awesome Testing — Mermaid + AI](https://www.awesome-testing.com/2025/09/mermaid-diagrams); GitHub-native rendering |
| System-prompt directory map for section routing | [GitHub Blog](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/) — explicit path assignments reduce destructive writes |

---

## Typical workflow

```
researcher  ──▶  answers "what does X do / what do the docs say about Y"
                 │
planner     ◀───┘  Development Plan (tasks + skills + architecture notes)
    │
    ▼
implementer ──▶  Implementation Report (code written, tests run)
    │
    ├──▶  test-writer          ──▶  Test Report
    ├──▶  architecture-reviewer ──▶  Architecture Review
    ├──▶  plan-verifier        ──▶  Plan Compliance Report
    └──▶  doc-writer           ──▶  docs/ files (worktree diff)
              │
              ▼
    pr-self-review / security-review   (skills, not agents)
```

Agents do not chain automatically — the user passes output from one as input to the next.
