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
| [spec-creator](spec-creator.md) | `opus` | Read-write, confined **by rule** to `<pkg>/specs/**` for `server`, `client`, `reviewer-core`, `mcp` — nothing mechanical: `tools` cannot scope a path, and `Bash` is present, so both the folder bound and its read-only use are prose. `Edit` is further narrowed **by rule** to files carrying a `Spec ID:` line. `WebFetch` is its only network reach | Writes the prescriptive spec that precedes a plan: problem, goals/non-goals, user stories, EARS acceptance criteria, edge cases, module interactions, untrusted inputs, and a three-way design partition. Interviews on blockers before writing anything, and keeps its own improvement ideas out of the file until the owner accepts them. |
| [implementation-planner](implementation-planner.md) | `opus` | Read + `Write` (confined to `docs/plans/` **by rule**); no `Edit` at all — mechanical, but note `Bash` reopens the same capability, so it is bounded by rule in the file; `Agent` unscoped, so "delegates only to `researcher`/`Explore`" is also **by rule** | Turns a validated set of requirements into an Implementation Plan. Validates rather than authors the requirements, returns recommendations, and asks whether to run multi-agent or single-agent before writing. Decomposes into tasks with owned paths, governing skills, binding insights, acceptance, red flags and a done-condition command. Writes one file and no code, and never a specification — a prescriptive one is `spec-creator`'s, a descriptive one `doc-writer`'s. |
| [implementer](implementer.md) | `sonnet` | Read-write in the **current checkout**, confined to its task's owned paths **by rule** (`tools` cannot scope a path); no `Agent` — that one *is* allowlist-enforced, and it is what keeps the graph a tree | Executes **one** task block — backend or frontend — taken either from a plan file or written inline in the dispatch prompt. Runs N-up in parallel. Never commits, pushes, or reviews. |
| [test-writer](test-writer.md) | `sonnet` | Read-write, confined to test files **by rule**; `tools` includes `Write`, `Edit`, `Bash`, `Skill` and two Context7 tools, none of them path-scoped. Temporarily mutates the file under test to prove RED, always reverting | Writes tests for code that already exists, routed by package across five lanes. Every case names the mutation that would break it, and the report shows a verbatim RED run before the GREEN one. |
| [architecture-reviewer](architecture-reviewer.md) | `opus` | Read-only — no `Write`/`Edit` in `tools`, which is mechanical; `Bash` is present and read-only **by rule** | Judges structure only — ring/import-matrix violations, `Deps` vs `Container`, client placement/promotion breaches, contract drift between server and client. Never correctness, security, or pushability. |
| [plan-verifier](plan-verifier.md) | `opus` | Read-only — no `Write`/`Edit` in `tools`, which is mechanical; `Bash` is present and read-only **by rule** | Walks a finished plan's `REQ` list against the code and returns one of four fixed verdicts per requirement (`VERIFIED` / `PARTIAL` / `NOT IMPLEMENTED` / `CANNOT VERIFY`). Judges completeness only, never quality or architecture. |
| [doc-writer](doc-writer.md) | `sonnet` | Read-write, confined **by rule** to a closed surface — root/`<pkg>` `docs/**`, `<pkg>/specs/**`, `README.md`; `e2e/specs/*.flow.json` carved out | Documents what already exists, converts a finished plan's Goal + Requirements into a durable spec, or structures supplied material into a doc with diagrams — every behavioural claim cites a `path:line` opened this session. |

## Artifacts

What each agent takes in and hands back. Only the implementer changes the working tree.

| Agent | Input | Output |
|-------|-------|--------|
| `researcher` | A question, plus a mode (this project / the public internet) | A report in the reply. **No files written.** |
| `spec-creator` | A feature that does not exist yet, plus whatever design material there is — a `docs/mockups/*.png`, a description, the current `client/` UI, or a link; then, on its own initiative: the destination module's `AGENTS.md` + `INSIGHTS.md` and the contracts under `server/src/vendor/shared/contracts/` | **`<pkg>/specs/SPEC-NN-<slug>.md`** — the prescriptive spec, `Status: draft`, uncommitted. Reply carries the design partition, a grounding table, `### Unverified`, and `### Proposals` — the improvements it deliberately kept *out* of the file. On a gate (`G1`-`G5`) or the blocker interview: no file, questions instead. |
| `implementation-planner` | A feature request **plus the requirements it must satisfy** (prompt, issue, or an existing `<pkg>/specs/*.md`); then, read on its own initiative: module `AGENTS.md` + `INSIGHTS.md`, the placement skills, existing code | **`docs/plans/NN-slug.md`** — the plan file. Reply is a dispatch summary, not the plan. On a gate (`G1`-`G6`): no file, an interview instead. Before a first plan it normally returns the **requirement-validation interview** — the REQ table, the questions, the recommendations and the multi-agent/single-agent choice — and writes no file until answered. |
| `implementer` | **One task block** — from `docs/plans/NN-*.md`, or supplied inline in the dispatch prompt — plus its own module's `INSIGHTS.md` | Source + test files in the working tree, **uncommitted**. A `DONE`/`BLOCKED`/`PARTIAL` report with skills declared, acceptance ticked, and verbatim typecheck/test output. |
| `test-writer` | A target file/feature that already exists, classified into one of five lanes — client / server-unit / server-integration / engine / e2e-refused | Test file(s) in the working tree, uncommitted. A `DONE`/`BLOCKED` report with a per-case mutation table and verbatim RED-then-GREEN runs. |
| `architecture-reviewer` | A diff, path, or module to review structurally | A `BLOCK`/`CHANGES`/`PASS` verdict report with `file:line`-cited findings. **No files written.** |
| `plan-verifier` | A finished (or partial) `docs/plans/NN-*.md`, plus the code it claims to have produced | A `COMPLETE`/`INCOMPLETE` verdict report, one of four values per `REQ`, with cited evidence. **No files written.** |
| `doc-writer` | A module/mechanism to document, a finished plan to convert to spec, or supplied material to structure | A doc/spec/README file inside its closed write surface, uncommitted. A `DONE`/`BLOCKED`/`PARTIAL` report with a per-claim grounding table and an `### Unverified` section. |

Nothing is committed by an agent. Integration, `pr-self-review`, and any `INSIGHTS.md` append are
the parent session's job.

## The implementation-planner → implementer pipeline

```
request → spec-creator → <pkg>/specs/SPEC-NN-slug.md → owner approves
                                                          ↓
                       implementation-planner → docs/plans/NN-slug.md
                                                          ↓
                                        parent extracts wave 1's task blocks
                                                 ├── implementer (T1) ─┐
                                                 └── implementer (T2) ─┴→ parent integrates
                                                          ↓
                                        parent: coverage triage against §6      (free — no dispatch)
                                                          ↓
                                        architecture-reviewer  → parent: fix blocks → implementer
                                                          ↓
                                        test-writer, only at flagged gaps
                                                          ↓
                                        plan-verifier          → parent: fix blocks → implementer
                                                          ↓
                                        ── loop ends; the owner takes it from here ──
```

**`pr-self-review`, a commit, and the descriptive `doc-writer` pass are not in the diagram on
purpose.** That gate is slow and it is the owner's to spend, once, when they judge the diff ready.
No agent commits, and neither does the dispatching session on its own initiative.

The order is not arbitrary: `plan-verifier` caps code inspection at `PARTIAL` and only a passing
test buys `VERIFIED`, so running it before `test-writer` returns `INCOMPLETE` by construction. The
free triage step sits at the front for the opposite reason — a requirement nobody implemented is
cheapest to find before an `opus` review and a round of test writing have been paid for. Both
sequences, and the fix-block template, are written out in
[`docs/plans/README.md`](../../docs/plans/README.md) §"After the waves land" and §"Remediation".

**The spec leg is optional, and it is the requirements that decide.** `implementation-planner`
validates requirements rather than originating them, so it needs them from somewhere: a spec is one
source, a prompt or an issue is another. Reach for `spec-creator` when nobody has yet written down
what "done" means, when a mockup needs reviewing before anyone commits to it, or when the acceptance
criteria should outlive the plan that consumes them. Skip it when the requirements arrive already
stated. The two agents interlock at one field: the plan's `**Spec:**` header, and its `REQ-n` mapped
onto the spec's `AC-n`.

**The pipeline has a short leg.** A change too small to earn a plan document is dispatched straight
to an implementer with the task block written **inline in the prompt**, carrying the same mandatory
fields. Nothing is relaxed by it — the block is the contract either way — but the two things a plan
file supplied for free are now the dispatching session's job: the coverage matrix, and the check
that parallel blocks own disjoint paths.

The hand-off contract — plan format, the mandatory task fields, where a task block may come from,
the ownership invariant,
protected paths (Tier A / Tier B), skills per lane, done-condition commands — lives in
[`docs/plans/README.md`](../../docs/plans/README.md). **That file is canonical**; both agents carry
copies of its tables and both defer to it.

Two properties worth knowing before dispatching:

- **Both halves preload the same twelve skills** (the implementation-planner adds `mermaid-diagram`, for the plan's
  architecture diagram). The implementation-planner assigns each task's `Skills` line and writes its red flags, and
  it cannot do either well from skill names alone — so it pays the same preload the implementer
  does. Roughly double the context bill, in exchange for the plan's idea of the law being identical
  to the implementer's.
- **There is no worktree isolation.** Parallel implementers share one checkout, so the plan's
  disjoint `Owned paths` lists are the only thing preventing one agent from overwriting another's
  work — and a violation is silent lost work, not a merge conflict.
- **Dispatch the task block, not the plan file.** *"T3 from `docs/plans/04-smart-diff.md`"* makes
  the implementer open 44k tokens of plan to find a 2k-token block, sixteen times over on that
  plan. Extract the block and paste it verbatim, carrying `**Dispatched:**` set to the plan's own
  `Created:` date so the insight-conflict rule keeps its meaning. `docs/plans/README.md`
  §"Extraction is the preferred way to dispatch a plan's task" has the full recipe, including the
  disjointness check the dispatching session now owns.

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
| [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — official docs | `description` is the **routing rule**, not a summary, so both descriptions open with trigger conditions and literal user phrasings. `tools` is a closed allowlist, and it is real enforcement of exactly one thing — **which tools exist** — hence implementation-planner-has-no-`Edit` and implementer-has-no-`Agent`. It bounds nothing else; see the `tools` row under "Adding a new agent" before reading more into it. `skills:` preloads deterministically, where description-matching is probabilistic; that is why skills are preloaded rather than gated on the agent remembering to load them. |
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
| EARS — Easy Approach to Requirements Syntax (Mavin, Wilkinson, Harwood & Novak, [IEEE RE'09](https://ieeexplore.ieee.org/document/5328509); high confidence for the patterns) | **The actual origin** of `spec-creator`'s five-pattern acceptance-criteria table — ubiquitous, event-driven (`WHEN`), state-driven (`WHILE`), unwanted behaviour (`IF/THEN`), optional feature (`WHERE`) — and of `shall` as the obligation marker. The point of the syntax is that it forces the **condition** apart from the **response**, which is what makes a criterion falsifiable by someone who was not in the room; the banned-words rule ("correctly", "gracefully", "as expected") is this repo's own addition, not EARS's, and is the same idea pointed at the response half. Note the seam it does *not* close: EARS constrains one criterion's grammar and says nothing about whether the set is complete — that gap is what `## Edge cases` and `plan-verifier` exist for. |

### Internal — what the rules say about *this* repo

| Source | What it grounds |
|---|---|
| [root `AGENTS.md`](../../AGENTS.md) | The session protocol (read a module's `INSIGHTS.md` and summarize before writing) — both agents implement it. Also the do-not-touch list feeding Tier A protected paths: lockfiles, `docker compose down -v`, four standalone packages with no root `package.json`. |
| [`onion-architecture`](../skills/onion-architecture/SKILL.md) | The ring model and import matrix. Source of the implementer's backend hard rules (service never imports `drizzle-orm`; `Deps` not `Container`; `process.env` only in `platform/config.ts`) and of the `Ring:` field the implementation-planner stamps on backend tasks. |
| [`frontend-ui-architecture`](../skills/frontend-ui-architecture/SKILL.md) | The client placement law — thin pages, colocated `_components/`, promotion thresholds. Source of the frontend hard rules and of the implementation-planner's frontend path assignments. |
| Module `AGENTS.md` — [server](../../server/AGENTS.md) · [client](../../client/AGENTS.md) · [reviewer-core](../../reviewer-core/AGENTS.md) · [e2e](../../e2e/AGENTS.md) | Per-lane commands and constraints: schema-first validation, the engine's purity, e2e's deterministic-locators-only rule. |
| [`TESTING.md`](../../TESTING.md) | The done-condition commands and the `*.it.test.ts` hermetic/integration split. |
| Module `INSIGHTS.md` files | The implementation-planner reads them all and distributes dated entries into each task's `Binding insights`; the implementer re-reads only its own lane's as a freshness check. A newer entry beats the plan. |
| [`docs/plans/README.md`](../../docs/plans/README.md) | The canonical hand-off contract both agents cite. |
| [`researcher.md`](researcher.md) | The house body convention and the named-gate pattern (`G1`–`G5`) that both agents follow. |

## Adding a new agent

One `.md` file per agent, named after the agent. Frontmatter keys:

| Key | Required | Notes |
|-----|----------|-------|
| `name` | yes | Must match the filename. |
| `description` | yes | **This is the routing rule** — Claude picks an agent by its description, so write it as trigger conditions ("Use when…", with literal user phrasings), not as a summary. |
| `model` | no | `sonnet` \| `opus`. Omit to inherit the session model. |
| `tools` | no | Comma-separated allowlist. **Omitting it grants everything** — always set it explicitly for a read-only agent. The allowlist is the real enforcement **for which tools exist**, and only that. It cannot be scoped by path: there is no `Write(docs/**)`. So `Bash` and a bare `Write` are wide open by construction — `Bash` alone grants `>`, `sed -i`, `rm`, `git checkout`, which is a superset of `Write` and `Edit`. An agent granted either needs an explicit prose bound (see `researcher.md`, which enumerates what its `Bash` may and may not do), and where the consequence is serious, a `permissions.deny` entry in `.claude/settings.json` — that one *is* mechanical, it beats `allow`, and it reaches subagents, because permission settings and `PreToolUse` hooks both cascade into a subagent's tool calls ([docs](https://code.claude.com/docs/en/sub-agents); documented, never probed here). Three caveats, because this row is where the next author learns the model. Deny is **not hermetic** — it covers the file tools and the file commands Claude Code recognizes in Bash (`cat`, `head`, `tail`, `sed`) but not an arbitrary subprocess, so `node -e "fs.writeFileSync(…)"` still reaches the file; only [the sandbox](https://code.claude.com/docs/en/sandboxing) blocks every process. **Anchor the path with a leading `/`** (`Edit(/.claude/hooks/**)`): a bare pattern resolves against the session's working directory, and this repo tells you to run commands from inside each package, so an unanchored rule in a session started from `server/` protects nothing and says nothing about it. Anchoring is necessary and **not sufficient**: `.claude/settings.json` itself loads from the current working directory's `.claude/` folder with *no parent-directory fallback*, so a session started in `server/` never reads the root file at all — deny block, `PreToolUse` hook and everything else. `.claude/settings.local.json` is the exception; since v2.1.211 it loads from the git repository root either way. **Start Claude Code at the repo root**; the anchor only fixes the case where the file did load. And **write the rule against `Edit`, never `Write`** — Claude Code consults `Edit(path)` and `Read(path)` rules only; a path rule on `Write`, `NotebookEdit`, `MultiEdit` or `Glob` parses, warns at startup, and is then never consulted, while `Edit(path)` already governs all of them. That is the same trap shape as `Agent(researcher, Explore)` below, and this repo shipped it: the first deny block written here carried two dead `Write(...)` rules under a cwd-relative anchor, so it was doubly inert. **Nothing in `tools` scopes anything.** `Agent(researcher, Explore)` was tried here and behaves as a trap: it parses without error, is echoed back in the agent roster as if it took effect, and then permits every subagent type anyway — verified by having a so-scoped implementation-planner successfully dispatch an `implementer`. Deny cannot substitute, because deny is session-wide and would block the parent session from that agent type too. Write the restriction as prose and say plainly that it is prose. |
| `disallowedTools` | no | The denylist counterpart to `tools` — comma-separated, subtracted from whatever the agent would otherwise hold. Useful for "everything except", where an allowlist would have to be re-audited every time the tool set grows. It carries **every limitation of `tools`**: it names tools, not paths, so `disallowedTools: Write(docs/**)` is not a thing, and nothing here is scoped. No agent in this set uses it; the row exists so the next author knows the field is available and knows it buys no scoping. |
| `skills` | no | YAML list of skills to preload. Preloaded skills must not set `disable-model-invocation: true`. **A name that does not match a directory under `../skills/` fails silently** — nothing preloads, nothing errors, and you find out when the agent ignores a convention it never received. Check the spelling against the directory, not against memory. Note also that setting `tools` makes it a closed allowlist: omit `Skill` from it and the agent cannot load anything at runtime either. |

Body convention, mirroring the skills: `# Title` → one-paragraph role statement → `## Hard rules`
(absolutes, bolded lead-ins) → `## Method` (numbered steps) → `## Output format` (a literal
template the agent fills).

Two things worth copying from `researcher.md`:

- **Nest output templates in `~~~` fences**, not ``` ```. Templates that contain code blocks break
  a ```-fenced parent.
- **Name your gate conditions** if the agent can refuse or stop early (G1–G4 there). A stop that
  cites which rule fired is debuggable; "I needed more info" is not.

**Assume a new agent needs a restart — but know that the docs disagree, and why.** The
[docs](https://code.claude.com/docs/en/sub-agents) say Claude Code watches `.claude/agents/` and
picks up an added or edited file within seconds, with three exceptions that still need a restart: **the watcher only covers directories that existed when
the session started**, it does not watch `.claude/agents/` under `--add-dir`, and
`--disable-slash-commands` disables it entirely. Against that, the one observation recorded here is
the opposite — a newly written agent was not dispatchable and `Agent` failed with "not found",
listing only what existed at startup.

**Probed 2026-08-22, and the observation wins: an EDIT does not take effect mid-session.** This is
the deliberate probe the paragraph below used to ask for. In a session that started with
`.claude/agents/` long since on disk, `implementer.md` was edited to add a new gate (`G6 — No task
block`) and rename the report's `**Plan:**` field to `**Task source:**`. An implementer dispatched
afterwards with a block deliberately missing `Acceptance` and `Red flags` **did not fire `G6`** — it
invented an acceptance box from the `Do` line, wrote "no red-flag list was provided", and headed its
report `**Plan:**`. Two runs in that session, both on the pre-edit definition. Note the probe design
that made it readable: the new rule was given a *name that exists nowhere else*, so "the agent chose
not to apply it" and "the agent never had it" look different in the output.

Caveat on scope: this probes an **edit to an existing** agent, which is the case that matters most
here (Tier A says only the parent session may make one, and the parent is the session that then wants
to dispatch it). It says nothing about how quickly a *newly added* file registers, and nothing about
`.claude/skills/`.

So: **budget for a restart after touching any agent file**, and treat a post-edit dispatch in the
same session as running the old rules. The likely reconciliation with the docs is still the first
exception — a watcher that covers only directories present at session start — but the practical rule
no longer depends on which explanation is right.

Note what this does *not* mean. Authoring a new agent is ordinary work and can be delegated to an
existing one — only the **dispatch** of the new agent might have to wait. And a new agent turning up
in the available list mid-session is *not* evidence that the registry is watched: the user may have
restarted, and a restart is invisible from inside the session. To settle it you need a deliberate
probe — edit an agent file in a session that started with `.claude/agents/` already on disk, then
dispatch it and check which definition ran.

Finish with the static checks that *are* possible in-session, because two of them fail **silently**:
a name in `skills:` that does not match a directory under `../skills/` preloads nothing and reports
nothing, and a `name` that does not match the filename leaves you dispatching something that is not
there.

## What was actually probed

This set was smoke-tested once, on 2026-08-21, when the four reviewing agents were added. The runs
are recorded here rather than in the plan that produced them, because a plan is a snapshot of intent
that gets deleted when the work lands, and this is the only evidence anyone has that these agents do
what their files claim.

Every claim below was re-checked by the parent session against the tree, not taken from the agent's
report — **an agent's own account of its work is a claim, not evidence.**

| # | Run | Verdict | What it proved |
|---|---|---|---|
| V1 | `implementer` → a Tier B path in a solo wave | `DONE` | The permissive half of `G5`: a Tier B path with `**Parallel:** no` is assignable. Every acceptance box closed by quoted file content — the `n/a` done condition held. |
| V2 | `implementer` → the existing `implementer.md` | `BLOCKED` / `G5` | The restrictive half: a rule already in force is refused **even though the plan assigned it**. Verified by md5 against a pre-dispatch copy (`75d51fb7…` unchanged), not by `git diff` — `.claude/agents/` was untracked then, so a diff would have been empty unconditionally. |
| V3 | `architecture-reviewer` → `server/src/modules/repo-intel/` | `BLOCK`, 12 findings | Precision pass is real: 21 drafted → 4 dropped → 17 reported, with a reason per drop. Finding 1 spot-checked true against `service.ts:105`. |
| V4 | `test-writer` → `reviewer-core/src/grounding.ts` | `DONE`, 8 cases | Genuine mutation testing: each mutation applied, run, captured red, reverted. `git diff -- reviewer-core/src/` empty afterwards; independent `npm test` green at 31/31. |
| V5 | `doc-writer` → `server/specs/repo-intel.md` | `DONE`, 405 lines | Grounding holds. Independently confirmed its two substantive claims: `repo-intel/README.md:45` is stale (four more methods are wired from `conventions/service.ts`), and `getBlastRadius`/`getUnresolvedReferences` have no callers outside the module. |
| V6 | `plan-verifier` → the plan that dispatched V1–V5 | `INCOMPLETE` — 7 `VERIFIED`, 1 `PARTIAL` | The most valuable run: it found six defects **in that plan**, all confirmed. It also refused the framing supplied in its own prompt — "a report I cannot open is not evidence I hold" — and graded a requirement `PARTIAL` rather than accept the parent's word. |

**The outputs of V4 and V5 were deleted after the runs.** `reviewer-core/test/grounding.test.ts` and
`server/specs/repo-intel.md` were real work on real targets — a smoke test given a fake target proves
nothing — but neither followed from "add four agents", and a diff should describe one change. Do not
go looking for those two files; the rows describe what happened, not what is on disk.

V3, V4 and V6 each surfaced a defect in the *instructions* they were given, and all three fixes are
already in the agent files: `[pre-existing]` marking in `architecture-reviewer`, the explicit
mutate-and-revert exception in `test-writer`, and several corrections to the plan format. The
itemized table is not reproduced here — it describes edits that have since landed, so the files
themselves are the better record. Read it at
`git show b134c28:docs/plans/01-agent-set-expansion.md` §10.

### Harness facts established the hard way

Each of these cost a real run to establish, and the first three are traps — they parse, they look
like enforcement, they enforce nothing. Do not re-derive them; do re-probe any row marked unproven.

| Claim | Truth |
|---|---|
| `tools: Agent(researcher, Explore)` scopes delegation | **FALSE — a trap.** Parses, is echoed back in the agent roster as if applied, restricts nothing. A implementation-planner carrying it dispatched an `implementer` in 1.8s. Reverted to flat `Agent`. |
| `tools:` can scope a path (`Write(docs/**)`) | **FALSE.** No such syntax. Every path confinement in this agent set is prose. |
| `Bash` in a read-only agent is harmless | **FALSE.** It grants `>`, `sed -i`, `rm`, `git checkout` — a superset of `Write` + `Edit`. "Read-only, enforced by the allowlist" is false for any agent holding it. |
| `permissions.deny` with paths works | **TRUE, tested twice.** The original probe `Edit`-ed `.claude/hooks/pr-gate.mjs` (since deleted) with a deliberately non-matching `old_string`, and got a permission refusal rather than "string not found" — two outcomes that look different, which is what made the probe conclusive. Re-confirmed 2026-08-28 against the still-live `Edit(/.claude/settings*.json)` rule, which refused an edit with `File is in a directory that is denied by your permission settings`. The general method: **to test a restriction, ask an agent to do the thing it forbids**, and design the probe so success and failure look different. |
| A deny rule on `Write(path)` protects the path | **FALSE.** Only `Edit(path)` and `Read(path)` rules are consulted; `Edit` covers the `Write` tool too. See the `tools` row above. |
| deny is hermetic | **FALSE.** Covers the file tools and recognized Bash file commands (`cat`, `sed`), not an arbitrary subprocess. `node -e "fs.writeFileSync(…)"` gets through. |
| deny can restrict one agent | **FALSE.** Session-wide — it would block the parent session too. |
| deny reaches subagents | **TRUE per the docs, unproven here.** Permission settings and `PreToolUse` hooks both cascade into a subagent's tool calls. No probe was run. |
| Agents register only at session start | **TRUE for edits — probed 2026-08-22.** See the restart paragraph above. |
| `user-invocable: false` blocks preloading a skill | **FALSE.** That is `disable-model-invocation: true`. No skill here sets it. |
