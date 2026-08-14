# Skills

**Status:** shipped
**Packages touched:** server, client, reviewer-core, e2e

## Problem

An agent's only lever today is its `system_prompt` — one free-text blob per
agent. Two agents that should share the same rule (a severity rubric, a
secret-leakage gate) have to each carry their own copy, and the copies drift.
There is no unit of review guidance that exists independently of the agent that
uses it.

The scaffolding for the missing unit is already in the repo and is inert:

- `skills`, `skill_versions`, `agent_skills` exist in the schema
  (`server/src/db/schema/skills.ts`, `agents.ts:51`) and nothing writes to them.
- `Skill`, `SkillType`, `SkillSource`, `AgentSkillLink` exist in
  `@devdigest/shared` (`contracts/knowledge.ts:114`).
- `GET`/`POST /agents/:id/skills` exist and work
  (`server/src/modules/agents/service.ts:138`).
- `assemblePrompt` accepts a `skills` slot and renders a `## Skills / rules`
  section (`reviewer-core/src/prompt.ts:43`, `:109`).
- Every string the UI needs is already written (`client/messages/en/skills.json`,
  `agents.json` → `editor.tabs.skills`, `skills.*`).

**The load-bearing gap is one line deep:** `run-executor.ts` never passes
`skills` to `reviewPullRequest` (`:190`) and writes `skills: null` into the run
trace (`:431`). Skills are stored and versioned into `agent_versions.config_json`
but have never reached a model. Everything else in this spec is the UI and CRUD
needed to make that pipe worth opening.

## Scope — in / out

**In**

- Server CRUD over `skills`, workspace-scoped, DB as source of truth. Editing a
  body writes an immutable `skill_versions` row and bumps `skills.version`.
- Import of a markdown file or a zip archive, through a preview that must be
  confirmed before anything is persisted.
- A Skills page: card grid (name, type, description, enabled toggle), side
  preview on click, add menu with create / import.
- A Skills tab in the agent editor: attach/detach, reorder, "N of M enabled".
- Resolved skill bodies reaching the prompt, in the agent's configured order,
  and appearing as their own block in the run trace with an estimated token cost.
- Two new agents — Test Quality Reviewer, API Contract Reviewer — each with
  skills linked, at least one of which arrives through the import flow.

**Out**

- Import from URL and the community catalog. The i18n copy for both already
  exists (`skills.json` → `url.*`, `community.*`) and the drawer will show the
  tabs disabled. URL import is a server-side fetch of a user-supplied address —
  an SSRF surface that wants its own allow-list, size cap and timeout, and is
  not worth opening for this feature. The community tab has a `CommunitySkill`
  contract but no catalog behind it.
- Skill-level evals, skill diffing across versions, cross-workspace sharing.
- Any per-agent enable state distinct from attachment — see below.

## Contract changes

`@devdigest/shared` first, then consumers. The two vendored copies
(`server/src/vendor/shared`, `client/src/vendor/shared`) are independent files
with no sync script; `scripts/check-contracts.sh` gates the drift and the server
copy is canonical.

- `knowledge.ts` — add `CreateSkillBody`, `UpdateSkillBody`,
  `SkillImportPreview`. `Skill` itself is unchanged.
- `trace.ts` — `PromptAssembly` gains per-section size metadata so the trace can
  report what the skills block cost. Existing `skills: string | null` stays.

## Decisions

Five choices where the requirements, the mockups and the code disagreed with
each other. Recorded here because the reasoning is not recoverable from the
diff.

### Skill bodies render flat, and `enabled` is the gate

A skill body goes into the prompt as instructions — not wrapped in
`<untrusted>`. This contradicts `reviewer-core/AGENTS.md` ("untrusted content
must be fenced with `wrapUntrusted()`") and contradicts the i18n copy, which
promises pasted content is "wrapped as untrusted data — never executed as
instructions" (`skills.json` → `file.bodyHint`).

Both are wrong for this feature, and the reason is mechanical: `INJECTION_GUARD`
tells the model that everything inside `<untrusted>` is data and never an
instruction (`prompt.ts:16`). A skill wrapped that way cannot change model
behaviour by construction — which would make the control experiment
("without skills → miss, with skills → flags it") return zero difference by
design, and would make the whole feature decorative.

The trust boundary moves to `enabled` instead. An imported skill is stored with
`enabled = false` and contributes nothing to any prompt until a human reads the
preview and turns it on. The UI carries the "untrusted source" badge and the
vetting notice that `skills.json` → `preview.untrustedNotice` already spells out.
This is an honest trade and it must be said out loud: **enabling someone else's
skill puts someone else's instructions in your agent's prompt.** The gate is a
human, not a delimiter.

`file.bodyHint` should be reworded to match what actually happens.

### Attachment *is* per-agent enablement

`agent_skills` is `(agent_id, skill_id, order)` — there is no `enabled` column.
The requirement lists "прив'язка, увімкнення/вимкнення, зміна порядку" as three
operations, which reads like a fourth column is needed.

It is not. The existing copy already settles it: `agents.json` →
`skills.orderHint` says "Toggle to attach", and `skills.enabledCount` is
"{linked} of {total} enabled" — linked and enabled are the same number. The
mockup agrees: one checkbox per row. So the checkbox attaches, and no migration
is needed.

Global `skills.enabled = false` is the second gate and wins over attachment: a
disabled skill is skipped at prompt-assembly time even where it is linked, so
turning one off kills it everywhere at once without unlinking it from anything.

### Reorder uses dnd-kit

The mockup shows drag handles and the client has no drag-and-drop dependency.
Adding `@dnd-kit/core` + `@dnd-kit/sortable` matches the design directly. The
cost is real and worth naming: drag interactions are close to untestable under
jsdom, so the ordering *logic* must live in a pure exported function that is
unit-tested on its own, with the drag wiring left as a thin, untested shell.

### Token cost is an estimate, and is labelled as one

`## Skills / rules` has no token number anywhere today — the engine counts
tokens once per LLM call, with no per-section attribution (`prompt.ts` records
section text only).

`assemblePrompt` will report each section's character count, and the UI derives
`≈ chars / 4` tokens **labelled as an estimate**. A real tokenizer was rejected:
it is a heavy dependency in a package whose stated contract is purity, and the
OpenAI tokenizer is wrong for the DeepSeek and Anthropic models this repo
actually runs. The estimate is only ever used to explain a delta, and the run's
real `tokens_in` sits next to it in the same trace.

### Two new agents, not one

The requirement names one new agent under "Новий агент" but its control
experiment and its final checklist both need two. Building both: Test Quality
Reviewer and API Contract Reviewer.

## Acceptance criteria

1. A skill can be created and edited in the UI; editing the body produces a new
   `skill_versions` row and bumps `skills.version`.
2. Skills are reusable — one skill linked to two agents, edited once, changes
   both agents' prompts.
3. The agent editor's Skills tab attaches, detaches and reorders; the order in
   the UI is the order of the blocks in the assembled prompt.
4. An enabled, linked skill appears in the run trace as its own block with its
   estimated token cost. A disabled or unlinked one appears nowhere in the trace.
5. Import accepts a `.md` file or a `.zip`, shows a preview, and persists only on
   confirmation. Executable entries in an archive are never read or run — the
   extractor takes markdown and ignores everything else.
6. Test Quality Reviewer and API Contract Reviewer both exist with skills linked,
   and at least one of those skills arrived through the import flow.
7. Control experiment, both agents: the same PR reviewed with skills off and on
   produces a miss in the first case and a finding in the second.
8. `pr-self-review` still runs manually and picks up both frontend and backend
   skills.

## Open questions

- `skills.evidence_files` exists on the table and in the `Skill` contract but has
  no producer here. It is presumably for `source: 'extracted'` skills promoted
  from the conventions scanner ("Accept as Skill", `conventions.json` →
  `card.acceptAsSkill`). Left `null` by this feature; whoever builds the
  conventions lesson owns it.
- Skill deletion when an agent still links it: the FK cascades, so the link
  vanishes silently and that agent's prompt quietly changes. Acceptable while
  the workspace is single-user; revisit if agents ever outlive their author.
