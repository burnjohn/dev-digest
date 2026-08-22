# Development Plan: Four New Claude Code Subagents (test-writer, architecture-reviewer, plan-verifier, doc-writer)

## Overview
This is **meta** work on the DevDigest repo's own agent tooling: we add four new Claude Code
subagent definition files under `.claude/agents/` and wire them into the agents `README.md`. The
deliverables are agent-definition Markdown (system prompts with YAML frontmatter), **not** product
code under `server/`, `client/`, `reviewer-core/`, or `e2e/`. Every new file must match the exact
house style established by the three existing agents (`researcher.md`, `planner.md`,
`implementer.md`): YAML frontmatter (`name`, trigger-rule `description`, `model`, explicit `tools`,
optional `skills:` with inline comments), then a body with `# Title`, `## Hard rules`, a
workflow/method section, and a fixed `## Output format`.

## Requirements
- R1: Add `.claude/agents/test-writer.md` — a `sonnet` agent that writes unit + integration tests
  for the Fastify/Drizzle backend (vitest) and the `reviewer-core` LLM engine; has WRITE access;
  preloads `react-testing-library, typescript-expert, zod, fastify-best-practices,
  drizzle-orm-patterns, onion-architecture, security, engineering-insights`.
- R2: Add `.claude/agents/architecture-reviewer.md` — an `opus` **read-only** agent (tools:
  `Read, Glob, Grep` only) that reviews a diff/file set for structural/architectural contract
  violations; preloads `onion-architecture, frontend-architecture, fastify-best-practices,
  drizzle-orm-patterns, react-best-practices, next-best-practices, typescript-expert, security`.
- R3: Add `.claude/agents/plan-verifier.md` — an `opus` **read-only** agent (tools:
  `Read, Glob, Grep, Bash`; NO `Edit`/`Write`) that verifies every requirement/plan item is actually
  implemented (completeness & traceability, not code quality); preloads a lean set
  `typescript-expert, onion-architecture, frontend-architecture`.
- R4: Add `.claude/agents/doc-writer.md` — a `sonnet` agent with WRITE access that writes/updates
  documentation (Diátaxis-classified, grounded, with Mermaid diagrams) and knows where docs belong
  in the repo; preloads `mermaid-diagram, typescript-expert, onion-architecture,
  frontend-architecture, engineering-insights`.
- R5: Each new agent file follows the existing convention exactly: frontmatter
  (`name` == filename stem, trigger-rule `description`, `model`, explicit `tools`, `skills:` list
  with inline `#` comments), then body `# Title` → `## Hard rules` → workflow/method → fixed
  `## Output format`.
- R6: Every skill listed in any new agent's `skills:` must actually exist under `.claude/skills/`
  (valid set: drizzle-orm-patterns, engineering-insights, fastify-best-practices,
  frontend-architecture, mermaid-diagram, next-best-practices, onion-architecture,
  postgresql-table-design, pr-self-review, react-best-practices, react-testing-library, security,
  typescript-expert, zod). No skill may be invented.
- R7: Update `.claude/agents/README.md` — add a table row and a `## <agent>` section (with a
  "Based on:" source-link list matching the planner/implementer sections' style) for all four agents.
- R8 (OPTIONAL, flagged scope): Add a "Test-writing agent rules" / mocking-policy block to the root
  `CLAUDE.md`, only if it fits repo conventions. The user may drop this task.

## Affected modules & contracts
- **`.claude/agents/`** — four new agent definition files added; `README.md` updated.
- **`CLAUDE.md`** (root) — OPTIONAL mocking-policy block (R8 only).
- **Product modules** (`server/`, `client/`, `reviewer-core/`, `e2e/`) — **no changes.** The agent
  bodies *reference* these modules' docs and conventions, but no file under them is created or edited.
- **Contracts:** none. No `@devdigest/shared` Zod contract is added or changed.

## Architecture changes
- No onion-layer or RSC-boundary changes (no product code). The only "architecture" here is the
  agent-tooling layer under `.claude/agents/`. Each new file is a self-contained system prompt; the
  only shared/sequenced file is `.claude/agents/README.md` (and optionally root `CLAUDE.md`).
- House-style contract every agent file must satisfy (derived from `researcher.md` / `planner.md` /
  `implementer.md`):
  - Frontmatter keys in order: `name`, `description`, `model`, `tools`, then optional `skills:`.
  - `description` is a trigger rule ("Use proactively when…" / "Read-only … agent.").
  - `tools` is an explicit comma list; **omitting** write tools is the mechanism that makes an agent
    read-only (see `researcher.md` which lists no `Edit`/`Write`).
  - `skills:` is a YAML list, each item with a trailing inline `#` comment grouping its purpose
    (mirroring `planner.md` / `implementer.md`).
  - Body sections: `# <Title>`, `## Hard rules`, a method/workflow section, fixed `## Output format`;
    optional "When you cannot…" tail like `researcher.md` / `planner.md`.

## Phased tasks

### Phase 1 — Four independent agent files (fully parallel)

All four tasks below own disjoint single files and have no inter-dependencies, so they run
concurrently. None of them touches `README.md` or `CLAUDE.md` (those are Phase 2).

- **T1 — test-writer agent**
  - **Action:** Create `.claude/agents/test-writer.md`. Frontmatter: `name: test-writer`;
    trigger-rule `description` (e.g. "Use proactively to add or extend unit/integration tests for the
    Fastify/Drizzle backend or the reviewer-core LLM engine. Writes only test files; self-verifies by
    running the suite."); `model: sonnet`; `tools: Read, Glob, Grep, Edit, Write, Bash, Skill, Agent`;
    `skills:` list (with inline `#` comments) = `react-testing-library, typescript-expert, zod,
    fastify-best-practices, drizzle-orm-patterns, onion-architecture, security, engineering-insights`.
    Body must encode the Hard rules: writes ONLY test files; never modifies production `src/` except
    adding a type export strictly required to compile a test; never refactors or adds error handling.
    Backend test convention: `*.it.test.ts` = integration (real Postgres via testcontainers,
    transaction-rollback isolation per test); all other `*.test.ts` = hermetic unit (no Docker /
    network / real clock). reviewer-core: inject a `FakeLlmProvider` at the `LLMProvider` seam, assert
    on parsed STRUCTURE not text content; never generate vitest snapshot tests of raw LLM output;
    prompt-quality lives in a separate eval harness, not vitest. Explicit anti-patterns to forbid:
    tautological tests (state the behavioral contract in a comment before each assertion; if the
    contract is unclear, leave a TODO instead of asserting current behavior); over-mocking (prefer
    real objects; mock only I/O / clock / unimplemented; NEVER mock the Drizzle db in `.it.test.ts`;
    never mock the unit under test); no `toMatchSnapshot`/`toMatchInlineSnapshot` for dynamic output
    (use `toMatchObject` + `expect.any()`); no `Date.now()`/`Math.random()` in test bodies (use
    `vi.useFakeTimers` + seeded ids); `afterEach`/`afterAll` cleanup for every opened resource.
    Fixed `## Output format`: a result template (changed test files, suite/typecheck commands run,
    pasted terminal evidence, never claim green without it). Self-verify commands to embed:
    server unit `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` + `pnpm typecheck`;
    server integration `cd server && pnpm exec vitest run .it.test`; reviewer-core
    `cd reviewer-core && npm test` + `npm run typecheck`. Reference sources in a notes/Based-on tail.
  - **Module:** n/a (meta — `.claude/agents/`)
  - **Type:** ui (Markdown authoring; `react-testing-library` is the relevant skill emphasis here,
    but no product code is touched)
  - **Skills to use:** react-testing-library, typescript-expert, zod, fastify-best-practices,
    drizzle-orm-patterns, onion-architecture, security, engineering-insights (these are the skills the
    new agent declares — the planner verifies they exist and are correctly grouped)
  - **Owned paths:** `.claude/agents/test-writer.md`
  - **Depends-on:** none
  - **Risk:** low
  - **Known gotchas:** Skills listed in `skills:` must NOT set `disable-model-invocation: true`
    (verified: none of the 14 skills do). `name` must equal the filename stem `test-writer`. Keep the
    `tools` list write-capable (`Edit, Write`) — this agent must add files.
  - **Acceptance:** `head -20 .claude/agents/test-writer.md` shows valid YAML frontmatter that parses;
    `grep -E '^name: test-writer$' .claude/agents/test-writer.md` matches the filename;
    `grep -E '^tools:.*Write' .claude/agents/test-writer.md` confirms write access; every token in the
    `skills:` block resolves to an existing `.claude/skills/<name>/` directory (verify with:
    `for s in react-testing-library typescript-expert zod fastify-best-practices drizzle-orm-patterns
    onion-architecture security engineering-insights; do test -d .claude/skills/$s || echo MISSING $s;
    done` → no output); body contains `## Hard rules` and `## Output format`; the three self-verify
    command lines appear verbatim in the body.

- **T2 — architecture-reviewer agent**
  - **Action:** Create `.claude/agents/architecture-reviewer.md`. Frontmatter:
    `name: architecture-reviewer`; trigger-rule `description` (e.g. "Read-only architectural reviewer.
    Use to audit a diff or file set against DevDigest's documented structural contracts — onion
    layering, DI discipline, reviewer-core isolation, shared-contract usage. Reports violations; never
    edits."); `model: opus`; `tools: Read, Glob, Grep` (ONLY — the body must state that omitting
    write tools is deliberate: a reviewer that can write is tempted to fix rather than report, which
    destroys review independence; read-only is both a safety and a correctness guarantee);
    `skills:` = `onion-architecture, frontend-architecture, fastify-best-practices,
    drizzle-orm-patterns, react-best-practices, next-best-practices, typescript-expert, security`.
    Body: Hard rules + a method that requires reading the repo's OWN docs before judging —
    `server/docs/architecture.md`, `server/CLAUDE.md`, `reviewer-core/CLAUDE.md`,
    `reviewer-core/docs/pipeline.md`, root `CLAUDE.md`. DevDigest-specific structural checks to encode:
    inward-only dependency rule (Domain→Application→Infrastructure→Presentation); business logic in
    route handlers; DI discipline (deps via `platform/container.ts` constructor injection, never
    `new Adapter()` outside the container); no `process.env` outside `LocalSecretsProvider`;
    reviewer-core zero-I/O isolation (no `fs`/`pg`/`octokit`/`http` imports) and never bypassing
    `groundFindings()`; shared Zod contract bypass (duplicating types instead of importing from
    `vendor/shared/`). Explicitly state it does NOT do style nits, runtime bugs, test quality, or
    security injection vectors (those belong to `pr-self-review`). Fixed `## Output format`: one
    finding per violation with file, line, severity (critical/high/medium/low/info), `rule` (the exact
    documented contract name being enforced), evidence (verbatim offending import/statement),
    one-sentence recommendation; final verdict = count by severity. Every finding MUST cite the
    documented project rule it violates; uncited generic opinions are downgraded/suppressed.
  - **Module:** n/a (meta)
  - **Type:** backend (onion/Fastify/Drizzle skill emphasis dominates this reviewer; no product code)
  - **Skills to use:** onion-architecture, frontend-architecture, fastify-best-practices,
    drizzle-orm-patterns, react-best-practices, next-best-practices, typescript-expert, security
  - **Owned paths:** `.claude/agents/architecture-reviewer.md`
  - **Depends-on:** none
  - **Risk:** low
  - **Known gotchas:** The `tools` line must be EXACTLY `Read, Glob, Grep` — no `Edit`/`Write`/`Bash`.
    `name` must equal `architecture-reviewer`. Do not add a `## When you cannot…` tail that implies it
    can fix anything. Skills must all exist (verified, none disable model invocation).
  - **Acceptance:** frontmatter parses; `grep -E '^name: architecture-reviewer$'` matches filename;
    `grep -E '^tools: *Read, *Glob, *Grep *$' .claude/agents/architecture-reviewer.md` matches and
    `grep -E '^tools:.*(Edit|Write|Bash)' .claude/agents/architecture-reviewer.md` returns NOTHING
    (read-only proven); all eight `skills:` entries resolve to `.claude/skills/<name>/`; body contains
    `## Hard rules`, the documented-doc reading list, and an `## Output format` with a per-finding
    schema including a `rule` citation field.

- **T3 — plan-verifier agent**
  - **Action:** Create `.claude/agents/plan-verifier.md`. Frontmatter: `name: plan-verifier`;
    trigger-rule `description` (e.g. "Read-only requirements-completion checker. Use after a feature is
    claimed done to verify every plan item / acceptance criterion is actually implemented — focus on
    completeness and traceability, not code quality."); `model: opus`;
    `tools: Read, Glob, Grep, Bash` (Bash so it can run tests/grep as evidence — but NO `Edit`/`Write`:
    the body must state it never modifies anything); `skills:` = a LEAN set `typescript-expert,
    onion-architecture, frontend-architecture` (enough to locate backend vs UI artifacts; the body
    states its job is completeness verification, NOT style/architecture review). Body method:
    (1) per-requirement pass — for each plan item/acceptance criterion, search for the concrete
    artifact (grep the exact symbol/route/test name first; escalate to structural search; read & quote
    the evidence verbatim — never recall from memory); assign status done | partial | missing |
    cannot-verify. (2) whole-plan pass for implicit requirements (error handling, auth, idempotency)
    flagged separately. Evidence-before-verdict: every status backed by a found artifact
    (`file:line` / test name / command output); self-assertions and "build is green" do NOT count as
    proof a requirement is satisfied. Define `missing` = sought and not found; `cannot-verify` =
    ambiguous or unverifiable by static reading. Fixed `## Output format`: a traceability matrix table
    (`REQ-ID | requirement text | how sought | evidence file:line | status | notes`) then a gate
    verdict ("N of M requirements verified; these are missing/partial"). Forbid rubber-stamping,
    hallucinated confirmation, and conflating "code exists" with "requirement satisfied".
  - **Module:** n/a (meta)
  - **Type:** core (typescript-expert emphasis; lean skill set; no product code)
  - **Skills to use:** typescript-expert, onion-architecture, frontend-architecture
  - **Owned paths:** `.claude/agents/plan-verifier.md`
  - **Depends-on:** none
  - **Risk:** low
  - **Known gotchas:** `tools` must include `Bash` but must NOT include `Edit`/`Write`. `name` ==
    `plan-verifier`. Keep `skills:` lean (only the three named) — do not pad it with the full set;
    that's a deliberate design choice the README must explain. All three skills exist.
  - **Acceptance:** frontmatter parses; `grep -E '^name: plan-verifier$'` matches filename;
    `grep -E '^tools:.*Bash' .claude/agents/plan-verifier.md` matches AND
    `grep -E '^tools:.*(Edit|Write)' .claude/agents/plan-verifier.md` returns NOTHING; the `skills:`
    block lists exactly `typescript-expert, onion-architecture, frontend-architecture` (3 entries,
    each resolving to `.claude/skills/<name>/`); body contains `## Output format` with a traceability
    matrix table header and the four status values.

- **T4 — doc-writer agent**
  - **Action:** Create `.claude/agents/doc-writer.md`. Frontmatter: `name: doc-writer`; trigger-rule
    `description` (e.g. "Use proactively to write or update documentation — document already-shipped
    functionality, convert an Implementation Plan into docs, or turn inputs into structured docs with
    Mermaid diagrams. Knows where docs belong in the repo. Writes only Markdown docs."); `model:
    sonnet`; `tools: Read, Glob, Grep, Write, Edit, Bash, Skill, Agent`; `skills:` = `mermaid-diagram,
    typescript-expert, onion-architecture, frontend-architecture, engineering-insights`. Body method:
    classify every doc into a Diátaxis quadrant (tutorial / how-to / reference / explanation) and keep
    types on separate pages; ADRs and gotchas/insights are NOT Diátaxis types and use their own
    conventions. GROUNDING is the central rule: document only what is observable in source — never
    invent APIs, parameters, or rationale; if rationale isn't in code comments/commits/ADRs, leave it
    blank or flag `[rationale not found — human input required]` rather than fabricate. Read 2–3
    existing repo docs first to mirror conventions. Mermaid diagram-type selection: flow =
    process/decision, sequence = runtime interaction, ER = data model, class = module structure,
    state = lifecycle; always pair a diagram with prose; run a Mermaid syntax post-check (unique node
    ids, no lowercase `end`, correct arrows). Anti-patterns to forbid: verbose filler / restating the
    heading, fabricated rationale, bracketed placeholders / leaked citation tokens, documenting
    future/aspirational behavior as implemented. Encode the WHERE decision tree (DevDigest layout):
    module-specific → that module's `docs/` (`server/docs/`, `client/docs/`, `reviewer-core/docs/`,
    `e2e/docs/`); cross-cutting → root `docs/`; plans → `docs/plans/`; ADRs → `docs/adr/NNNN-title.md`
    (numbered, append-only, never edit an accepted one — supersede); gotchas/insights → co-located
    `<module>/insights/`. Stamp generated docs with a `<!-- generated from: <source files> -->`
    provenance comment. Fixed `## Output format`: result template (doc path(s) written, Diátaxis type
    chosen, diagram type(s), provenance stamp, grounding gaps flagged).
  - **Module:** n/a (meta)
  - **Type:** ui (frontend-architecture + mermaid emphasis; no product code)
  - **Skills to use:** mermaid-diagram, typescript-expert, onion-architecture, frontend-architecture,
    engineering-insights
  - **Owned paths:** `.claude/agents/doc-writer.md`
  - **Depends-on:** none
  - **Risk:** low
  - **Known gotchas:** Keep `tools` write-capable. `name` == `doc-writer`. The Mermaid post-check rule
    (no lowercase `end`, unique node ids) must be stated because it's a common diagram-render failure.
    All five skills exist.
  - **Acceptance:** frontmatter parses; `grep -E '^name: doc-writer$'` matches filename;
    `grep -E '^tools:.*Write' .claude/agents/doc-writer.md` confirms write access; all five `skills:`
    entries resolve to `.claude/skills/<name>/`; body contains `## Hard rules`, the WHERE decision
    tree (mentions `docs/adr/`, `docs/plans/`, `<module>/insights/`), the Diátaxis quadrants, and the
    `<!-- generated from: ... -->` provenance stamp instruction; `## Output format` present.

### Phase 2 — Wire-up of shared files (sequential, after Phase 1)

These tasks edit files shared across all four agents, so they must run **after** T1–T4 complete (the
README section per agent must match what each file actually says). T5 and T6 both edit different
files and could run concurrently with each other, but both depend on all of Phase 1.

- **T5 — Update agents README**
  - **Action:** Edit `.claude/agents/README.md`. (1) Add four rows to the agents table (after the
    `implementer` row) — `test-writer | sonnet | Writes unit+integration tests (backend + reviewer-core) | Yes`;
    `architecture-reviewer | opus | Read-only structural/architecture review of a diff or file set | No`;
    `plan-verifier | opus | Read-only requirements-completion / traceability check | No`;
    `doc-writer | sonnet | Writes documentation (Diátaxis + Mermaid), knows where docs belong | Yes`.
    (2) Add a `## <agent>` prose section for each (after the `implementer` section, before
    "Adding a new agent"), each with a short "What it does" / "Skill routing" paragraph matching the
    planner/implementer style and a "**Based on:**" bullet list of the researched source URLs:
    - test-writer: https://code.claude.com/docs/en/sub-agents ·
      https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/ ·
      https://arxiv.org/html/2602.00409v1 (over-mocking study) ·
      https://dev.to/jamesdev4123/when-ai-generated-tests-pass-but-miss-the-bug-a-postmortem-on-tautological-unit-tests-2ajp ·
      https://callsphere.ai/blog/unit-testing-ai-agents-mocking-llm-calls-deterministic-tests ·
      https://codepunkt.de/writing/blazing-fast-prisma-and-postgres-tests-in-vitest/ ·
      https://mergify.com/flaky-tests/vitest/
    - architecture-reviewer: https://code.claude.com/docs/en/sub-agents ·
      https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/ ·
      https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents ·
      https://dev.to/uxter/clean-architecture-in-the-age-of-ai-preventing-architectural-liquefaction-5d8d ·
      https://dev.to/remojansen/enforce-clean-architecture-in-your-typescript-projects-with-fresh-onion-45pi ·
      https://addyosmani.com/blog/agentic-code-review/
    - plan-verifier: https://arceapps.com/blog/spec-driven-development-ai/ ·
      https://www.braingrid.ai/blog/how-to-write-acceptance-criteria-ai-agent-can-verify ·
      https://ceaksan.com/en/code-search-for-ai-agents-which-tool-when ·
      https://ceaksan.com/en/llm-behavioral-failure-modes ·
      https://dev.to/moonrunnerkc/ai-coding-agents-can-verify-some-of-their-work-now-heres-what-they-still-miss-58mc ·
      https://www.perforce.com/blog/alm/how-create-traceability-matrix
    - doc-writer: https://diataxis.fr/start-here/ ·
      https://arxiv.org/html/2504.08725v1 (DocAgent grounding) ·
      https://www.mintlify.com/blog/ai-can-write-your-docs-but-should-it ·
      https://martinfowler.com/bliki/ArchitectureDecisionRecord.html ·
      https://aws.amazon.com/blogs/architecture/master-architecture-decision-records-adrs-best-practices-for-effective-decision-making/ ·
      https://github.com/conorbronsdon/avoid-ai-writing/blob/main/SKILL.md
    Each section's links must use the relative-link `[title](url)` style used by the existing planner
    section. Do not edit existing rows/sections.
  - **Module:** n/a (meta)
  - **Type:** ui (Markdown doc authoring)
  - **Skills to use:** frontend-architecture (doc structure mirroring), engineering-insights
  - **Owned paths:** `.claude/agents/README.md`
  - **Depends-on:** T1, T2, T3, T4
  - **Risk:** low
  - **Known gotchas:** The README's "Adding a new agent" section already documents the
    `disable-model-invocation` rule — keep the new sections consistent with it. Each README section's
    described `model`/`tools`/`skills` must MATCH the agent file as actually written (read each file
    before writing its section). Preserve the existing workflow diagram block.
  - **Acceptance:** `grep -cE '^\| \[?`?(test-writer|architecture-reviewer|plan-verifier|doc-writer)'
    .claude/agents/README.md` (or equivalent) shows 4 new table rows; `grep -cE
    '^## (test-writer|architecture-reviewer|plan-verifier|doc-writer)' .claude/agents/README.md` == 4;
    each new section contains a "Based on:" list; every source URL listed above appears at least once
    (`grep -F 'diataxis.fr' …`, `grep -F 'arxiv.org/html/2602.00409v1' …`, etc., all match); the
    table still contains the original `researcher`/`planner`/`implementer` rows unchanged.

- **T6 (OPTIONAL — user may drop) — Root CLAUDE.md mocking-policy block**
  - **Action:** Append a short "Test-writing agent rules" / mocking-policy block to root `CLAUDE.md`
    (e.g. under "Key Constraints" or a new "## Testing agent policy" section) capturing the
    over-mocking guidance: prefer real objects; mock only I/O / clock / unimplemented seams; NEVER
    mock the Drizzle db in `.it.test.ts`; reviewer-core tests inject `FakeLlmProvider` and assert on
    parsed structure; no snapshot tests of dynamic LLM output. Keep it terse and consistent with the
    existing table-driven style of `CLAUDE.md`. **This task is optional** — include only if the
    maintainer wants the policy centralized; otherwise the policy lives solely inside
    `test-writer.md` (T1) and this task is dropped with no downstream impact.
  - **Module:** n/a (meta)
  - **Type:** ui (Markdown doc authoring)
  - **Skills to use:** engineering-insights
  - **Owned paths:** `CLAUDE.md`
  - **Depends-on:** T1 (so wording matches the test-writer agent's rules); independent of T5 (different file)
  - **Risk:** medium (touches a root project-instruction file every session reads; scope-flagged optional)
  - **Known gotchas:** Root `CLAUDE.md` is loaded into every Claude session — keep additions minimal
    and non-contradictory with existing "Test split" guidance (`*.it.test.ts` = integration). Do not
    reformat or reorder existing sections. Append-only.
  - **Acceptance:** If executed: `grep -iE 'mock|test-writing|FakeLlmProvider' CLAUDE.md` shows the new
    block; existing "Test split" and "Commands" sections are byte-unchanged except for the appended
    block; the block does not contradict the `.it.test.ts` integration convention. If dropped: no
    change to `CLAUDE.md` and the policy is fully present in `test-writer.md` (verified in T1).

## Testing strategy
There is no product code to unit/integration/e2e test here — the deliverables are agent Markdown.
"Tests" are static verification commands run from the repo root:

- **Frontmatter validity (all four files):** for each new file, confirm it starts with `---`,
  contains `name:`, `description:`, `model:`, `tools:` and a closing `---`. A YAML parse check, e.g.
  `for f in test-writer architecture-reviewer plan-verifier doc-writer; do
  awk 'NR==1{if($0!="---"){print "BAD "FILENAME; exit}}' .claude/agents/$f.md; done`.
- **`name` matches filename (R5):** `for f in test-writer architecture-reviewer plan-verifier
  doc-writer; do grep -qE "^name: $f$" .claude/agents/$f.md || echo "NAME MISMATCH $f"; done` →
  no output.
- **Tool access correctness (R1–R4):**
  - read-only agents have NO write tools:
    `grep -E '^tools:.*(Edit|Write)' .claude/agents/architecture-reviewer.md .claude/agents/plan-verifier.md`
    → no matches; architecture-reviewer additionally has no `Bash`.
  - write agents have `Write`:
    `grep -E '^tools:.*Write' .claude/agents/test-writer.md .claude/agents/doc-writer.md`
    → both match.
- **Skill existence (R6):** for every `skills:` entry across all four files, the directory
  `.claude/skills/<name>/` must exist; no entry may be outside the valid 14-skill set; none of those
  skills sets `disable-model-invocation: true` (verified at plan time — none do).
- **Required body sections (R5):** each file contains `## Hard rules` and `## Output format`
  (`grep -c '## Hard rules' …` and `grep -c '## Output format' …` ≥ 1 each).
- **README wire-up (R7):** 4 new table rows + 4 new `## <agent>` sections + all source URLs present
  (per T5 acceptance).

## Risks & mitigations
- **Skill name typo in `skills:` blocks preloading silently** → R6 acceptance greps every entry
  against `.claude/skills/<name>/`; only the validated 14-skill set is allowed.
- **A preloaded skill having `disable-model-invocation: true` would block preloading** (README's own
  "Adding a new agent" note) → verified at plan time that none of the 14 skills set it; T-level
  acceptance re-checks the listed skills exist. If a future skill sets that flag, the agent's
  `skills:` entry for it must be removed or the flag cleared.
- **README sections drifting from the actual agent files** (claiming wrong model/tools/skills) → T5
  depends on all of Phase 1 and the implementer must read each agent file before writing its section.
- **Read-only agents accidentally given write/Bash tools** → explicit negative greps in acceptance
  (`architecture-reviewer` = exactly `Read, Glob, Grep`; `plan-verifier` = `Read, Glob, Grep, Bash`
  with no `Edit`/`Write`).
- **Root `CLAUDE.md` edit (T6) bloating the always-loaded context or contradicting existing rules** →
  task marked OPTIONAL and append-only; acceptance checks existing sections stay unchanged and the
  block does not contradict the `.it.test.ts` convention. Maintainer may drop T6 with zero downstream
  impact (policy still lives in `test-writer.md`).
- **Out-of-scope temptation:** these agents *reference* product-module docs but the implementer must
  NOT create or edit anything under `server/`, `client/`, `reviewer-core/`, `e2e/`, or
  `@devdigest/shared`. Any missing referenced doc is a finding, not a fix.

## Red-flags check
- [x] Every requirement maps to a task — R1→T1, R2→T2, R3→T3, R4→T4, R5→T1–T4 (frontmatter/body
      conventions), R6→T1–T4 (skill-existence acceptance), R7→T5, R8→T6 (optional).
- [x] Dependencies form a DAG (no cycles) — T1–T4 have no deps; T5 depends on T1–T4; T6 depends on T1.
      No cycles.
- [x] Concurrent tasks have non-overlapping Owned paths — T1–T4 each own one distinct file; Phase 2
      T5 (`README.md`) and T6 (`CLAUDE.md`) own different files and both follow Phase 1.
- [x] Every Acceptance is measurable — each task lists concrete `grep`/`test -d`/parse commands with
      expected results.
- [x] No edits to existing shared contracts without an explicit callout — no `@devdigest/shared`
      contract is touched; the only shared files edited are `.claude/agents/README.md` (T5) and
      optionally root `CLAUDE.md` (T6), both called out and sequenced after Phase 1.
