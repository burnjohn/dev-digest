# Conventions

**Status:** shipped
**Packages touched:** server, client

## Problem

Turning a skill into an agent's prompt is now solved (`specs/01-skills.md`),
but writing a skill's body still starts from a blank page. A repo's own house
conventions — naming, error handling, layering — already exist as evidence in
its code; nothing surfaced them.

Most of the scaffolding was already in the repo and inert:

- `conventions` DB table existed, missing `category` and evidence line-range
  columns (`server/src/db/schema/knowledge.ts:31`).
- `ConventionCandidate` existed in `@devdigest/shared`, missing the same two
  fields (`contracts/knowledge.ts:261`).
- `container.repoIntel.getConventionSamples(repoId, n)` — top-N ranked
  source files, junk-filtered — already worked
  (`server/src/modules/repo-intel/service.ts:630`).
- `SkillType` already included `'convention'`; `FeatureModelId` already
  included `'conventions'` (defaulted to `openai/gpt-5.4` — not cheap).
- `client/messages/en/conventions.json` had the page copy already written.
- reviewer-core's `toJsonSchema`/`parseWithRepair`/`OpenRouterProvider` were
  generic structured-output helpers, reusable without a diff.

**The load-bearing gap:** no route, service, repository, or extraction
pipeline existed to call the pieces above.

## Scope — in / out

**In**

- `POST /repos/:id/conventions/extract` — one synchronous pass: config files
  (eslint/tsconfig/prettier, read directly off disk, no model call) + top-12
  ranked source files (`getConventionSamples`) → one cheap-model call
  (`openrouter/deepseek-v4-flash`) → a code-level evidence gate → persisted.
- `GET /repos/:id/conventions` — the current scan, no LLM call.
- `PATCH /conventions/:id` — accept/reject (`{ accepted }`) and/or edit a
  candidate's own prose (`{ rule, category }`), independently or together.
- The evidence gate (`server/src/modules/conventions/extract.ts,
  verifyEvidence`): a candidate survives only if `evidence_path` exists in the
  clone and `evidence_start_line..evidence_end_line` is in-bounds. On success,
  `evidence_snippet` is **overwritten** with the real on-disk lines — never
  the model's paraphrase. Mirrors reviewer-core's `groundFindings` in spirit
  (mechanical gate, kept/dropped-with-reason), grounding against a file on
  disk instead of a diff hunk.
- Re-scan semantics: `accepted = false` rows for the repo are deleted before
  the fresh insert; `accepted = true` rows are untouched. A user's accept
  decisions survive `Re-scan`; stale pending candidates don't pile up.
- Client Conventions page (`/repos/:repoId/conventions`): candidate cards
  (category/rule, evidence `file:line` + snippet, confidence, accept/reject,
  inline rule/category edit), a selection-for-bundle toolbar ("Deselect all" /
  "N of M accepted") layered on top of the persisted `accepted` state, and a
  "Create skill" modal that merges the bundle into one editable markdown body
  + name/description/type/enabled, saved through the **existing** `POST
  /skills` (source: `'extracted'`, trusted per
  `modules/skills/service.ts`'s `FOREIGN_SOURCE` map — no manual re-enable
  step). Linking the new skill to an agent reuses the **existing** Agent
  editor Skills tab / `POST /agents/:id/skills` — not duplicated here.
- Nav entry added to `client/src/vendor/ui/nav.ts`'s "SKILLS LAB" section
  (precedent: `LAB_L02` added the `skills`/`agents` entries the same way).

**Out**

- Generalizing to "many skills from arbitrary findings across the app" — the
  task explicitly framed this as optional ("як варіант"). Deferred; the
  shipped shape is the single-skill merge in the mockup, not a general
  findings→skills pipeline.
- A background-job path for extraction. One bounded LLM call over ~12 files
  and a handful of configs does not need `container.jobs` — see "Open
  questions" below if that stops being true.
- Fuzzy-matching the model's `evidence_snippet` against disk content. The
  simpler and stronger rule shipped instead: once file+line-range are
  confirmed to exist, the snippet is *replaced* with the real excerpt.

## Contract changes

`server/src/vendor/shared/contracts/knowledge.ts`:

- `ConventionCandidate` gained `category: string`, `evidence_start_line: number`,
  `evidence_end_line: number`.
- New `ConventionScan = { sampled_files, scanned_at, candidates }` — the
  response shape for both extract and list.
- New `PatchConventionBody = { accepted?, rule?, category? }` (at least one
  required).

`server/src/vendor/shared/contracts/platform.ts`: `FEATURE_MODELS`'s
`conventions` entry changed from `openai/gpt-5.4` to
`openrouter/deepseek-v4-flash` (mirrors `onboarding`'s default; still
overridable per-workspace in Settings).

## Acceptance criteria

- Extraction against a real cloned repo returns candidates whose
  `evidence_snippet` is byte-identical to the real file at
  `evidence_path:evidence_start_line-evidence_end_line` (verified live against
  this repo's own clone — see conventions.it.test.ts and the module's
  INSIGHTS entry for the walkthrough).
- A candidate whose model-cited line range is out of bounds is dropped before
  it reaches the DB, never partially persisted.
- Accepting, rejecting, and editing rule/category all round-trip through one
  `PATCH` route.
- Re-scanning a repo keeps every `accepted = true` row and replaces every
  `accepted = false` row.
- "Create skill" produces a skill with `type: 'convention'`, `source:
  'extracted'`, `enabled: true`, and it is immediately linkable to an agent
  through the existing Skills tab.

## Open questions

- If sample/config counts grow well beyond ~12 files + a handful of configs,
  the synchronous route may need to move to `container.jobs` (the resync
  pattern in `repo-intel/routes.ts`). Not needed at today's scale.
- `category` is free text, not an enum. If the UI later wants to group/filter
  by category, revisit whether it should be bounded.
