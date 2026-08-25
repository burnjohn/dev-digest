# Development Plan — Phase 4: Generalized evals (lab Крок 7)

**Execution mode:** multi-agent (same pattern as Phase 2/3 — implementer has
no Bash and only writes files; the orchestrating session, which holds Bash
and the Claude Code subscription, runs `npm run typecheck`, `node --test`,
and the one real proof-of-concept eval invocation)

## Context

Phases 1–3 of the `dev-digest-ai-marketplace` extraction are complete: four
plugins are fully extracted and generalized, the marketplace manifest and
GitHub Pages catalog are live. `docs/specs/marketplace-extraction/architecture.md`
still lists one committed-but-unbuilt deliverable: "a generalized subset of
`evals/` behavior evals, stripped of DevDigest fixtures, that exercises the
extracted SDD workflow" (architecture.md:53-55, :131-145), matching lab
Крок 7's validation checklist (`L08/04-hands-on-lab.md:234-266`). Every
`plugins/<name>/evals/` directory is currently empty (confirmed — not even
a `.gitkeep`); this phase creates the eval package and its fixtures.

This is **not** a re-run of `dev-digest/evals` — it is a small, purpose-built
copy of the parts of that engine needed to prove one thing: the extracted
`sdd-engineering` composition, loaded purely from `plugins/**` via the SDK's
local-plugin config (no DevDigest file ever read), behaves per the lab's
behavior checklist, including the negative case.

Working directory: `/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`.

## Load-bearing finding from source research (do not re-derive, use directly)

`dev-digest/evals/src/tasks.ts:47-52`'s `workflowTask` loads the real harness
via `settingSources: ["project"]`, and `dev-digest/evals/src/artifacts/paths.ts`
hardcodes `SKILLS_DIR`/`AGENTS_DIR` as `<repo>/.claude/skills` /
`<repo>/.claude/agents`. **Neither applies as-is to this repo** — there is no
root `CLAUDE.md` or `.claude/` folder here; the four plugins live under
`plugins/<name>/{skills,agents}` and are meant to be loaded the same way
`claude --plugin-dir` loads them (lab Крок 7).

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk@0.3.198`,
`sdk.d.ts:1694-1707`) exposes exactly this as an `Options.plugins` field:

```ts
plugins?: SdkPluginConfig[];
// { type: 'local', path: './my-plugin' }  — currently only 'local' is supported
```

This is the in-process equivalent of stacking four `--plugin-dir` flags. The
generalized `runClaude`/`workflowTask` copy in this phase **must** pass
`plugins: [{type:'local', path: 'plugins/engineering-paved-path'}, ...all four]`
instead of `settingSources: ["project"]`, and must NOT reference
`.claude/skills`/`.claude/agents` anywhere (there is nothing at those paths in
this repo). `settingSources` can stay `[]` (no root CLAUDE.md exists to load
here) — only the `plugins` array does the loading. Verify this field still
exists in whatever SDK version lands in this repo's `package.json` before
relying on it (`grep -n "plugins?:" node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`).

## Modules involved

- New root-level `evals/` package inside `dev-digest-ai-marketplace` (own
  `package.json`, npm — per the repo-wide Stack decision, not pnpm).
- `plugins/sdd-engineering/evals/` — left empty for v1.0.0 (confirmed
  decision; do not populate it in this phase).
- No `dev-digest/**` file changes — this phase is 100% inside the sibling
  `dev-digest-ai-marketplace` repo.

## Constraints

From `docs/specs/marketplace-extraction/architecture.md`:

- **English-only prose**, including code comments, in every committed file
  (architecture.md:587-591) — this applies to the copied eval engine's
  comments and any new case files.
- **No DevDigest-specific reference anywhere** — no `reviewer-core`,
  `@devdigest/shared`, `~/.devdigest/secrets.json`, `server/src/...` path,
  table name, or DevDigest module name in any copied engine file or fixture
  (architecture.md:549-557, the extraction-defect invariant). The dark-mode
  fixture scenario itself was chosen specifically to need none of this
  (architecture.md:140-145).
- **Namespaced cross-plugin references** — any eval prompt that talks about
  a dependency-plugin component must use `<plugin>:<component>` form
  (architecture.md:249-258), matching how the real agents/skills reference
  each other.
- **npm everywhere in this repo** (architecture.md Stack, confirmed) — the
  new `evals/package.json` uses npm scripts and an npm/`package-lock.json`,
  never pnpm, even though `dev-digest/evals` (the source) is pnpm.
- **`${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_SKILL_DIR}` convention**
  (architecture.md:561-566) is not directly touched by this phase (no new
  plugin script is added) — noted only so the implementer does not
  accidentally hardcode a plugin-relative path inside a new eval fixture.
- **No secrets, no absolute local filesystem path in any committed file**
  (architecture.md `SECURITY.md` policy, AC-8) — this applies to the new
  `evals/` package too; use relative paths from `EVALS_DIR`/`REPO_ROOT`
  computed at runtime (mirroring the copied `paths.ts` pattern), never a
  literal `/Users/viptech/...` string in a committed file.
- **Real behavior checklist to cover** (architecture.md:131-145, lab
  Крок 7 `L08/04-hands-on-lab.md:255-264`), at minimum:
  1. `spec-creator` produces a spec without implementation details;
  2. `implementation-planner` reads the given spec rather than inventing
     requirements;
  3. `run-plan` dispatches `implementer`;
  4. the review gate invokes `architecture-review:architecture-reviewer`;
  5. `plan-verifier` checks acceptance criteria;
  6. `workflow-retro` runs only on an explicit request (negative case: does
     NOT run unprompted);
  7. namespaced skills load without warnings;
  8. **negative eval:** the SDD workflow does not activate on an unrelated
     prompt (AC-9, lab's own negative-eval requirement).
- **Fixture scenario is fixed:** "add a dark-mode toggle to a settings
  screen" (architecture.md:140-145) — small, generic UI feature, no
  DevDigest module/table/path named.
- **No `validate.yml` in this phase** — confirmed out of scope (mirrors the
  Phase 3.4 plan's own explicit deferral of this file to "a separate
  initiative"). This phase produces the eval package and fixtures only; CI
  wiring is future work.
- **Real LLM proof-of-concept, confirmed scope:** at least one real,
  subscription-backed run of the negative eval (Крок 7 checklist item 8)
  and at least one real run of a representative positive case (`spec-creator`
  on the dark-mode fixture) must actually execute and pass before this phase
  is considered done. Every other checklist item gets a structurally-valid,
  typed eval case (compiles, follows the `WorkflowCase`/`QualityCase` shape)
  but is not required to be run for real in this phase — mark clearly in
  `evals/README.md` and `evals/CHANGELOG.md` (or equivalent) which cases were
  actually executed against the subscription vs. only structurally validated,
  so a future reader never mistakes "compiles" for "passed."

## Skills the implementer will use

- No `.claude/skills/*` from this session's own harness applies directly
  (this is TypeScript/Node tooling code, not React/Fastify/Drizzle/etc.).
  `security` is worth a light pass on the new `evals/package.json` /
  `.gitignore` additions: confirm no secret/token is hardcoded, `results/`
  (if the copied engine's record-keeping is retained) is gitignored, and no
  `~/.devdigest/secrets.json`-style credential path is invented for a repo
  that ships nothing requiring auth beyond the ambient Claude Code login.

## Ordered steps

1. **Scaffold `evals/package.json`** (npm, `type: module`) with dependencies
   `@anthropic-ai/claude-agent-sdk` (pin to the same major/minor confirmed
   installed in `dev-digest/evals/node_modules` unless a newer patch is
   current) and devDependencies `@types/node`, `typescript`, `vitest`, `tsx`.
   Scripts: `eval` (`vitest run`), `eval:workflow` (`vitest run workflow`),
   `eval:skills` (`vitest run skills`), `eval:agents` (`vitest run agents`),
   `typecheck` (`tsc --noEmit`). Add a minimal `evals/tsconfig.json`
   (`module: "NodeNext"`, `strict: true`, matching the source package's
   settings — read `dev-digest/evals/tsconfig.json` for the exact fields
   rather than guessing).

2. **Copy and adapt the minimal engine subset** from `dev-digest/evals/src/`
   into `evals/src/` in the marketplace repo — copy, then edit each file,
   never a blind byte-for-byte copy:
   - `config.ts` — keep as-is (no DevDigest reference in it); confirm no
     stray comment mentions DevDigest.
   - `runtime/env.ts`, `runtime/run-claude.ts` — copy; `run-claude.ts`'s
     `RunOptions` needs a new optional `plugins?: SdkPluginConfig[]` field
     threaded into the `Options` object passed to `query()`, alongside the
     existing `settingSources` field (do not remove `settingSources` — a
     future case may still want `[]` explicitly). Import `SdkPluginConfig`
     as a type from `@anthropic-ai/claude-agent-sdk`.
   - `artifacts/paths.ts` — rewrite `SKILLS_DIR`/`AGENTS_DIR` away entirely
     (they assume a `.claude/` layout that does not exist here). Replace
     with a `PLUGIN_DIRS` map: `{ "engineering-paved-path": join(REPO_ROOT,
     "plugins/engineering-paved-path"), "research-tools": ..., ... }` for
     all four plugins, and an `ALL_PLUGIN_CONFIGS: SdkPluginConfig[]` built
     from it (`{ type: "local", path }` per plugin) for `workflowTask` to
     pass straight through.
   - `artifacts/load.ts` — adapt `skillContent`/`agentContent` (used by
     `skillTask`/`agentTask` for isolated-content cases, e.g. a
     `spec-creator` content-only check) to read
     `plugins/<plugin>/skills/<name>/SKILL.md` /
     `plugins/<plugin>/agents/<name>.md` given a `(plugin, name)` pair
     instead of the old single-namespace `.claude/skills/<name>`. Decide
     signature change explicitly (e.g. `agentContent("sdd-engineering",
     "spec-creator")`) and update every call site.
   - `tasks.ts` — `workflowTask` drops `settingSources: ["project"]` and
     instead passes `plugins: ALL_PLUGIN_CONFIGS` (from the adapted
     `paths.ts`) plus `settingSources: []`. `skillTask`/`agentTask` keep
     their isolated-content behavior (no on-disk loading), just updated to
     the new `(plugin, name)`-aware `load.ts` signature.
   - `scoring/pattern-match.ts`, `scoring/llm-judge.ts` — copy verbatim (no
     DevDigest reference; verify on read, don't assume).
   - `logging/log.ts` — copy verbatim.
   - `dsl/case.ts`, `dsl/describe.ts` — copy verbatim; `activated()`'s
     `skills/${skill}/SKILL.md` substring check in `case.ts` needs updating
     to match the new `plugins/<plugin>/skills/<name>/SKILL.md` path shape
     used by `filesRead` traces.
   - `records/record.ts` — copy only if the plan keeps persisted
     `results/records.jsonl` output for this phase's proof-of-concept run
     (recommended: keep it, minimal effort, gives an artifact the
     orchestrating session can point to as evidence the real run happened).
     Skip `stats.ts`, `repeat.ts`, `delta.ts`, `benchmark.ts`,
     `compare.ts`, `trend-reporter.ts`, `scaffold.ts`, `skill-quality.ts` —
     none are needed for this phase's scope (one-shot behavior evals, not
     the statistics/repeat/benchmark tooling).
   - `index.ts` — trim the barrel to export only what the copied subset
     provides (`workflowTask`, `skillTask`, `agentTask`, `describeWorkflow`,
     `describeSkill`, `describeAgent`, `runWorkflowCases`, `runSkillCases`,
     `runAgentCases`, `patternMatch`, `llmJudge`, `activated`, case types).
   - Do not copy `runtime/dispatch.ts` / `runtime/run-openrouter.ts` /
     `proxy/` — OpenRouter backend support is out of scope for this phase
     (subscription-only, per the confirmed real-run scope); `skillTask`
     needs a trimmed `runContent` inline (or import `runClaude` directly)
     rather than the full dispatcher.

3. **Write the workflow eval cases** under `evals/workflow/sdd-workflow/`
   (folder name reflects the cross-plugin scenario, mirroring
   `dev-digest/evals/workflow/<scenario>/` shape):
   - `sdd-workflow.eval.ts` — thin: `describeWorkflow("sdd", () =>
     runWorkflowCases(cases))`.
   - `sdd-workflow.cases.ts` — `WorkflowCase[]` covering, at minimum, the
     eight checklist items above. Suggested `kind` mapping:
     - item 3 (`run-plan` → `implementer`): `kind: "dispatch"`,
       `expectSubagent: "implementer"`.
     - item 4 (review gate → `architecture-reviewer`): `kind: "dispatch"`,
       `expectSubagent: "architecture-reviewer"` (or `"trace"` if asserting
       alongside `plan-verifier` in one session is cheaper — case author's
       call, document which).
     - item 6 (`workflow-retro` only on explicit request): two
       `kind: "activation"` cases — positive (explicit "/workflow-retro" or
       equivalent request) and a near-miss negative (a prompt about the
       same workflow's outcome that must NOT trigger a retro).
     - item 8 (negative eval, AC-9): `kind: "activation"` with
       `shouldActivate: false` against a plainly unrelated prompt (e.g.
       "what's a good weeknight dinner recipe"), or a `kind: "trace"` case
       asserting `expectSubagents` stays empty and no `sdd-engineering:*`
       skill fires.
     - items 1, 2, 5, 7 (spec quality, plan fidelity, plan-verifier
       acceptance-criteria check, namespaced-skill-load-without-warnings)
       are harder to express as pure trace assertions — use `kind: "trace"`
       combined with a `patternMatch`/judged follow-up only if the DSL
       supports it cleanly, or fall back to a `skillTask`/`agentTask`
       quality case per component (e.g. a `spec-creator` `QualityCase` in
       `evals/agents/spec-creator/` asserting via `llmJudge` that the
       produced spec contains no implementation-detail language). Document
       in the case file's comment which checklist item each case maps to —
       do not leave the mapping implicit.
   - All prompts use the dark-mode-toggle scenario
     (architecture.md:140-145) as the shared fixture; put the fixture prompt
     text in `evals/workflow/sdd-workflow/fixtures/dark-mode-request.ts` (a
     single exported string) so every case that needs it imports the same
     text rather than re-typing it with drift risk.

4. **Write `evals/README.md`** (new, this package's own, distinct from the
   repo root `README.md`) describing: what this package is, how to run it
   (`npm ci && npm run typecheck && npm run eval:workflow`), the
   subscription-only scope (no OpenRouter backend copied), and — per the
   confirmed real-vs-structural split — an explicit table of which cases
   were actually run for real against the subscription during this phase
   (expect: the negative-activation case + the `spec-creator` dark-mode
   case) versus which are structurally valid only (typechecked, not
   executed). Cross-reference `dev-digest/evals/README.md` as the source
   engine, one sentence, so a future reader knows where to look for the
   full statistics/repeat/delta/benchmark tooling this subset deliberately
   drops.

5. **Update root `README.md`** (`dev-digest-ai-marketplace/README.md`) with
   a short "Evals" section pointing at `evals/README.md`, mirroring the
   existing "CI" section's style (brief addition, not a rewrite).

6. **Update `plugins/sdd-engineering/evals/` disposition** — leave it empty;
   if the implementer finds it doesn't exist as a directory at all (git
   doesn't track empty dirs), do not create it either; note in the eval
   package's README that per-plugin `evals/` is intentionally unused for
   v1.0.0 and the root `evals/` is the single source of behavior coverage
   (matches the confirmed answer to design question 2).

## Test plan (split real vs structural, per the confirmed scope)

Run from `/Users/viptech/dev/ai agent/dev-digest-ai-marketplace/evals`,
executed by the **orchestrating session** (has Bash + the Claude Code
subscription), not the implementer:

- **Structural gate (must pass, no LLM call):**
  ```sh
  npm ci
  npm run typecheck        # tsc --noEmit — catches the SdkPluginConfig import,
                            # the load.ts signature change, and every case file
  ```
  A pass means every copied/adapted engine file and every case file compiles
  against the real installed SDK types (including the `Options.plugins`
  field confirmed in `sdk.d.ts:1707`).

- **Real proof-of-concept run (must pass, real subscription call, minimal
  count per the confirmed scope):**
  ```sh
  npx vitest run workflow/sdd-workflow -t "does not activate"   # the negative case (AC-9)
  npx vitest run agents/spec-creator                             # or wherever the dark-mode
                                                                  # spec-creator case lives
  ```
  A pass means: (a) the negative case shows `shouldActivate: false` holds —
  no `sdd-engineering:*` subagent/skill trace on an unrelated prompt loaded
  purely from `plugins: ALL_PLUGIN_CONFIGS`; (b) the `spec-creator` case's
  judged output scores at/above its threshold on the dark-mode fixture.
  Inspect `results/records.jsonl` (if `record.ts` was kept per step 2) as
  the durable evidence artifact for both runs.

- **Everything else (structurally valid, not executed for real this
  phase):** confirm via `npm run typecheck` only; do not run
  `npm run eval:workflow` end-to-end in this phase unless the orchestrating
  session decides the extra subscription cost is worth it — the confirmed
  scope caps the real-run requirement at the two cases above.

- **Manual local plugin-dir smoke test (Крок 7, orchestrating session only,
  not an automated eval, not dispatched to any agent):**
  ```sh
  cd "/Users/viptech/dev/ai agent/dev-digest-ai-marketplace"
  claude plugin validate ./plugins/sdd-engineering
  claude plugin validate .
  claude \
    --plugin-dir ./plugins/engineering-paved-path \
    --plugin-dir ./plugins/research-tools \
    --plugin-dir ./plugins/architecture-review \
    --plugin-dir ./plugins/sdd-engineering
  ```
  Inside that session, manually walk the same eight-item checklist from
  Constraints above on a live dark-mode-toggle request, plus an unrelated
  prompt for the negative case. This is a manual sanity pass complementing
  the automated eval proof-of-concept above — it is the orchestrating
  session's own follow-up, not something written into this plan's
  "Ordered steps" for the implementer, and not blocked on this plan's file
  changes landing first (it can happen before, during, or after, as a
  parallel confirmation).

## Out of scope

- `.github/workflows/validate.yml` — confirmed deferred to a separate
  initiative (matches the Phase 3.4 plan's own deferral).
- `plugins/sdd-engineering/evals/` population — confirmed empty for v1.0.0.
- Running the full behavior checklist for real against the subscription —
  confirmed scope caps real execution at one negative + one representative
  positive case; the rest stay structurally-valid-only until a later phase
  or the cost-baseline experiment (lab Крок 8, separate initiative) needs
  them run for real anyway.
- OpenRouter backend / LiteLLM proxy support — not copied in this phase.
- Statistics tooling (`repeat`/`delta`/`benchmark`/`compare`/`scaffold`) —
  not copied; this phase's eval set is small enough not to need it yet
  (mirrors `evals/README.md`'s own deferred-until-~15-20-cases guidance).
- Architecture and security review of the new `evals/` package are not part
  of this plan or the implementer's job — they belong to separate review
  agents, same as every other phase in this initiative.
