# Development Plan — DevDigest AI Marketplace extraction: Phase 2, step 4 (`sdd-engineering` plugin)

**Execution mode:** multi-agent (lightweight)

> **WORKING DIRECTORY FOR EXECUTION:** `/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`
> — **not** `dev-digest`. Read-only sources:
> `/Users/viptech/dev/ai agent/dev-digest/.claude/agents/{spec-creator,
> implementation-planner,implementer,plan-verifier}.md` and
> `/Users/viptech/dev/ai agent/dev-digest/.claude/skills/{sdd-implement,
> workflow-retro,engineering-insights}/**`. **Run this sub-plan last** —
> `sdd-engineering`'s `plugin.json` declares dependencies on all three prior
> sub-plans' plugins (`engineering-paved-path`, `research-tools`,
> `architecture-review`), and this rewrite repeatedly needs to cite their
> final namespaced component names, which only exist once sub-plans 1–3 are
> committed.

## Context

Fourth and last of the sequential Phase 2 sub-plans, and the largest: four
agents (`spec-creator`, `implementation-planner`, `implementer`,
`plan-verifier`) plus three skills (`run-plan` — extracted from
`sdd-implement`, renamed per the architecture spec's explicit decision;
`workflow-retro`; `engineering-insights`). `doc-writer` and `test-writer`
are **not** extracted (architecture spec decision,
`docs/specs/marketplace-extraction/architecture.md:66-77`) — `run-plan`'s
rewrite must drop both, not just the opt-in `test-writer` mention but the
`doc-writer` Step 3 entirely.

Research already done, split by editorial weight:

**Already close to generic** (light pass): `plan-verifier.md` — full read
confirmed zero DevDigest references, no hidden language mandate.
`researcher.md`-adjacent agents were handled in sub-plan 2, not here.

**Light-to-moderate pass** (point references to genericize, not full
rewrites): `spec-creator.md`, `implementation-planner.md` — both reference
`server`/`client`/`reviewer-core`/`e2e`/`TESTING.md`/
`server/src/vendor/shared` as illustrative examples of "which module" a
task touches. These need the *concept* kept (a spec/plan should ask "which
part of the codebase does this touch") but the specific DevDigest module
names replaced with a generic instruction to discover the target project's
own module/package layout rather than assuming these five names exist.

**Heavy rewrite** (confirmed via full `Read` during planning): four files,
each for a different reason:

1. **`spec-creator.md`** — the `# Language` section (lines 47–60, and
   reinforced again at lines 155,173–174) mandates **"Specs are written in
   Ukrainian by default... per the root `CLAUDE.md` language convention"**.
   This is a hidden-language-mandate a grep for DevDigest terms would catch
   here only incidentally (it happens to also cite "root `CLAUDE.md`"); a
   version of this same instruction with no DevDigest noun would slip past
   entirely — this is the pattern the content-review pass (Step 5) exists
   to catch generally, not just in this one file.
2. **`implementer.md`** — Step 1 hardcodes `server/src/modules/**`,
   `server/src/adapters/**`, `server/src/platform/container.ts`,
   `reviewer-core/src/**` as the trigger for auto-invoking
   `onion-architecture` by bare name (must become
   `engineering-paved-path:onion-architecture`, and the trigger paths must
   become generic/discoverable rather than these five hardcoded globs);
   references root `CLAUDE.md`'s specific do-not-touch list (migrations,
   schema tables, lockfiles, `agent-runner/dist/`, the grounding gate, the
   injection guard) as if every consumer has the same list — must become "a
   consuming project's own do-not-touch list, if it has one, discovered
   from its own instructions"; references `TESTING.md`'s DevDigest-specific
   package-manager split (`pnpm` for server/client, `npm` for
   reviewer-core/e2e) and the specific `.it.test` Docker-skip behavior —
   must become generic ("use the target project's own test documentation as
   the source of truth for commands"); cites a DevDigest-internal plan file,
   `.claude/plans/agent-orchestration-token-efficiency.md`, as the source of
   a specific claim about `Bash`-unavailable substitution being costly —
   this citation must be either dropped (keep the rule, drop the
   nonexistent-in-this-repo file citation) or reworded as a general
   observation without a broken link; invokes `pr-self-review` by name at
   the end of Step 3 — **not extracted** into this marketplace, must be
   dropped or reworded conditionally ("if the project has a PR-hygiene
   skill installed").
3. **`engineering-insights/SKILL.md`** — the "Pick the target file" table
   (line 48 area) hardcodes `client/**` → `client/INSIGHTS.md`, `server/**`
   → `server/INSIGHTS.md`, `reviewer-core/**` → `reviewer-core/INSIGHTS.md`,
   `e2e/**` → `e2e/INSIGHTS.md` — must become a generic rule ("write into
   the `INSIGHTS.md` of whichever module/package the work actually
   touched, or the repo root if it spans several, or the repo root if the
   project has no per-module split at all"). Also contains an **Entries are
   written in Ukrainian** instruction (line 60) — another hidden-language
   mandate, delete entirely. The worked example later in the file
   (`Доказ: server/src/db/migrations/0010_ingest_idx.sql:3`) is itself
   written in Ukrainian and cites a DevDigest path — replace with a
   generic, English-language worked example.
4. **`run-plan`** (extracted from `sdd-implement/SKILL.md`) — references a
   DevDigest-internal file that isn't extracted,
   `.claude/agents/README.md`'s "Хендоф" section, twice (as the source of
   "the full agent-chain rationale" and again for the `doc-writer`
   skip-rule) — both citations must be removed since that file has no
   marketplace equivalent; the entire `doc-writer` Step 3 must be deleted
   (not just made conditional — the architecture spec's decision is a full
   drop for v1.0.0, not a demotion to optional); every `test-writer`
   reference must be deleted the same way (already effectively opt-in-only
   in the source, but the source's own "Not included, by design" framing
   still names both `doc-writer` and `test-writer` as things that *could*
   come back — reword so this reads as "not part of this skill" without
   implying a config knob that doesn't exist in the rewritten version);
   `pr-self-review` reference at line 127 ("same severity philosophy as the
   `pr-self-review` skill") must be dropped or reworded, not extracted.

Additionally found (grep for "Ukrainian"/"Language" across the whole
`.claude/skills` tree during sub-plan 3's research, applies here too):
**`workflow-retro/SKILL.md:132`** — "**The report is written in
Ukrainian** — headers, prose and table content" — a fourth instance of the
hidden-language-mandate pattern, in a file this sub-plan also extracts.
Delete this instruction; the report format itself (headers/structure)
should stay as-is, just not mandated to be in Ukrainian.

This confirms, going into Step 5, that **content-review is the single
highest-value step in this entire Phase 2** — four separate files across
three of the four sub-plans carried a hidden language mandate that no
DevDigest-term grep would reliably catch, and this sub-plan alone accounts
for three of those four.

## Modules involved

`dev-digest-ai-marketplace` only: `plugins/sdd-engineering/**`. Reads
(never writes) the six `dev-digest/.claude/{agents,skills}/**` source paths
listed above. Also reads the final committed state of
`plugins/engineering-paved-path/**`, `plugins/research-tools/**`,
`plugins/architecture-review/**` (from sub-plans 1–3) for namespaced
component names to cite correctly.

## Constraints

- Architecture spec, per-plugin composition table —
  agents `spec-creator`, `implementation-planner`, `implementer`,
  `plan-verifier`; skills `run-plan`, `workflow-retro`,
  `engineering-insights` (all generalized); depends on
  `engineering-paved-path@^1.0.0`, `research-tools@^1.0.0`,
  `architecture-review@^1.0.0`
  (`docs/specs/marketplace-extraction/architecture.md:112`).
- Architecture spec, `run-plan` naming decision — extract `sdd-implement`'s
  content under the directory name `run-plan`, matching the lab's own
  canonical name; update "Step 0"/"When to use" prose to speak of "a plan"
  generically rather than DevDigest's own plan-file conventions wherever
  DevDigest-specific phrasing is found
  (`docs/specs/marketplace-extraction/architecture.md:114-129`).
- Architecture spec, Module boundaries — `doc-writer` and `test-writer` are
  **not** extracted; this is a deliberate v1.0.0 scope cut, not an
  oversight, and not something to work around by inlining a lighter version
  of either
  (`docs/specs/marketplace-extraction/architecture.md:66-77`).
- Architecture spec, Invariants — every extracted file: no DevDigest
  path/module/table/repo reference (blocking defect, not style);
  English-only prose, no exceptions; namespaced
  `<plugin>:<component>` references for every cross-plugin call, no bare
  names; `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_SKILL_DIR}` for any script path
  (`workflow-retro/collect.sh` is invoked in its own `SKILL.md` via a
  literal relative path `.claude/skills/workflow-retro/collect.sh` in the
  source — this must become `${CLAUDE_SKILL_DIR}/collect.sh` in the
  extracted version, called out explicitly by the architecture spec: "also
  called out for `workflow-retro/scripts/analyze_journals.py` at lab step
  10" — note the spec's own reference names a `scripts/analyze_journals.py`
  path that doesn't match this repo's actual `collect.sh`; treat the
  spec's illustrative filename as describing the *pattern* — any
  script inside this skill, whatever it's actually named — not a literal
  file to look for)
  (`docs/specs/marketplace-extraction/architecture.md:549-566`).
- Architecture spec, Contracts — `plugin.json`:
  ```json
  {
    "name": "sdd-engineering",
    "version": "1.0.0",
    "dependencies": [
      { "name": "engineering-paved-path", "version": "^1.0.0" },
      { "name": "research-tools", "version": "^1.0.0" },
      { "name": "architecture-review", "version": "^1.0.0" }
    ]
  }
  ```
  (`docs/specs/marketplace-extraction/architecture.md:213-223`).
- Architecture spec, Contracts — `COMPATIBILITY.md` pins
  `Claude Code >=2.1.110`; tag convention `sdd-engineering--v1.0.0`
  (`docs/specs/marketplace-extraction/architecture.md:263-276`).
- Lab step 4's editorial checklist (all ten items apply per-file, not just
  once): remove DevDigest-only paths/names; replace repo-structure
  assumptions with explicit inputs; review each agent's `tools`/permissions;
  replace local references with namespaced dependencies; document where the
  workflow creates spec/plan files; describe behavior when no test command
  is found; use `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_SKILL_DIR}`; no
  credentials in any manifest; remove duplication between agent prompts and
  skills (`L08/04-hands-on-lab.md:149-162`).
- No absolute local paths anywhere (AC-8,
  `docs/specs/marketplace-extraction/architecture.md:636-639`).

## Skills the implementer will use

None directly — meta-editorial work on agent/skill-definition files. The
implementer must, however, read the final committed state of sub-plans 1–3
(`plugins/engineering-paved-path/skills/onion-architecture/SKILL.md`,
`plugins/research-tools/agents/researcher.md`,
`plugins/architecture-review/agents/architecture-reviewer.md`) as research
input for correct namespaced references — not a "skill applied" in the
project-skill sense.

## Ordered steps

All paths below are relative to
`/Users/viptech/dev/ai agent/dev-digest-ai-marketplace` unless marked
"(source, read-only)".

### Step 1 — Implementer: scaffold and copy

1. Create `plugins/sdd-engineering/.claude-plugin/`,
   `plugins/sdd-engineering/agents/`, `plugins/sdd-engineering/skills/`.
2. Copy the four agents from `dev-digest/.claude/agents/` (source,
   read-only) to `plugins/sdd-engineering/agents/`:
   `spec-creator.md`, `implementation-planner.md`, `implementer.md`,
   `plan-verifier.md`.
3. Copy `dev-digest/.claude/skills/sdd-implement/SKILL.md` (source,
   read-only) to `plugins/sdd-engineering/skills/run-plan/SKILL.md` (note
   the directory **rename** — `sdd-implement` becomes `run-plan`, per the
   architecture spec's explicit decision).
4. Copy `dev-digest/.claude/skills/workflow-retro/{SKILL.md,collect.sh}`
   (source, read-only) to `plugins/sdd-engineering/skills/workflow-retro/`
   verbatim (rewrite happens in Step 3).
5. Copy `dev-digest/.claude/skills/engineering-insights/SKILL.md` (source,
   read-only) to `plugins/sdd-engineering/skills/engineering-insights/SKILL.md`.

### Step 2 — Implementer: light pass over `plan-verifier.md`

Confirm (already established during planning research): zero DevDigest
references, no hidden language mandate, generic "diff or working tree
against a plan/requirements doc" framing already holds without change. No
rewrite expected; verify on the actual copied file rather than trusting the
research finding blindly.

### Step 3 — Implementer: moderate pass over `spec-creator.md` and `implementation-planner.md`

For both files:
- Replace every literal `server`/`client`/`reviewer-core`/`e2e`/
  `server/src/vendor/shared` module-name list with a generic instruction:
  ask the user (or discover from the repo) which module/package/directory
  the task touches, rather than assuming this specific five-way split
  exists.
- Replace `docs/specs/reviewer-core/architecture.md`-style example paths
  with a generic `docs/specs/<module>/architecture.md` pattern (already
  templated that way in most of the file — just remove the one or two
  concrete DevDigest examples).
- Replace `TESTING.md`-as-DevDigest-file-with-known-structure references
  with "the target project's own test-command documentation, if it has
  one" — genericize, don't assume a file with that exact name exists.
- `spec-creator.md` specifically — delete the entire `# Language` section
  (lines 47–60) and its two reinforcing callbacks (around lines 155,
  173–174: "the trigger keyword when the spec is in Ukrainian" /
  "the Ukrainian ones — the localization only applies to Ukrainian
  output"). Replace with: specs are written in English by default, in
  whatever language the user explicitly requests for that spec. Check the
  rest of the file (especially the EARS section referenced at those lines)
  for any remaining assumption that Ukrainian is the default — the EARS
  localization convention mentioned there was built specifically to
  support a non-English default; once English becomes the default, confirm
  that section still makes sense without a Ukrainian branch to fall back
  from, and simplify it if the branch becomes dead weight.
- Review each file's `tools:`/`disallowedTools:` frontmatter — both already
  block `git commit`/`push`/`reset`/`checkout` generically; no DevDigest
  coupling there, no change needed (per the lab checklist's "review
  tools/permissions" item — this is the "confirm, don't blindly rewrite"
  case).

### Step 4 — Implementer: heavy rewrite of `implementer.md`, `engineering-insights/SKILL.md`, `run-plan/SKILL.md`, `workflow-retro/SKILL.md`

**`implementer.md`**:
- Step 1: replace the five hardcoded trigger globs
  (`server/src/modules/**`, `server/src/adapters/**`,
  `server/src/platform/container.ts`, `reviewer-core/src/**`) and the bare
  `onion-architecture` invocation with: "if the plan names an
  architecture-pattern skill from a dependency plugin (e.g.
  `engineering-paved-path:onion-architecture`), invoke it via that
  namespaced reference even if the plan didn't explicitly list it, using
  that skill's own trigger conditions rather than a hardcoded path list
  local to this agent."
- Replace the root-`CLAUDE.md`-specific do-not-touch example list
  (migrations, "unused" schema tables, lockfiles, `agent-runner/dist/`, the
  grounding gate, the injection guard) with: "respect the do-not-touch list
  in the target project's own root/module instructions, if it has one — ask
  before proceeding if a plan step seems to conflict with a stated
  constraint." Drop the DevDigest-specific `snake_case` wire-contract line
  entirely (project-specific convention, not general).
- Step 2 ("test"): replace the DevDigest-specific `pnpm`/`npm`
  package-manager split and `.it.test` Docker-skip detail with a generic
  instruction: "use the target project's own test documentation (its
  README, CONTRIBUTING guide, or equivalent) as the source of truth for
  which command to run; if the plan is silent and no such documentation
  exists, ask which command to run rather than guessing, and say so
  explicitly rather than silently picking one" — this directly satisfies
  the lab checklist's "describe behavior when no test command is found"
  item, which the source file doesn't currently address at all (it only
  ever assumed `TESTING.md` exists).
- Drop the citation of `.claude/plans/agent-orchestration-token-efficiency.md`
  (nonexistent in this marketplace) — keep the underlying rule ("if `Bash`
  is unavailable, say so and stop rather than simulating a command's
  output") without the broken file reference.
- Step 3: drop the `pr-self-review` invocation (not extracted); keep the
  `engineering-insights` invocation but use its plugin-scoped form,
  `sdd-engineering:engineering-insights` (same-plugin reference — confirm
  with the actual convention Claude Code uses for same-plugin skill
  references; if same-plugin skills are addressed by bare name rather than
  namespaced, use that instead — verify via `claude plugin validate` in
  Step 7 rather than guessing).

**`engineering-insights/SKILL.md`**:
- Replace the "Pick the target file" table's four hardcoded module rows
  with a generic rule: "write into the `INSIGHTS.md` of whichever
  module/package the work actually touched (judged from what was read and
  edited this session, not from the task's nominal description); if the
  project has no per-module split, use a single root-level `INSIGHTS.md`;
  when a finding spans multiple modules, the root file is the right home."
- Delete "Entries are written in Ukrainian" — specs are written in English
  by default per this rewrite's own stance, same as `spec-creator.md`.
- Replace the Ukrainian-language, DevDigest-path worked example
  (`Доказ: server/src/db/migrations/0010_ingest_idx.sql:3`) with a new,
  generic, English-language worked example (invented for illustration only,
  clearly not implying a specific consuming project's real file).

**`run-plan/SKILL.md`** (formerly `sdd-implement`):
- Update the frontmatter `name:` to `run-plan` and rewrite the
  `description:` to drop any DevDigest-specific plan-file-convention
  phrasing (verify none exists beyond the general `.claude/plans/<slug>.md`
  path, which is a Claude Code convention, not a DevDigest one — keep it).
- Delete both citations of `.claude/agents/README.md`'s "Хендоф" section
  (Overview paragraph and the Step 3 skip-rule reference) — no equivalent
  file exists in this marketplace; replace the Overview's rationale with a
  self-contained explanation (the diff-artifact-reuse convention and the
  round-cap rationale can be stated directly in this file instead of
  pointing elsewhere).
- Delete the entire `doc-writer`-related "Step 3" section and its mention
  in "When to use" / Report format — this skill v1.0.0 does not offer a
  docs pass at all, per the architecture spec's decision. Renumber
  remaining steps if needed.
- Delete every `test-writer` reference (the "Cost note", "When to use"'s
  optional-tests mention, Step 0's "include tests" parsing branch, Step 2's
  parallel-dispatch mention, the Report format line) — this is a full drop,
  not a demotion; do not leave a vestigial "not supported yet" comment that
  implies a future toggle exists in this version.
- Drop the `pr-self-review` severity-philosophy citation in Step 2 — reword
  the "minor findings never trigger the loop" rule to stand on its own
  without referencing an unextracted skill.
- Replace every bare `plan-verifier`/`architecture-reviewer`/`implementer`
  reference with the correctly-scoped form: `plan-verifier` and
  `implementer` are same-plugin (`sdd-engineering`) — keep bare or use
  whatever same-plugin convention Step 7's validation confirms;
  `architecture-reviewer` is cross-plugin — must become
  `architecture-review:architecture-reviewer`.
- Update the "Common mistakes" and "Report format" sections to match all of
  the above deletions (no leftover mention of a 4th agent type or a docs
  step that no longer exists).

**`workflow-retro/SKILL.md`**:
- Delete line 132's "**The report is written in Ukrainian** — headers,
  prose and table content" instruction — reports are English by default,
  matching this rewrite's stance everywhere else in this sub-plan. Keep the
  report's structural format (headers/table shape) unchanged, just not
  mandated to be in a specific language.
- Update the `collect.sh` invocation examples (currently a literal relative
  path `.claude/skills/workflow-retro/collect.sh`) to
  `${CLAUDE_SKILL_DIR}/collect.sh` — the architecture spec calls this file
  out by name for this exact fix
  (`docs/specs/marketplace-extraction/architecture.md:563-566`).
- Scan the rest of the file for any other DevDigest-specific assumption not
  already caught by the earlier grep pass (the file wasn't flagged by the
  DevDigest-term grep, so this is a lighter check than `implementer.md`'s,
  but still a full read given the confirmed language-mandate finding at
  line 132).

### Step 5 — Content-review pass (separate dispatch from Steps 1–4's implementer)

This is the highest-value step in the whole Phase 2, per the Context
section's finding (three of the four confirmed hidden-language-mandate
instances live in this sub-plan's files). Dispatch as an independent full
read-through of **every file touched in Steps 1–4** — all seven components
(`spec-creator.md`, `implementation-planner.md`, `implementer.md`,
`plan-verifier.md`, `run-plan/SKILL.md`, `workflow-retro/SKILL.md`,
`engineering-insights/SKILL.md`). For each: does anything reveal DevDigest
origin, or carry an instruction (language mandate, cross-reference to an
unextracted skill/agent/doc, an assumption about repo shape) that doesn't
belong in a general-purpose marketplace component. Given the volume and
density of rewrites in this sub-plan compared to sub-plans 1–3, budget for
this to find at least one residual issue on the first pass — re-run after
fixing until it reports clean. Do not proceed to Step 6 until this reports
clean.

### Step 6 — Implementer: `.claude-plugin/plugin.json`, `COMPATIBILITY.md`, `README.md`, `CHANGELOG.md`

`plugin.json` — exactly the block quoted in Constraints above.

`COMPATIBILITY.md`: `Claude Code >=2.1.110`.

`README.md`: what the plugin ships (the SDD workflow: `spec-creator` →
`implementation-planner` → `run-plan` → `implementer` →
`plan-verifier`/`architecture-review:architecture-reviewer` review gate,
plus `workflow-retro` and `engineering-insights` as supporting skills),
explicit statement that `doc-writer`/`test-writer` are not included in
v1.0.0, its three dependencies and why each is needed (shared engineering
practices, delegated read-only research, independent architecture review),
how to install (`/plugin install sdd-engineering@dev-digest-ai-marketplace`
— note in the README that the installer resolves the three dependencies
automatically), and where in a consuming project this workflow creates
files (`docs/specs/**` for specs, `.claude/plans/**` for plans — lab step 4's
explicit "document where the workflow creates spec/plan" checklist item).

`CHANGELOG.md`: `## 1.0.0 — Initial extraction` + a factual summary: four
agents and three skills extracted from the DevDigest engineering harness;
`sdd-implement` renamed to `run-plan`; `doc-writer`/`test-writer` support
dropped for v1.0.0 (deferred to a possible 1.1.0+, per the architecture
spec's open question); hardcoded DevDigest module names, do-not-touch
lists, and language mandates replaced with generic/discovered equivalents.

### Step 7 — Validation

```
claude plugin validate ./plugins/sdd-engineering
```
Confirm the three `dependencies` entries resolve against the already-committed
`plugins/engineering-paved-path`, `plugins/research-tools`,
`plugins/architecture-review` (sub-plans 1–3) without a schema-level error.
No `--strict` flag. This is also the point to confirm empirically (not by
assumption) whether same-plugin skill/agent references need the
`sdd-engineering:` prefix or resolve bare within the plugin — apply
whatever this validation run confirms consistently across all files touched
in Step 4.

## Test plan

- `claude plugin validate ./plugins/sdd-engineering` exits clean, including
  the three `dependencies` entries.
- `grep -rn "/Users/" plugins/sdd-engineering` returns nothing (AC-8).
- `grep -rliE "devdigest|reviewer-core|@devdigest|server/src|~/.devdigest|pr-self-review|doc-writer|test-writer|Хендоф"
  plugins/sdd-engineering` returns nothing.
- Step 5's content-review pass has run and reported clean (after however
  many fix/re-review cycles it took) — this is the binding pass/fail bar
  for this sub-plan given how much rewriting happened; a green grep alone
  is explicitly not sufficient (per this sub-plan's own Context findings).
- Manual re-read: every cross-plugin reference uses the `<plugin>:<component>`
  namespaced form (`engineering-paved-path:onion-architecture`,
  `research-tools:researcher`, `architecture-review:architecture-reviewer`);
  no file mentions `doc-writer` or `test-writer` as an available or
  future-toggleable option.
- `plugin.json`'s `dependencies` array exactly matches the architecture
  spec's Contracts block (three entries, `^1.0.0` each).

## Out of scope

Architecture and security review are **not** part of this plan. Also
deferred: root `.claude-plugin/marketplace.json` and the combined
`claude plugin validate .` across all four plugins — this is Phase 2's
small step-5 follow-up, run once this sub-plan is committed (not part of
any of the four sub-plan files, per the coordinator's confirmed split);
per-component `evals/` fixtures (Phase 4, generalized evals); the GitHub
Pages catalog (Phase 3); cost baseline (Phase 5); releases/tagging (Phase
6); install rehearsal against `plugin-install-target`; the 1.1.0
`doc-writer`/`test-writer` re-inclusion question (explicitly deferred by
the architecture spec's own open question, not this sub-plan's to resolve).
