# Agents map

Custom Claude Code subagents for this repo, under `.claude/agents/`. This
file is a map — read the agent's own `.md` for its full prompt; don't
duplicate that here.

> New/renamed agent files require a fresh Claude Code session to appear as
> an available `subagent_type` — the registry is loaded at session start.

## Pipeline

```
researcher  →  (findings, ad hoc)

planner  →  Development Plan  →  implementer  →  Implementation Report
                                                          │
                        ┌─────────────────┬───────────────┼───────────────┐
                        ▼                 ▼               ▼               ▼
                 architecture-      plan-verifier     test-writer     security review
                 reviewer           (plan/spec           (adds/backfills   (still separate
                 (boundaries,       compliance,          tests, given      tools — not
                 read-only)         gap report)          Plan+Report)      part of this set)
                        └─────────────────┴───────────────┘
                                          │
                                          ▼
                                    doc-writer
                          (docs/specs/README.md, once
                           the change is verified)
```

`planner` and `implementer` share one contract: the Development Plan is the
only interface between them — no shared live context, no assumed memory of
how the plan was produced. `architecture-reviewer`, `plan-verifier`, and
`test-writer` each consume the Implementation Report independently and can
run in any order (or be skipped); `doc-writer` is meant to run once the
change is verified, but can also document already-shipped functionality
standalone. `researcher` is a standalone utility, not part of that pipeline.

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

### `test-writer`

| | |
|---|---|
| Responsibility | Write tests for UI and backend code, using the appropriate project skill per package. Does not review test or code quality — only writes and runs tests. |
| Permissions (`tools`) | `Read, Grep, Glob, Write, Edit, Bash, Skill, AskUserQuestion` |
| Model | `sonnet` — execution role applying already-decided scope |
| Input | **Both** a Development Plan and an Implementation Report (hard requirement, not a preference) — or, in TDD-first mode, a Development Plan alone. Asks for whichever is missing rather than inventing scope from a diff. |
| Output | A **Test Report**: Reference material (+ mode) / Tests written / Skills applied / Tests run / Self-verification / Out of scope / Deviations from plan. |

Full definition: [test-writer.md](test-writer.md)

### `architecture-reviewer`

| | |
|---|---|
| Responsibility | Check architectural boundaries (`onion-architecture` for server/reviewer-core, `frontend-ui-architecture` for client) against a given change and return findings with evidence. Advisory only — not wired to any merge gate. |
| Permissions (`tools`) | `Read, Grep, Glob, Bash, AskUserQuestion` — no `Write`/`Edit`/`Skill` (reads the boundary skills as criteria, never invokes them) |
| Model | `opus` — architectural judgment treated as a gating decision, matching Anthropic's own `security-reviewer` example |
| Input | A changed-file scope — normally an Implementation Report's "Changes made" list, or an explicit diff/path set. Asks which boundary skill applies (server/client/both) if scope is ambiguous. |
| Output | A **Findings Report**: Findings (`CRITICAL`/`WARNING`/`SUGGESTION`) / Evidence / Boundary criteria consulted / Verdict (advisory) / Explicitly not checked here / Could not verify. |

Full definition: [architecture-reviewer.md](architecture-reviewer.md)

**Rules sourced from:**

| Rule | Source |
|---|---|
| Onion-architecture layer/import rules, including the documented shrinking exception list | [.claude/skills/onion-architecture/SKILL.md](../skills/onion-architecture/SKILL.md); enforcement history in [server/INSIGHTS.md](../../server/INSIGHTS.md) (2026-08-14, ESLint `no-restricted-imports`) |
| Frontend structure checklist and `[DOC]`/`[CONV]`/`[SPLIT]` evidence tags | [.claude/skills/frontend-ui-architecture/SKILL.md](../skills/frontend-ui-architecture/SKILL.md) |
| Reuse this repo's one severity scale, don't invent a parallel one | [.claude/skills/pr-self-review/SKILL.md](../skills/pr-self-review/SKILL.md) |
| Findings + evidence discipline (exact `file:line`, no padding, empty list is a valid answer) | The five reviewer prompts in [docs/agent-prompts/](../../docs/agent-prompts/) (e.g. `test-quality-reviewer.md`) |
| No architecture/security agent existed yet — this fills a gap this file itself had already named | [.claude/agents/README.md](README.md) (previous "Out of scope for this set") |
| Read-only reviewer allow-list + `opus` for a gating role | [Anthropic: Best practices — Create custom subagents](https://code.claude.com/docs/en/best-practices#create-custom-subagents) (the official `security-reviewer` example: `tools: Read, Grep, Glob, Bash`, `model: opus`) |

### `plan-verifier`

| | |
|---|---|
| Responsibility | Check finished code against every point of a Development Plan (and a spec's Acceptance criteria, when one exists). Reports gaps and scope creep with evidence — explicitly does not substitute this for generic or style advice. |
| Permissions (`tools`) | `Read, Grep, Glob, Bash, AskUserQuestion` — no `Write`/`Edit`/`Skill` |
| Model | `opus` — the adversarial-review/gating role Anthropic's own docs describe for exactly this check |
| Input | The Development Plan, the Implementation Report, **and** the diff (or explicit file scope) — all required. Never infers a plan from the diff alone. |
| Output | A **Compliance Report**: Reference material / Compliance matrix (Met / Partially met / Not met) / Gaps / Scope creep / Verdict / Explicitly not checked here / Follow-ups for doc-writer / Could not verify. |

Full definition: [plan-verifier.md](plan-verifier.md)

**Rules sourced from:**

| Rule | Source |
|---|---|
| Plan/requirement compliance is explicitly *not* covered by the existing self-review gate — this agent fills that named gap, not a duplicate | [.claude/skills/pr-self-review/SKILL.md](../skills/pr-self-review/SKILL.md) ("Whether the change is the right change... this skill does not substitute for it") |
| Review the diff against the plan; name the work, the plan, and what counts as a finding | [Anthropic: Best practices — Add an adversarial review step](https://code.claude.com/docs/en/best-practices#add-an-adversarial-review-step) |
| Flag only gaps that affect correctness or the stated requirements, treat the rest as optional | Same source (verbatim quote, verified against the live page) |
| Spec `Acceptance criteria` / `Status: shipped` convention | [specs/README.md](../../specs/README.md) |
| Blackbox verification needs minimal context transfer — it checks the artifact against criteria, not the reasoning behind it | [Anthropic: When and how to use multi-agent systems](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them) |

### `doc-writer`

| | |
|---|---|
| Responsibility | Describe an implemented feature and turn a Development Plan (or other material) into documentation with diagrams, writing into the correct `docs/`/`specs/`/`README.md` section per package. |
| Permissions (`tools`) | `Read, Grep, Glob, Write, Edit, Bash, Skill, AskUserQuestion` |
| Model | `sonnet` — writing/synthesis of already-settled facts, not a gating judgment call |
| Input | A Development Plan + Implementation Report (a `plan-verifier` report is welcome when available, but not required), or an explicit pointer to an existing feature when invoked standalone. |
| Output | A **Docs Report**: Source material / Docs written or updated / Diagrams added / Spec status changes / Skills applied / Self-verification / Out of scope / Open questions. |

Full definition: [doc-writer.md](doc-writer.md)

## Out of scope for this set

Security review is intentionally not covered by any agent here — use the
existing `security-review` skill, or a future dedicated agent. Architecture
review and plan/requirement compliance, previously named as gaps in this
section, are now covered by `architecture-reviewer` and `plan-verifier`
respectively. None of the four newest agents is wired to an automated merge
gate (unlike `pr-self-review`'s `scripts/pr-gate.sh` hook) — they are
advisory, and wiring one to a hook would be a separate, deliberate follow-up
task.
