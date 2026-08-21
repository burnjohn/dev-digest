# Agents

Subagents — specialized workers Claude delegates a whole task to, in their own context window.
Canonical location is `.claude/agents/`; shared with the team via version control.

Unlike [skills](../skills/README.md) (knowledge loaded *into* the current context on demand),
an agent is a separate run with its own tool allowlist and its own model. Use one when the work
should be isolated — a research sweep that would otherwise flood the main context, or a task that
must be prevented from writing anything.

This file is a **map of the set**: what each agent is for, what it may touch, and what it consumes
and produces. The rules themselves live in the agent files; do not restate them here.

## Catalog

| Agent | Model | Permissions | Responsibility |
|-------|-------|-------------|----------------|
| [researcher](researcher.md) | `sonnet` | Read-only — no `Write`/`Edit`; `Bash` for reading only | Finds information in the project or on the public internet. Returns a structured report with citations, per-finding confidence, an explicit `NOT FOUND` verdict, and a search log. Interviews first when the request is not researchable as written. |
| [planner](planner.md) | `opus` | Read + `Write` **restricted to `docs/plans/`**; no `Edit` at all; may spawn agents | Turns a request into a Development Plan. Decomposes into tasks with owned paths, governing skills, binding insights, acceptance, red flags and a done-condition command. Writes one file and no code. |
| [implementer](implementer.md) | `sonnet` | Read-write in the **current checkout**, confined to its task's owned paths; no `Agent` (leaf worker) | Executes **one** task from a plan — backend or frontend. Runs N-up in parallel. Never commits, pushes, or reviews. |
| [test-writer](test-writer.md) | `sonnet` | Read-write, but confined to test files — never edits the file under test; `tools` includes `Write`, `Edit`, `Bash`, `Skill`, and two Context7 lookup tools | Writes tests for code that already exists, routed by package across five lanes. Every case names the mutation that would break it, and the report shows a verbatim RED run before the GREEN one. |
| [architecture-reviewer](architecture-reviewer.md) | `opus` | Read-only — `tools` is exactly `Read, Glob, Grep, Bash, Skill`; no `Write`/`Edit` | Judges structure only — ring/import-matrix violations, `Deps` vs `Container`, client placement/promotion breaches, contract drift between server and client. Never correctness, security, or pushability. |
| [plan-verifier](plan-verifier.md) | `opus` | Read-only — `tools` is `Read, Glob, Grep, Bash, Skill`; no `Write`/`Edit` | Walks a finished plan's `REQ` list against the code and returns one of four fixed verdicts per requirement (`VERIFIED` / `PARTIAL` / `NOT IMPLEMENTED` / `CANNOT VERIFY`). Judges completeness only, never quality or architecture. |
| [doc-writer](doc-writer.md) | `sonnet` | Read-write, confined to a closed surface — root/`<pkg>` `docs/**`, `<pkg>/specs/**`, `README.md`; `e2e/specs/*.flow.json` carved out | Documents what already exists, converts a finished plan's Goal + Requirements into a durable spec, or structures supplied material into a doc with diagrams — every behavioural claim cites a `path:line` opened this session. |

## Artifacts

What each agent takes in and hands back. Only the implementer changes the working tree.

| Agent | Input | Output |
|-------|-------|--------|
| `researcher` | A question, plus a mode (this project / the public internet) | A report in the reply. **No files written.** |
| `planner` | A feature request; then, read on its own initiative: module `AGENTS.md` + `INSIGHTS.md`, the placement skills, existing code | **`docs/plans/NN-slug.md`** — the plan file. Reply is a dispatch summary, not the plan. On a gate: no file, an interview instead. |
| `implementer` | **One task block** from `docs/plans/NN-*.md`, plus its own module's `INSIGHTS.md` | Source + test files in the working tree, **uncommitted**. A `DONE`/`BLOCKED`/`PARTIAL` report with skills declared, acceptance ticked, and verbatim typecheck/test output. |
| `test-writer` | A target file/feature that already exists, classified into one of five lanes — client / server-unit / server-integration / engine / e2e-refused | Test file(s) in the working tree, uncommitted. A `DONE`/`BLOCKED` report with a per-case mutation table and verbatim RED-then-GREEN runs. |
| `architecture-reviewer` | A diff, path, or module to review structurally | A `BLOCK`/`CHANGES`/`PASS` verdict report with `file:line`-cited findings. **No files written.** |
| `plan-verifier` | A finished (or partial) `docs/plans/NN-*.md`, plus the code it claims to have produced | A `COMPLETE`/`INCOMPLETE` verdict report, one of four values per `REQ`, with cited evidence. **No files written.** |
| `doc-writer` | A module/mechanism to document, a finished plan to convert to spec, or supplied material to structure | A doc/spec/README file inside its closed write surface, uncommitted. A `DONE`/`BLOCKED`/`PARTIAL` report with a per-claim grounding table and an `### Unverified` section. |

Nothing is committed by an agent. Integration, `pr-self-review`, and any `INSIGHTS.md` append are
the parent session's job.

## The planner → implementer pipeline

```
request → planner → docs/plans/NN-slug.md → parent dispatches wave 1
                                              ├── implementer (T1)  ─┐
                                              └── implementer (T2)  ─┴→ parent: review, commit
```

The hand-off contract — plan format, the mandatory task fields, the ownership invariant,
protected paths (Tier A / Tier B), skills per lane, done-condition commands — lives in
[`docs/plans/README.md`](../../docs/plans/README.md). **That file is canonical**; both agents carry
copies of its tables and both defer to it.

Two properties worth knowing before dispatching:

- **Both halves preload the same twelve skills** (the planner adds `mermaid-diagram`, for the plan's
  architecture diagram). The planner assigns each task's `Skills` line and writes its red flags, and
  it cannot do either well from skill names alone — so it pays the same preload the implementer
  does. Roughly double the context bill, in exchange for the plan's idea of the law being identical
  to the implementer's.
- **There is no worktree isolation.** Parallel implementers share one checkout, so the plan's
  disjoint `Owned paths` lists are the only thing preventing one agent from overwriting another's
  work — and a violation is silent lost work, not a merge conflict.

## Sources

Where the agents' rules come from. Listed so a future editor can tell which rules are external best
practice, which are this repo's law, and which are neither — and can check whether a source has moved
on.

A row is worth only what its attribution is worth. Where a rule has a known origin, the row says so
and names it; where the best available source is an *analogue* — a precedent that fits the shape of
the rule without being what produced it — the row says that too, and carries a confidence marker.
Do not upgrade an analogue to an origin by deleting the hedge.

### External — how a subagent is built

| Source | What it grounds |
|---|---|
| [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — official docs | `description` is the **routing rule**, not a summary, so both descriptions open with trigger conditions and literal user phrasings. `tools` is a closed allowlist and is the real enforcement — hence planner-has-no-`Edit` and implementer-has-no-`Agent`. `skills:` preloads deterministically, where description-matching is probabilistic; that is why skills are preloaded rather than gated on the agent remembering to load them. |
| [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — Anthropic engineering | Under-specified delegation made parallel subagents duplicate work and leave gaps; every task needs *an objective, an output format, tool guidance, and explicit boundaries.* This is the origin of the task block's five mandatory fields and of the fixed output templates. |
| [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) · [authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — official docs | Progressive disclosure and description-writing, which set the cost model that made full preload a deliberate trade rather than an accident. |
| Community write-ups on parallel agents (medium confidence) | Parallel writers on shared files "will often fight" — split by explicit file ownership. Corroborates the ownership invariant; not its only justification. |
| [Mutation testing](https://pitest.org/) (PIT/Stryker; medium confidence) | Grounds `test-writer`'s `Mutation that breaks it` column — every case must name the one-line change to the source that would turn it red — and the mutate-run-revert protocol that produces its RED evidence. A suite is only as strong as the mutants it kills, not the lines it runs over. |
| [Orchestrating AI code review at scale](https://blog.cloudflare.com/ai-code-review/) — Cloudflare engineering (high confidence) | **The actual origin** of `architecture-reviewer`'s mechanical severity table — a fixed three-tier severity mapped to a verdict by rule, not by the model's judgement — and of its "what NOT to flag" section. [ESLint's exit codes](https://eslint.org/docs/latest/use/command-line-interface#exit-codes) are the older precedent for severity deciding pass/fail. |
| [Building a code review tool: the LLM patterns that actually work](https://www.gresearch.com/news/building-a-code-review-tool-the-llm-patterns-that-actually-work/) — G-Research engineering (high confidence) | **The actual origin** of `architecture-reviewer`'s precision pass: split recall and precision into two passes, the second asked to identify which of the first's findings are false positives, and compute severity deterministically rather than letting the model pick it. [Tricorder](https://research.google/pubs/tricorder-building-a-program-analysis-ecosystem/) (Sadowski et al., ICSE 2015) is the deeper ancestor — a low-false-positive bar before a finding is shown at all. |
| [Are Coding Agents Generating Over-Mocked Tests?](https://arxiv.org/html/2602.00409v1) (arXiv preprint; medium confidence — preprint, and it measures mock *frequency*, not correctness) | Grounds `test-writer`'s "mock the outside world, never the subject" rule. Across ~1.2M commits, coding agents added mocks to 36% of test commits against humans' 26%, and reached for plain mocks 95% of the time where humans mixed mocks, fakes and spies. Over-mocking is the measured default failure, not a hypothetical one. |
| ISO/IEC/IEEE 29148 — requirements engineering (high confidence for the taxonomy) | **The actual origin** of `plan-verifier`'s "inspection caps at `PARTIAL`" rule: the standard verifies a requirement by Test, Demonstration, Inspection or Analysis, and that taxonomy is what makes the cap a distinction rather than a preference — reading code is Inspection, and only Test buys `VERIFIED`. Requirements-traceability-matrix practice supplies the closed per-requirement status set; [JUnit 5's `TestExecutionResult`](https://junit.org/junit5/docs/current/api/org.junit.platform.engine/org/junit/platform/engine/TestExecutionResult.html) is the familiar analogue for why a small fixed enum beats a percentage. |
| [Uncovering Systematic Failures of LLMs in Verifying Code Against Natural Language Specifications](https://arxiv.org/abs/2508.12358) (ASE 2025 NIER; medium confidence) | Grounds `plan-verifier`'s **symmetric** guard. The obvious failure is rubber-stamping; the measured one is the opposite — verifiers misclassify correct code as non-conforming, and more elaborate chain-of-thought prompting makes it *worse*. Hence the rule that a cited piece of evidence settles a disagreement, never the model's impression. |
| [Diátaxis](https://diataxis.fr/) (documentation framework; high confidence) | Grounds `doc-writer`'s destination-routing table — routing a document by *what the reader needs* (a map, an explanation, intent-before-code, orientation) rather than by topic is Diátaxis's core distinction, applied here to this repo's own document types. |

### Internal — what the rules say about *this* repo

| Source | What it grounds |
|---|---|
| [root `AGENTS.md`](../../AGENTS.md) | The session protocol (read a module's `INSIGHTS.md` and summarize before writing) — both agents implement it. Also the do-not-touch list feeding Tier A protected paths: lockfiles, `docker compose down -v`, four standalone packages with no root `package.json`. |
| [`onion-architecture`](../skills/onion-architecture/SKILL.md) | The ring model and import matrix. Source of the implementer's backend hard rules (service never imports `drizzle-orm`; `Deps` not `Container`; `process.env` only in `platform/config.ts`) and of the `Ring:` field the planner stamps on backend tasks. |
| [`frontend-ui-architecture`](../skills/frontend-ui-architecture/SKILL.md) | The client placement law — thin pages, colocated `_components/`, promotion thresholds. Source of the frontend hard rules and of the planner's frontend path assignments. |
| Module `AGENTS.md` — [server](../../server/AGENTS.md) · [client](../../client/AGENTS.md) · [reviewer-core](../../reviewer-core/AGENTS.md) · [e2e](../../e2e/AGENTS.md) | Per-lane commands and constraints: schema-first validation, the engine's purity, e2e's deterministic-locators-only rule. |
| [`TESTING.md`](../../TESTING.md) | The done-condition commands and the `*.it.test.ts` hermetic/integration split. |
| Module `INSIGHTS.md` files | The planner reads them all and distributes dated entries into each task's `Binding insights`; the implementer re-reads only its own lane's as a freshness check. A newer entry beats the plan. |
| [`docs/plans/README.md`](../../docs/plans/README.md) | The canonical hand-off contract both agents cite. |
| [`researcher.md`](researcher.md) | The house body convention and the named-gate pattern (`G1`–`G5`) that both agents follow. |

## Adding a new agent

One `.md` file per agent, named after the agent. Frontmatter keys:

| Key | Required | Notes |
|-----|----------|-------|
| `name` | yes | Must match the filename. |
| `description` | yes | **This is the routing rule** — Claude picks an agent by its description, so write it as trigger conditions ("Use when…", with literal user phrasings), not as a summary. |
| `model` | no | `sonnet` \| `opus`. Omit to inherit the session model. |
| `tools` | no | Comma-separated allowlist. **Omitting it grants everything** — always set it explicitly for a read-only agent. The allowlist is the real enforcement; body prose only restates it. |
| `skills` | no | YAML list of skills to preload. Preloaded skills must not set `disable-model-invocation: true`. **A name that does not match a directory under `../skills/` fails silently** — nothing preloads, nothing errors, and you find out when the agent ignores a convention it never received. Check the spelling against the directory, not against memory. Note also that setting `tools` makes it a closed allowlist: omit `Skill` from it and the agent cannot load anything at runtime either. |

Body convention, mirroring the skills: `# Title` → one-paragraph role statement → `## Hard rules`
(absolutes, bolded lead-ins) → `## Method` (numbered steps) → `## Output format` (a literal
template the agent fills).

Two things worth copying from `researcher.md`:

- **Nest output templates in `~~~` fences**, not ``` ```. Templates that contain code blocks break
  a ```-fenced parent.
- **Name your gate conditions** if the agent can refuse or stop early (G1–G4 there). A stop that
  cites which rule fired is debuggable; "I needed more info" is not.

**Agents register at session start.** A newly written or edited agent file is not dispatchable until
the session restarts — `Agent` fails with "not found" and lists only what existed at startup. Budget
for that when authoring: you cannot smoke-test an agent in the session that writes it.

Note what this does *not* mean. Authoring a new agent is ordinary work and can be delegated to an
existing one — only the **dispatch** of the new agent has to wait. And if a new agent turns up in the
available list mid-session, that means the user restarted, not that the registry is watched; the
restart is invisible from inside the session, so it is never evidence about how registration works.

Finish with the static checks that *are* possible in-session, because two of them fail **silently**:
a name in `skills:` that does not match a directory under `../skills/` preloads nothing and reports
nothing, and a `name` that does not match the filename leaves you dispatching something that is not
there.
