# Development Plan: Eval Case Editor redesign (source-aware, two-panel)

**Plan ID:** PLAN-2026-07-06-case-editor-redesign
**Tracks:** journal entry **B7** in `docs/plans/2026-07-06-l06-eval-handoff.md`
**Feature spec basis:** L06 Eval Pipeline (`docs/feature-requirements/2026-07-05-eval-pipeline.md`) — AC-3/4/5/6/7/8/9/24/35
**Scope decision (user, 2026-07-06):** full screenshot incl. Files / PR-meta tabs · expected-output rendered as a finding-skeleton over the existing `Expectation[]` model (no JSON parser, no matching-model change) · expectation type is an editable Select while the header still shows provenance.

---

## 1. Context

The current [CaseEditor](../../client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/_components/CaseEditor/CaseEditor.tsx) is a single-column modal (Name / Diff / raw `Expectation` rows / Notes). It is provenance-blind: whether a case was seeded from an **accepted** finding (`must_find`) or a **dismissed** finding (`must_not_flag`) is invisible, the owning agent is not named, and there is no negative-case affordance, no finding-shaped expected-output view, no in-editor run, and no last-run readout.

Reference design (two screenshots): a two-panel "Eval case · {name}" modal — left = Input with `Diff / Files / PR meta` tabs; right = Expected output as a finding-skeleton (`valid JSON` / `assert empty` badge, `+ Finding skeleton`); a source-aware subtitle; a **NEGATIVE CASE** banner for `must_not_flag`; a `Last run passed · expected 1, got 1 · 1.8s · $0.02` strip; a `Run on save` toggle and a `Run case` button.

This plan reworks the existing modal (edit **and** create modes) to that design, reusing existing mechanisms and adding the minimum backend surface.

## 2. Architecture Fit

- **Client-only** for layout, tabs, source-aware header, negative banner, finding-skeleton view, Files tab (parsed from the diff), PR-meta tab (already in the case item), Run-on-save/Run-case (existing `useRunEvalBatch({case_ids:[id]})` → 202 → poll).
- **Minimal additive backend** for the Last-run strip's duration/cost: `latestRun` (an `EvalRunRow`) already carries `durationMs`/`costUsd`/`matchedCount`/`expectedCount`; expose two new nullish fields on `EvalCaseListItem`.
- Contracts stay **byte-identical mirrors** across `server/` and `client/` `vendor/shared/contracts/eval-batch.ts`; change is **additive/nullish** only (schema-stability rule — no altered columns, no new migration; `eval_runs.duration_ms`/`cost_usd` already exist).
- No change to scoring, grounding, run-orchestrator, or the `Expectation` matching model (AC-19/AC-24 untouched).

## 3. Skills Applied

- `frontend-architecture` / `react-best-practices` — modal state, co-located component, no data-fetching `useEffect`.
- `react-testing-library` — extend `CaseEditor.test.tsx` (userEvent, query priority).
- `typescript-expert` / `zod` — additive contract fields, both mirrors.

## 4. Constraints

- Never commit (user commits). Do not start dev servers (user runs :3001/:3000).
- i18n: every new string via `next-intl` keys in `client/messages/en/agents.json` — no hardcoded copy.
- UI from vendored `@devdigest/ui` only (`Tabs`, `Toggle`, `Modal`, `SelectInput`, `TextInput`, `Textarea`, `Badge`, `Button`, `Icon`). No new deps.
- `SelectInput` must **not** be wrapped in `<label>` (regression B1 — see `client/insights.md`).
- Expected-output edit keeps operating on `Expectation[]`; the finding-skeleton is a presentation layer. A zero-expectation case stays empty when edited (existing `initialCase`-presence branch, #10).
- Contract mirrors must be byte-identical; `EvalCaseListItem` new fields nullish (older runs have no snapshot).

## 5. Implementation Steps

**Phase A — Contract + server (additive, unblock the strip).**
1. `contracts/eval-batch.ts` (both mirrors): add `last_run_duration_ms: z.number().int().nullish()` and `last_run_cost_usd: z.number().nullish()` to `EvalCaseListItem`.
2. `server/src/modules/eval/helpers.ts::caseListItem`: populate both from `latestRun` (null when `never_run`). Do **not** alter existing status/summary logic.

**Phase B — Client modal scaffold (layout + source-awareness).**
3. Pass `agent: Agent` (for the agent name) and rely on `initialCase.source` into `CaseEditor`. Update the `EvalsTab` call sites (`openNewCase`/`openEditCase`).
4. Two-panel layout; header `Eval case · {name}`; subtitle by source/type (manual → "{agent} · simulate a PR and assert the expected output"; finding → "Seeded from an accepted/dismissed finding · assert the expected output").
5. **NEGATIVE CASE** banner when any expectation is `must_not_flag` (text: MUST NOT comment on `{file}:{line}` [{name}]).

**Phase C — Input panel tabs.**
6. `Tabs` with `Diff / Files / PR meta`. Diff = existing textarea (editable for manual, shown for finding). Files = file paths parsed from the diff (`+++ b/…` / `diff --git`), read-only list. PR meta = `source`, `source_pr_number` (GitHub link where resolvable), `source_finding_id`.

**Phase D — Expected-output finding-skeleton panel.**
7. Right panel: badge `valid JSON` (has `must_find`) / `assert empty` (`must_not_flag`-only or empty). `+ Finding skeleton` inserts a row prefilled to mirror a `Finding` (type=`must_find`, file from diff head, severity/category placeholders). Keep the structured row editor (type Select editable, file, line_start/end, remove) beneath/within the skeleton view. Empty state renders the `[]` "assert empty" hint.

**Phase E — In-editor run + Last-run strip.**
8. `Run on save` `Toggle` (footer-left) + `Run case` button (footer): on save (and optionally immediately) call the same single-case run path used by the row (`useRunEvalBatch({case_ids:[id]})`, poll batch detail). New/unsaved case: Run disabled until saved.
9. Last-run strip from `initialCase`: `last_run_summary` + `· {duration_ms/1000}s · ${last_run_cost_usd}` + status word; hidden for `never_run`/new.

**Phase F — i18n + tests.**
10. Add keys under `agents.evals.editor.*` (subtitleManual/subtitleFinding, negativeBanner, tabs.diff/files/prMeta, expected.validJson/assertEmpty, findingSkeleton, runOnSave, runCase, lastRun*, prMeta labels).
11. Extend `CaseEditor.test.tsx`: source-aware subtitle, negative banner for `must_not_flag`, tab switching, finding-skeleton insert, run-on-save wiring, last-run strip; keep the B1 Select regression test.

## 6. Acceptance Criteria

- Editing a `must_find` (accepted) case shows a positive header + finding-skeleton expected output; a `must_not_flag` (dismissed) case shows the NEGATIVE CASE banner + `assert empty`.
- Creating a new case opens the same modal in manual mode: no provenance banner, editable Name/Diff/expectations, type defaults to `must_find`.
- Expectation type is an editable Select; provenance still shown in the header for finding-seeded cases.
- Files tab lists files parsed from the diff; PR-meta tab shows source PR number / finding id.
- Last-run strip shows `expected N, got M · Ns · $C` for a run case; hidden when never run.
- No contract drift (mirrors byte-identical); server + client typecheck clean; `CaseEditor`, `EvalsTab`, `CaseRow` vitest green; scoring/grounding untouched.

## 7. Testing Plan

- `cd server && pnpm typecheck` + eval helper/service targeted vitest (`eval-service`, `eval-scoring` unaffected but run to confirm no regression on `caseListItem`).
- `cd client && pnpm typecheck` + `pnpm exec vitest run CaseEditor EvalsTab CaseRow`.
- Manual (user's :3000): open editor from an accepted finding-seeded case, a dismissed one, and via `+ New eval case`; verify tabs, banner, skeleton, run-on-save, last-run strip.

## 8. Out of Scope

- Any change to the scoring/matching model, grounding, or run-orchestrator (AC-19/AC-24 stay as-is).
- Populating `eval_cases.input_files` server-side (Files tab is derived from the diff, not from stored file snapshots).
- Storing PR title/metadata beyond the existing `source_pr_number` provenance.
- Newer-Anthropic-model empty-output issue (B6-adjacent) and the Export-to-CI track (`eval-ci.ts`).
