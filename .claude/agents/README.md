# Agents

Specialized AI agents for the Intent Layer. Each agent has a focused role and a restricted tool set.

## Setup

All agent definitions live in `.claude/agents/` (single source of truth). Each file is a Claude Code sub-agent invokable via `@agent-name`.

```
.claude/agents/          ← canonical agent definitions
.claude/skills/          ← shared skills loaded by agents via frontmatter
```

Claude Code uses:
- `skills:` frontmatter field to preload skills — the **full SKILL.md content** is injected into the agent's context at startup ([docs](https://code.claude.com/docs/en/sub-agents#preload-skills-into-subagents))
- `tools:` frontmatter field to restrict available tools per agent
- `model:` frontmatter field to pin a specific model (or `inherit` to use the session model)

**Skill-loading policy:** preload via `skills:` only what EVERY invocation needs; scope-dependent skills are physically `Read` by the agent once it knows its scope. Never both for the same skill — preloading and re-reading pays for the content twice.

## Catalog

| Agent | Model | Scope | Writes? | Description |
|---|---|---|---|---|
| spec-creator | sonnet | Full-stack | Yes | Produces EARS-based feature specs (the WHAT) in `docs/feature-requirements/` via 6-category questioning and design-gap analysis; writes are confined to that folder |
| researcher | sonnet | Full-stack | No | Read-only scout — finds code patterns or web information, returns a structured report |
| implementation-planner | sonnet | Full-stack | Yes | Plans from an existing spec, or captures requirements standalone via targeted questions; reviews them for gaps and conflicts, proposes improvements, asks multi-agent vs. single-agent execution, writes the Development Plan to `docs/plans/` (its only write surface) |
| implementer | sonnet | Full-stack | Yes | Executes exactly one task from a Development Plan: detects domain, loads skills physically, implements, type-checks, self-reviews, runs hermetic tests |
| test-writer | sonnet | Full-stack | Yes | Writes unit and integration tests for client/ (RTL/Vitest) or server/ (Fastify inject()/Vitest); detects domain from file path |
| architecture-reviewer | sonnet | Full-stack | No | Read-only architectural audit — layer violations, import direction, side-effect contamination, project invariants |
| plan-verifier | sonnet | Full-stack | No | Read-only completeness check — verifies every requirement in a Development Plan has a corresponding implementation |
| doc-writer | sonnet | Full-stack | Yes | Generates and updates documentation — module READMEs, design docs, API references, Mermaid architecture diagrams |

## Pipeline: how the agents work together

> **Spec and plan are created manually** (invoke spec-creator, then implementation-planner — see the scenario table below). **Everything after the plan is runnable in one shot via `/implement docs/plans/<plan>.md`** ([.claude/skills/implement/SKILL.md](../skills/implement/SKILL.md)) — implementer waves, verifier pass 1, architecture review with fix iterations (capped at 2), test coverage, `/code-review`, final verification, closeout. The skill is the executable source of truth for the execution ordering; the diagram below is the map.

```
spec-creator ──→ implementation-planner ──→ implementer (×N, wave by wave)
  (specify)          (plan)                      (build)
      ·                 ·                           ↓
      └── researcher ───┘              plan-verifier — PASS 1 (Steps + AC only)
        (spawned for fact-finding)                  ↓
                                       fix loop: ❌/⚠️ → implementer → re-verify
                                                    ↓
                                   ┌────────────────┴───────────────┐
                            architecture-reviewer            test-writer
                              (layers, invariants)        (coverage per Testing Plan)
                                   └────────────────┬───────────────┘
                                                    ↓
                                    /code-review  ← bug hunt (NOT architecture-reviewer's job)
                                                    ↓
                                    plan-verifier — FINAL PASS (incl. Testing Plan) = sign-off
                                                    ↓
                              doc-writer → spec status `implemented` → engineering-insights
```

1. **spec-creator** — capture the WHAT as an EARS spec before any plan or code exists
2. **implementation-planner** — verify the spec's requirements, design the work, surface all constraints, produce an atomic task list (both it and spec-creator delegate fact-finding to **researcher**)
3. **implementer** — execute one task per instance; spawn waves of parallel instances per the plan's parallelization map; after the last wave the orchestrating session runs one full typecheck + hermetic suite
4. **plan-verifier, pass 1** — completeness gate right after implementation, BEFORE review and tests: no point reviewing or testing incomplete work. Gaps go back to an implementer; re-verify after fixes
5. **architecture-reviewer + test-writer** — run in parallel (reviewer is read-only, test-writer writes only test files); Critical/High findings go back to an implementer
6. **/code-review** — correctness bugs; no agent in this catalog hunts bugs (architecture-reviewer explicitly excludes them). For endpoint-touching features also consider `/security-review`
7. **plan-verifier, final pass** — full verification including the Testing Plan; the ✅ report is the completion artifact
8. **doc-writer** — permanent documentation; then spec-creator flips the spec to `implemented`; engineering-insights (Mode B) wraps up

Fix loops (steps 4–6) are capped at 2 iterations — after that, escalate to a human instead of burning tokens on circles.

## Usage scenarios

### How to invoke: three forms

| Form | How it looks | What happens |
|---|---|---|
| **Agent + prompt** (one step) | A plain chat message naming the agent: `Use spec-creator: <idea>` — attach screenshots in the same message if there is a design | The main session spawns the agent and passes it your prompt (visuals are digested into text for it — subagents never see attachments). When the agent asks questions, **just answer in the chat** — the session relays your answer to the same instance; do not repeat the original prompt. |
| **Slash command + argument + extra prompt** | `/implement docs/plans/<plan>.md <free text>` | Everything after the plan path is passed to the orchestrator as run-specific instructions — e.g. `/implement docs/plans/x.md run integration tests too, Docker is up; skip doc-writer`. Without extra text it runs the default pipeline. |
| **Chained steps in one message** | "Plan it (standalone mode), and once I confirm the plan — run /implement on it." | The session runs the steps in order, stopping at each gate (spec confirmation, plan confirmation, escalations) for your input. Chaining does not skip gates — it only saves you retyping. |

### Same chat or a new one?

- **Spec (A.1) → plan (A.2): one chat is fine, back to back.** The planner reads the spec *file*, not the spec conversation, so nothing is lost — but keeping them together saves you re-explaining context when the planner routes a ⚠️ back to spec-creator.
- **`/implement`: start a NEW chat.** It needs only the plan file; a fresh context is cheaper (no spec/planning history re-read on every turn) and enforces the contract: anything that lives only in the old chat and not in the plan is invisible to implementers — which is exactly how you catch an incomplete plan.
- **One-off steps (A.3–A.7, B1): anywhere.** Each spawns a fresh agent that reads what it needs from disk; no prior chat context required.

### Scenario table

| # | Scenario | When to use | How to run | Example prompt |
|---|---|---|---|---|
| **A** | New feature — full conveyor | The idea is not yet written down as requirements; the feature spans modules or introduces a new contract/behavior | spec-creator → implementation-planner → `/implement <plan>` (→ doc-writer in its closeout) | "I want to export findings to CSV — from a UI button on PR detail to a ready file. Start with the spec." |
| A.1 | …spec step alone | A raw idea / design screenshot needs to become testable ACs | spec-creator (delegates researcher itself when needed) | "Use spec-creator: a spec for CSV export of findings — button on the Overview tab, format `severity,file,line,summary`. Here is the mock screenshot." |
| A.2 | …planning step alone | A spec exists (`draft`/`approved`) and is ready to become a plan | implementation-planner (spec mode) | "There is a spec at docs/feature-requirements/2026-07-05-csv-export.md — create the implementation plan." |
| A.3 | …one implementation task alone | The plan is ready; execute one specific task | implementer (one instance per task; spawn several in parallel for independent tasks) | "Execute Step 3 from docs/plans/2026-07-05-csv-export.md — the GET /pulls/:id/export.csv route." |
| A.4 | …tests alone | Code exists, tests are missing or thin | test-writer | "Write tests for server/src/modules/pulls/export.ts — cover the empty-findings edge case." |
| A.5 | …completeness check alone | All plan tasks are marked done; verify before closing | plan-verifier | "Verify that everything in docs/plans/2026-07-05-csv-export.md is actually implemented before we close the task." |
| A.6 | …architecture audit alone | After a major feature or before a release | architecture-reviewer | "Run an architecture audit of server/src/modules/pulls/ after the CSV-export merge — check the onion boundaries." |
| A.7 | …documentation alone | The feature is stable and needs permanent docs | doc-writer | "The CSV-export feature is merged — generate the API reference and update server/README.md." |
| **B1** | Small fix | One file/layer, behavior obvious from the code, the WHAT does not change | implementer directly (no spec, no plan) | "formatCost shows -$0.00 instead of $0.00 when usd = -0 — fix it." |
| **B2** | Module-scoped change, clear requirements | Behavior change without a new contract, confined to one module | implementation-planner (standalone mode) → `/implement <plan>` | "review-all's concurrency cap should be configurable via env instead of hardcoded 3 — plan it, then run /implement." |
| **B3** | Change to documented behavior | A spec in docs/feature-requirements/ exists and the change contradicts or extends it | spec-creator (draft revision, or a superseding spec if `approved`) → implementation-planner (spec mode) → `/implement <plan>` | "Spec 2026-06-20-cost-badge.md says cost = sum of all runs. Product wants only the latest batch. Update the spec, then plan and implement." |
| **B4** | Change that crosses layer boundaries | Moving logic between modules, changing architectural boundaries | B2 or B3 route (by requirement size) — `/implement` already runs architecture-reviewer with mandatory fix iterations after the code lands | "I'm moving cost aggregation out of pulls/routes.ts into a separate cost module — plan it and run /implement; the architecture check happens inside." |

Rules of thumb: **no plan → no `/implement`** (it refuses and points you to the planner); **the WHAT changed → spec first** (B3), never a silent reinterpretation; **B1 is the only route that skips planning** — if the fix grows beyond one file/layer mid-flight, stop and switch to B2.

### Combined-prompt cookbook

Copy-paste shapes for the common combinations — `<...>` is yours to fill:

| Goal | One message that does it |
|---|---|
| Spec from an idea + design (A.1) | `Use spec-creator: <feature idea>. Design screenshots attached — the states I care about: <list>.` |
| Plan right after the spec, same chat (A.2) | `Now use implementation-planner on the spec you just wrote. My preference: multi-agent if ≥3 independent steps.` |
| Plan from an existing spec, fresh chat (A.2) | `Use implementation-planner with docs/feature-requirements/<spec>.md.` |
| Execute with run-specific tweaks | `/implement docs/plans/<plan>.md Docker is running — include integration tests in Phase 2; Medium findings: fix them all without asking.` |
| B2 in one message | `Use implementation-planner in standalone mode: <requirements, expected behavior, what's out of scope>. After I confirm the plan, run /implement on it.` |
| B3 in one message | `Use spec-creator to revise docs/feature-requirements/<spec>.md: <what changed and why>. Then implementation-planner on the updated spec, then /implement — pausing at each confirmation.` |
| Resume a failed run | `/implement docs/plans/<plan>.md resume from Phase <N> — Phases 1–<N-1> are done, here is what failed: <paste the escalation>.` |

Anti-patterns to avoid: `/implement "<requirements text>"` (it does not plan — that text belongs to the planner); asking one implementer for several plan steps at once (one instance = one task); pasting a spec's contents into the prompt instead of its path (agents read files themselves — paths are cheaper and never stale).

---

## spec-creator

The requirements agent — the entry point of the pipeline. Use **before** planning — when a feature idea needs to become a testable specification. It will:

- Read AGENTS.md files, module `insights.md` (Mode C), existing specs, and referenced design docs autonomously (Phase 1)
- Ask structured questions across 6 categories, one at a time: Problem & Users · Scope & Boundaries · Behavior & States · Data & Provenance · Security & Untrusted Inputs · UX & Design Gaps
- Analyze design digests for uncovered corner cases, missing empty/loading/error states, cross-module ambiguities, and propose UX improvements
- Capture workflow / module-communication Mermaid diagrams and interface-level contracts when they clarify the WHAT — never code, schemas, or file paths
- Confirm understanding before writing; unresolved items go to `[NEEDS CLARIFICATION]`, never silent assumptions
- Delegate fact-finding to read-only `researcher` instances (several in parallel for independent questions) instead of guessing or asking the user for lookups
- Ask blocking questions first (via AskUserQuestion where supported; plain text otherwise); minor unknowns are parked, not stalled on
- Run a mechanical Quality Gate before writing: EARS-shaped ACs, edge-case→AC traceability, provenance tags, measurable non-functional criteria with verification hints, no code or file paths
- Write the spec to `docs/feature-requirements/YYYY-MM-DD-<feature-slug>.md` with header `Spec ID: SPEC-YYYY-MM-DD-<feature-slug>` (EARS acceptance criteria with stable `AC-n` IDs, provenance-tagged inputs, untrusted-input handling); all output — files and dialog — is English
- Manage the spec lifecycle via Edit: `draft → approved → implemented`, plus `superseded` on replaced specs; drafts are revisable in place (AC IDs append-only), approved specs are content-frozen

**Write boundary:** file writes are confined to `docs/feature-requirements/` — enforced by instruction (same pattern as doc-writer's location map and engineering-insights' Write/Edit split). Package `specs/` folders, code, and plans are off-limits.

**Skill routing:** `security` is preloaded (drives the Security & Untrusted Inputs category); read on demand by scope: `backend-onion-architecture` (server/full-stack — module boundaries for Scope questions and diagram participants), `frontend-architecture` (client/full-stack — UI-state conventions for the Design Gaps category), `mermaid-diagram` (workflow/sequence diagrams). Mode C of `engineering-insights` is applied via its own Phase 1 instructions. Architecture skills are boundary-awareness only — no implementation patterns leak into specs.

Use when:
- A new feature is being discussed and no spec exists yet
- Requirements live only in a conversation or a design digest and need to become testable EARS criteria
- An existing spec's decision is being replaced (new spec + `Supersedes` link)

**Based on:**
- [EARS — Easy Approach to Requirements Syntax](https://alistairmavin.com/ears/) (Alistair Mavin, Rolls-Royce, 2009)
- [GitHub Spec Kit — Spec-Driven Development](https://github.com/github/spec-kit) — spec → plan → implement pipeline; `[NEEDS CLARIFICATION]` marker convention
- [Claude Code sub-agents documentation](https://code.claude.com/docs/en/sub-agents)
- implementation-planner.md's phased ritual (context → review → confirm → output), inherited so both agents behave as one system

---

## researcher

The primary information-gathering agent. Use **before** planning or implementing — when you need to understand what already exists or gather external context. It will:

- Ask clarifying questions if the request is vague (interview mode)
- Search the codebase with `Glob`, `Grep`, `Read`, `Bash`
- Search the web with `WebSearch` + `WebFetch`
- Return a structured report (Format A for codebase, Format B for web)
- Explicitly flag what was searched but not found

**Skill routing:** no domain-specific skills — it reads raw code and web pages. Read-only by design: omitting `Edit`/`Write` from `tools:` prevents it from acting on what it finds.

Use when:
- You need to understand how a module is implemented before touching it
- You want to find all usages of a symbol, pattern, or convention
- You need external documentation (library version, API shape, best practice)
- The spec-creator or implementation-planner needs a codebase snapshot or fact-check during its run (spawned via their Agent tool)

**Based on:**
- [Claude Code sub-agents documentation](https://code.claude.com/docs/en/sub-agents)
- [PubNub — Best practices for Claude Code sub-agents](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- Structured reporting pattern: citation-first output ("a finding without a citation is an opinion") borrowed from scientific peer-review norms and adapted for codebase analysis

---

## implementation-planner

The development planning agent — the HOW to spec-creator's WHAT. Works in two modes: **spec mode** (a spec in `docs/feature-requirements/` or inline requirements is the single source of truth) and **standalone mode** (no spec — it captures just enough requirements through targeted questions, recorded as `R-n` items in the plan). It never writes or amends spec files. It will:

- Locate and read the requirements (spec file or inline); if none exist, switch to standalone mode and capture the WHAT in one grouped round of questions (recommending spec-creator for large or cross-module features)
- Read AGENTS.md files for all affected modules
- Read each affected module's `insights.md` to surface non-obvious constraints (Mode C of engineering-insights)
- Load relevant skills based on scope (server / client / DB / reviewer-core)
- Review every requirement for clarity, completeness, consistency, feasibility against project constraints, and testability (✅/⚠️/❌ table)
- Ask clarifying questions **only** for ambiguous or conflicting requirements — no scripted questionnaire
- Propose improvements (better/simpler/safer approaches) as explicit proposals the user accepts or rejects
- Ask whether execution should be **multi-agent** (parallel implementers, strictly disjoint owned paths, parallelization map) or **single-agent** (one sequential pass) — with a recommendation, but the user decides
- Confirm understanding before writing the plan
- Write the Development Plan to `docs/plans/YYYY-MM-DD-<feature-slug>.md` with 8 sections: Context, Architecture Fit, Skills Applied, Constraints, Steps, Acceptance Criteria, Testing Plan, Out of Scope

**Write boundary:** file writes are confined to `docs/plans/`, and only after Phase 3 confirmation — code, specs (`docs/feature-requirements/`), package `specs/`, AGENTS.md, and insights.md are off-limits (same pattern as spec-creator's `docs/feature-requirements/` boundary).

**Skill routing:** `backend-onion-architecture`, `typescript-expert`, `security` are preloaded (needed on every run); the rest is read on demand by scope — Fastify/Zod for server work, Drizzle/Postgres for DB changes, React/Next.js/frontend-architecture for client work, mermaid for diagrams. `react-testing-library` is deliberately never loaded — RTL mechanics belong to test-writer and the implementer. Broad codebase sweeps are delegated to `researcher` via the Agent tool instead of pulling raw files into the planner's context.

Use when:
- A spec (or agreed inline requirements) exists and needs to become an executable plan
- No spec exists but you need a plan now — standalone mode captures the requirements as part of planning
- Making a significant change that touches multiple files or layers
- You need the plan to be precise enough for an implementer agent with no prior context
- You want to surface all project constraints before any code is written

**Based on:**
- [Claude Code sub-agents documentation](https://code.claude.com/docs/en/sub-agents)
- [PubNub — Best practices for Claude Code sub-agents](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- [dev.to — Clean Architecture in the age of AI: preventing architectural liquefaction](https://dev.to/uxter/clean-architecture-in-the-age-of-ai-preventing-architectural-liquefaction)
- [dev.to — Enforce Clean Architecture in TypeScript with fresh tools](https://dev.to/remojansen/enforce-clean-architecture-in-your-typescript-projects-with-fresh)
- ADR (Architecture Decision Records) methodology — each plan step is atomic, independently compilable, and produces a single commit; plan is the human-readable decision record

---

## implementer

The code execution agent. Use **after** a Development Plan exists and you have a specific task to assign. Each instance handles **exactly one task** — spawn N instances in parallel for N independent plan tasks. It will:

- Read the target module's `insights.md` (Mode C) before the first file edit
- Identify the assigned task by number/name in the plan
- Detect domain (server / client / both) from the task's file paths
- Read the relevant skill SKILL.md files physically before writing any code
- Read existing `*.test.ts` and `specs/` files to understand expected behavior
- Implement the task, running `pnpm typecheck` after implementation
- Self-review against the loaded skill rules (re-reads rule sections, not from memory)
- Run hermetic tests (`*.test.ts`) before reporting done
- Report `Skills applied:` — which skill files were physically read
- Capture discoveries via engineering-insights (Mode B) at session end

**Skill routing:** `typescript-expert` + `security` are preloaded in every instance; domain skills are read physically by scope:

| Scope | Skills loaded physically |
|---|---|
| `server/` | `backend-onion-architecture`, `fastify-best-practices`, `zod` |
| `server/` + DB | add `drizzle-orm-patterns`, `postgresql-table-design` |
| `client/` | `react-best-practices`, `next-best-practices`, `frontend-architecture` |
| `client/` + tests | add `react-testing-library` |
| Full-stack | all of the above |

Use when:
- A Development Plan is ready and you have a specific task to execute
- You want to parallelize independent tasks across multiple implementer instances
- You need type-safe, convention-compliant code delivery with built-in verification
- You want the implementation verified against the project's skill rules automatically

**Based on:**
- [Claude Code sub-agents documentation](https://code.claude.com/docs/en/sub-agents)
- [PubNub — Best practices for Claude Code sub-agents](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- [arxiv 2602.00409 — Tautological unit tests: when AI-generated tests pass but miss the bug](https://arxiv.org/html/2602.00409v1)
- [dev.to — When AI-generated tests pass but miss the bug (postmortem)](https://dev.to/jamesdev4123/when-ai-generated-tests-pass-but-miss-the-bug-a-postmortem-on-tautological-unit-tests-2ajp)
- [Callsphere — Mocking LLM calls: deterministic tests for AI agents](https://callsphere.ai/blog/unit-testing-ai-agents-mocking-llm-calls-deterministic-tests)
- [Mergify — Flaky tests in Vitest](https://mergify.com/flaky-tests/vitest/)
- Self-review pattern: "re-read the rules section physically, not from memory" — anti-hallucination discipline borrowed from citation-first research methodology

---

---

## test-writer

Writes behavior-focused unit and integration tests. Detects whether the target file is frontend (`client/`) or backend (`server/`) and applies the matching strategy. Extends existing test files rather than overwriting them.

**Skill routing:**

| Domain | Skills loaded |
|---|---|
| `client/` (frontend) | `react-testing-library`, `react-best-practices` |
| `server/` (backend) | `server-testing`, `fastify-best-practices` (+ `drizzle-orm-patterns` only when mocking DB queries) |

Nothing is preloaded — the domain is only known after path detection, so skills are read physically per this table.

Use when:
- A new module or component has no test file
- You want to extend existing tests with missing scenarios
- An implementer completes a task and tests are the next step

---

## architecture-reviewer

Read-only architectural auditor. Checks import direction, layer boundary violations, side-effect contamination in pure layers, and project-wide invariants defined in AGENTS.md — server-side (SecretsProvider, shared types, reviewer-core purity) and client-side (`apiFetch`-only API calls, no `useEffect` data fetching, no Radix/Shadcn imports). Never edits files. **It does not hunt bugs** — correctness review is `/code-review`'s job.

**What it reports:** Critical / High / Medium / Low findings with file:line citations and remediation hints.

**Skill routing:** Reads `backend-onion-architecture` for server/ targets, `frontend-architecture` for client/ targets (nothing preloaded — the target is only known at invocation). No write tools are available — findings are reported only.

Use when:
- After a major feature is merged and you want an architectural health check
- Before a release to catch any layer violations introduced during fast iteration
- Onboarding new contributors — run it against a new module to verify it follows conventions

---

## plan-verifier

Read-only completeness auditor. Given a Development Plan, it searches the codebase for evidence that each requirement in Implementation Steps, Acceptance Criteria, and Testing Plan has been implemented. Reports ✅ Done / ⚠️ Partial / ❌ Missing per requirement.

**Skill routing:** the `plan-verifier` methodology skill is preloaded; domain skills (`backend-onion-architecture` / `react-best-practices`) are read on demand by plan scope. Read-only by design: omitting `Edit`/`Write` from `tools:` prevents it from modifying files during verification.

**Two-pass usage:** pass 1 right after implementers finish (Steps + AC only, Testing Plan reported as pending) — the cheap gate before review and test-writing; final pass at the end (everything incl. Testing Plan) — the sign-off artifact.

Use when:
- Implementers have just finished — pass 1 catches missing pieces before reviewer/test-writer spend effort on incomplete work
- After test-writer and review fixes — final pass confirms completeness before closing the issue
- A PR review needs a structured checklist against the plan

---

## doc-writer

Generates and maintains technical documentation. Detects the input type (plan, source code, routes, conversation) and writes to the correct location per the project's doc conventions. Includes Mermaid diagrams for architecture and API flows. Verifies all referenced code entities exist before writing.

**Skill routing:** No domain-specific skills loaded by default — it reads source files and plan documents directly. When the doc involves architecture decisions, the `backend-onion-architecture` or `frontend-architecture` skill may be consulted to ensure descriptions are accurate.

**Doc types produced:**
- `docs/design/` — architecture and design docs (from implementation plans or code)
- `<package>/README.md` — module overviews (from source code)
- `docs/design/api-<module>.md` — API references (from route definitions)

Feature specs (`docs/feature-requirements/`) are **not** produced here — that folder is spec-creator's exclusive write surface.

Use when:
- A feature is complete and needs permanent documentation
- You want to convert an implementation plan into a design doc for future reference
- A module's README is missing or stale

---

## Validation after editing

Run these checks after modifying this file to confirm all required agents are present:

```bash
grep -c "## " .claude/agents/README.md
grep -q "spec-creator" .claude/agents/README.md || echo "MISSING spec-creator"
grep -q "test-writer" .claude/agents/README.md || echo "MISSING test-writer"
grep -q "architecture-reviewer" .claude/agents/README.md || echo "MISSING architecture-reviewer"
grep -q "plan-verifier" .claude/agents/README.md || echo "MISSING plan-verifier"
grep -q "doc-writer" .claude/agents/README.md || echo "MISSING doc-writer"
grep -q "skill routing" .claude/agents/README.md || echo "MISSING skill routing"
```

---

## Adding a new agent

1. Create `.claude/agents/<name>.md` with frontmatter in this order: `name`, `description`, `model`, `tools`, `skills:` (with inline `#` comments).
2. `name` must equal the filename stem exactly.
3. `description` is the trigger rule — write it as "Use when…" or "Read-only agent that…".
4. Omitting `Edit`/`Write` from `tools:` is what makes an agent read-only — do this deliberately.
5. Every skill in `skills:` must exist as a directory under `.claude/skills/`.
6. Add a row to the Catalog table above and a `## <name>` section with "What it does", "Skill routing", "Use when", and "Based on:" subsections.
7. Verify: `grep -qE "^name: <name>$" .claude/agents/<name>.md || echo "NAME MISMATCH"`
