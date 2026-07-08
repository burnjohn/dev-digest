# Staff-Engineer Cross-Model Review — PR Why + Risk Brief Plan

**Reviewer:** independent pass (different model family from implementer), read fresh from disk
**Plan reviewed:** [docs/plans/2026-07-03-pr-why-risk-brief.md](2026-07-03-pr-why-risk-brief.md)
**Spec reviewed:** [docs/feature-requirements/2026-07-03-pr-why-risk-brief.md](../feature-requirements/2026-07-03-pr-why-risk-brief.md)
**Date:** 2026-07-03

## Verdict: APPROVE WITH CHANGES

The plan is unusually well-grounded — most of its load-bearing claims about the existing codebase (`upsertBrief`/`getBrief` shape, `PrBrief`/`Risk` contracts, `pr_brief.json` being untyped JSONB, the onboarding precedent, `resolveFeatureModel`, `CircularScore` thresholds, `SymbolImpact.tsx`'s inline `ghBlobUrl`, `wrapUntrusted`'s actual export, `budgetDiff`/`diffBudgetForModel`, `ContextDocsService`'s methods) check out against the real code. But there is one concrete architectural confusion in Step 4 that would send an implementer down a wasteful, duplicative path, one real (if low-probability) race-safety gap in the AC-9/AC-10 merge that needs an explicit mitigating note, and one load-bearing UI precondition (`OverviewTab.tsx`'s current conditional render gate) that the plan never states and Step 9 must handle or AC-14 will silently fail for PRs with no review yet. None of these require re-planning from scratch; they are scoped, fixable notes.

---

## Blocking issues

### 1. Step 4c misdiagnoses `container.blast` as a forbidden cross-module import — will cause the implementer to duplicate `BlastService` logic unnecessarily

**Plan reference:** Step 4, "What to do," item c, bullet 2 (plan lines ~303) and §4 "Project Constraints" bullet 3 (plan lines ~88).

The plan states: *"do NOT import `blast/service.ts` (cross-module forbidden per R6); instead call `container.repoIntel` directly here... If this duplicates a modest amount of `BlastService`'s logic, that is the accepted cost of module isolation."*

This is factually wrong. Checked `server/src/platform/container.ts:139-142`:

```ts
get blast(): BlastService {
  if (this.overrides.blast) return this.overrides.blast;
  this._blast ??= new BlastService(this);
  return this._blast;
}
```

`BlastService` is exposed as a first-class getter **on the Container itself**, exactly like `repoIntel` and `contextDocs`. And `server/src/modules/reviews/run-executor.ts:462` — the exact file the plan's own §1/§8 cites as precedent — already does precisely this from inside the `reviews` module:

```ts
this.container.blast.getBlast(pull.workspaceId, pull.id)
```

`src/modules/AGENTS.md`'s R6 rule ("a module imports only from: its own files · `@devdigest/shared` · `../../platform/container`") is about not importing another module's *internal files* directly (e.g. `../blast/service.js`), not about avoiding the `container.blast` surface — `container` access to another module's service getter is the established, sanctioned cross-module surface in this codebase (mirrors `container.repoIntel`, `container.contextDocs`). The plan's own Step 4 already correctly uses `container.contextDocs.getContextFolders(...)` the same way one paragraph later — it is internally inconsistent about which container getters are "allowed."

**Fix:** Step 4c should call `container.blast.getBlast(workspaceId, prId)` directly (same call `run-executor.ts` makes), reuse its `BlastResponse.blast`/`.history` output as-is, and drop the "reimplement a strict subset via repoIntel" instruction entirely. This removes an entire unnecessary duplication task and a source of drift between two blast-fact computations.

### 2. AC-9/AC-10 merge: read-modify-write on `pr_brief.json` has a real (if narrow) lost-update race — the plan should state the mitigation explicitly, not silently accept it

**Plan reference:** Step 2, `upsertBrief` (lines ~207-219) and `upsertLlmBrief` (lines ~223-246).

Both functions do a plain `select` then a separate `insert...onConflictDoUpdate` / `update`, with no `db.transaction(...)`, no `SELECT ... FOR UPDATE`, and no optimistic-concurrency check (e.g. compare-and-swap on a version/updated_at column). `Db = PostgresJsDatabase<typeof schema>` (confirmed in `server/src/db/client.ts:5`) does support `db.transaction()` — the tool exists, it's just not used here.

Concretely: if a review run completes (`run-executor.ts` → `upsertBrief`) at the same moment a user's Regenerate click completes (`upsertLlmBrief`), both read the same pre-image, and whichever writes second overwrites the other's update — even though each function's *intent* (preserve the other's key) is correct in isolation, the interleaving is:
1. T1 (`upsertBrief`) reads row with `llm: X`
2. T2 (`upsertLlmBrief`) reads row with `intent: Y, blast: Z` (same pre-image)
3. T2 writes `{ ...current, llm: X' }` — correct, preserves `intent`/`blast`/`Y`/`Z`
4. T1 writes `{ ...newDeterministic, llm: X }` — this **clobbers T2's `X'`** with the stale `X` T1 read in step 1, silently reverting a just-completed generation.

This is a genuine lost-update bug, not a false alarm — it is the exact race the spec's AC-9/AC-10 are trying to prevent, and the plan's own hermetic tests (Step 2, Step 10) only exercise the two calls *sequentially*, never concurrently, so this bug would ship untested.

In practice the window is narrow (regenerate and review-completion racing on the *same* PR within milliseconds is rare, and `review-all`'s concurrency cap of 3 is across different PRs, not the same one), so this is not a hard blocker on shipping v1 — but the plan must not present the current design as race-safe when it isn't. Two acceptable resolutions, either is fine for v1:

**Fix (pick one):**
- (a) Wrap each of `upsertBrief`/`upsertLlmBrief`'s read+write in `db.transaction()` with `SELECT ... FOR UPDATE` on the `pr_brief` row (cheapest correct fix, small diff, Postgres row lock naturally serializes the two writers), or
- (b) Explicitly document in Step 2 that this is a known, accepted narrow race (last-writer-wins on the *other side's* field, not on your own), acceptable because a user can simply click Regenerate again / the next review run will re-derive the deterministic fields — i.e., make it a documented risk acceptance, not a silent gap.

Either is acceptable; what is not acceptable is Step 2 asserting the merge is safe (as line 79's Skills section does: "verified backward-compatible parse behavior") without addressing the concurrent-write case at all.

### 3. Step 9's empty-state condition is built on top of an `OverviewTab.tsx` conditional that the plan never names — AC-14 will silently fail for PRs with zero reviews

**Plan reference:** Step 9, item 2, "Empty state" bullet (plan line ~546); AC-14.

Checked the real `OverviewTab.tsx:107-122`:

```tsx
{latest?.verdict && (
  <section>
    <SectionLabel icon="FileText">PR Brief</SectionLabel>
    <VerdictBanner ... />
  </section>
)}
```

Today, the entire PR BRIEF section — including its wrapping `<section>` — is gated on `latest?.verdict` (i.e., "does this PR have at least one completed review"). For a PR with **no review at all yet**, nothing renders in that slot today — not even a placeholder (contrast with the Intent/Blast cards two lines down, which do render explicit "not generated" placeholders when their own data is absent).

The spec's AC-14 requires: *"WHEN neither a generated brief nor an in-progress generation exists for a PR, the PR BRIEF card slot SHALL show the 'No brief yet → Generate brief' empty state — never a blank card."* This scenario is exactly the no-review-yet case (spec §16 edge case: "PR has no prior review / no findings yet" — generation should still be able to proceed from intent/blast/diff-stats alone per AC-2/AC-3).

The plan's Step 9 describes the empty state as conditioned on `!brief?.llm` but never mentions that the *outer* `latest?.verdict` gate must also be removed/restructured for the PR BRIEF slot to render at all in the no-review case. If Step 9 is implemented literally as written (add the empty-state branch inside the existing `{latest?.verdict && (...)}` block), a PR with zero reviews will continue to show nothing in that slot — a direct AC-14 regression that would pass every test the plan lists (since Step 9's own test likely seeds a PR that already has *some* review data) unless the test explicitly covers the zero-review case.

**Fix:** Step 9 must explicitly say: restructure `OverviewTab.tsx`'s top-level PR BRIEF section so it renders unconditionally (empty state / cached state / loading / error), independent of `latest?.verdict`, and add a test case seeding a PR with **no** `runs` at all, asserting the "Generate brief" CTA still renders.

---

## Non-blocking suggestions

1. **Step 6, locale file uncertainty is resolvable with one grep, not left as a TODO for the implementer.** The plan hedges: *"likely `client/messages/en/reviews.json` or similar."* A directory listing shows `client/messages/en/brief.json` already exists as its own file, and `IntentCard.tsx` already calls `useTranslations("brief")`. Update Step 6 to say directly: add keys to `client/messages/en/brief.json`.

2. **Step 4, the enriched-risks merge dedup key (`title`) is fragile and duplicated from `brief-composer.ts`'s `composeRisks`.** The plan already flags this as "acceptable 1-line duplication," which is reasonable, but a same-title risk from a *different* PR run (e.g., a recurring lint finding across regenerations) could silently merge two logically distinct risks. Low risk for v1 given `MAX_RISKS = 6` and the additive nature, but worth a one-line code comment at the merge site cross-referencing `brief-composer.ts:38-39`'s identical dedup choice so a future reader doesn't "fix" one without the other.

3. **Step 5's dependency note is confusing.** It says Step 5 "can be written in parallel with Step 4 by agreeing on `BriefGeneratorService`'s public method signature up front... if strict serialization is preferred instead, treat Step 5 as depending on Step 4." This is presented as a Wave 2 parallel step in the parallelization map but hedges with an alternative serialization path in the prose — pick one explicitly. Given Step 5 imports `BriefGeneratorService` directly (`import { BriefGeneratorService } from './brief-generator.js'`), true compile-time parallelism only works if the file exists as an empty-but-typed stub; recommend just serializing Step 5 after Step 4 to avoid ambiguity — the cost is one wave, not worth the coordination risk.

4. **Step 4's "getLatestFindings" instruction is genuinely underspecified** ("check `reviewsForPull`/`getReview` in `service.ts` first; reuse if a suitable read already exists, else add a minimal `getLatestFindings`..."). Confirmed no such read currently exists in `pull.repo.ts`. This is fine as an instruction (it correctly tells the implementer to check first), but the plan should specify the workspace-scoping join shape (via `reviews.workspaceId` per `server/AGENTS.md`'s stated invariant: *"Every `findingsForReview` call passes `workspaceId` and joins through `reviews.workspaceId`"*) so the new read doesn't accidentally skip scoping — this is a security-sensitive detail worth being explicit about rather than "add a minimal read."

5. **`RiskLevel`'s 4-value enum (`low/medium/high/critical`) mapped onto `CircularScore`'s 2-boundary 3-color scheme** (Step 8, item 3) is a reasonable, explicitly-justified design compromise, but the arbitrary point values (`critical→15, high→40, medium→65, low→90`) are never surfaced anywhere in the UI or API — a future reader of `GET /pulls/:id/brief`'s response sees a `risk_level` string but the rendered gauge number is a fabricated proxy with no stored/returned meaning. Consider a one-line code comment in `VerdictBanner.tsx` (Step 8 already implies this, "documented inline") — just confirming this is worth enforcing in code review, not the plan itself.

6. **`reviewer-core/AGENTS.md`'s public-API table is stale** — it lists `assemblePrompt`, `groundFindings`, etc., but omits `wrapUntrusted` even though `wrapUntrusted` IS exported from `reviewer-core/src/index.ts:17`. This is a pre-existing doc drift bug, not something this plan introduced, but Step 3's fallback logic ("if wrapUntrusted is not publicly exported... inline an equivalent pure function") is written defensively against a state that doesn't actually exist — harmless, but the plan could just assert directly that `wrapUntrusted` is exported (confirmed) and drop the inline-fallback branch to simplify Step 3.

---

## Correctness of the 5 key resolutions

| # | Resolution | Verdict |
|---|---|---|
| 1 | New `llm` JSONB sub-object, no migration | **Correct.** `pr_brief.json` is `jsonb('json').notNull()` with zero Drizzle-level typing (`server/src/db/schema/reviews.ts:57-62`); all typing lives in Zod (`contracts/brief.ts`). Additive `.nullish()` field is genuinely backward-compatible — `PrBrief.parse()` on a pre-existing row without `llm` will succeed. |
| 2 | ≤8K soft-budget, priority drop-order, precedented on `run-executor.ts` | **Precedent confirmed.** `diffBudgetForModel`/`budgetDiff` exist exactly as described at `run-executor.ts:29` and `:736`, core→wiring→boilerplate priority-pack is the real existing pattern. Soft-target (never reject) is a reasonable, spec-compliant choice (§9 explicitly allows "not necessarily a hard reject threshold"). |
| 3 | 3-tier validate-repair-drop | **Sound design**, correctly zero-LLM, deterministic. Only gap: Tier 2's "exactly one `knownFiles` entry shares the basename" is a good conservative rule (avoids ambiguous repairs) but the plan should note what happens when *zero or multiple* files share a basename — the plan implies "no match" but should say so explicitly in Step 3 rather than leaving it to inference. |
| 4 | GitHub-blob-only click target, no internal Files-changed anchor | **Correct**, matches `SymbolImpact.tsx`'s actual existing convention exactly (verified inline `ghBlobUrl` at `SymbolImpact.tsx:16-18`, `target="_blank" rel="noopener noreferrer"` pattern). |
| 5 | Repo-level Context Folder selection, `used_by_agents` desc then alphabetical | **API confirmed to exist** (`ContextDocsService.getContextFolders`, `.listDocuments`, `.getDocumentContent` all present at `context-docs/service.ts:357,89,251`; `used_by_agents: z.number().int().min(0)` confirmed in `contracts/context-docs.ts:22`). Ordering rule itself is an implementation-planner judgment call (spec §17 explicitly defers this) and is reasonable. |

---

## Architecture fit

- **Onion layering**: correctly separated — `routes.ts` (presentation, thin), `brief-generator.ts` (application, orchestration), `pull.repo.ts` (infrastructure, only Drizzle queries). Matches `backend-onion-architecture` conventions.
- **`reviewer-core` side-effect-free**: preserved — the plan does not route through `reviewPullRequest`; only reuses the pure `wrapUntrusted` string function, which is genuinely side-effect-free and already publicly exported. No violation.
- **SecretsProvider**: no direct `process.env` access anywhere in the plan; `container.llm(provider)` is the only path to a provider, consistent with every other LLM-calling module.
- **Shared types in `vendor/shared` only**: all new types added to `contracts/brief.ts`, the existing home for `PrBrief`/`Risk`. No duplication into `client/`.
- **Additive migrations**: correctly zero new migrations — confirmed unnecessary since `json` is untyped JSONB.
- **Workspace scoping**: `BriefGeneratorService.generate()` correctly requires `workspaceId` and calls `pullRepo.getPull(container.db, workspaceId, prId)` first (same as the existing `GET /pulls/:id/brief` route) — consistent with `server/AGENTS.md`'s stated invariant.
- **One real violation-adjacent issue**: Blocking Issue #1 above — the plan's own stated fear of a "cross-module forbidden" import is itself an architecture misunderstanding that, if followed literally, would produce *worse* module coupling (duplicated blast-computation logic in two places) than the simpler, already-sanctioned `container.blast.getBlast()` call.

---

## Multi-agent wave plan — disjointness check

Verified each Wave 1 step's "owned paths" against the other four:

| Step | Owned paths | Overlap risk found? |
|---|---|---|
| 2 | `repository/pull.repo.ts` | None — no other Wave 1 step touches this file. |
| 3 | `brief-generator-helpers.ts`, `test/brief-generator-helpers.test.ts` | None. |
| 6 | `OverviewTab/ReviewFocusCard.tsx`(+test), `OverviewTab/styles.ts` (additive keys) | **Shares `OverviewTab/styles.ts` with Step 7?** No — Step 7's owned paths are `IntentCard.tsx`/`IntentCard.test.tsx` only, not `styles.ts`. Confirmed Step 6 is the only Wave-1 step touching `OverviewTab/styles.ts`. No collision. |
| 7 | `IntentCard.tsx`, `IntentCard.test.tsx` | None. |
| 8 | `VerdictBanner/VerdictBanner.tsx`(+test+styles+constants) | None — separate component folder entirely. |

No two Wave-1 steps declare the same file. The barrel file `OverviewTab/index.ts` exists (confirmed) but the plan does not mention any step needing to edit it (a new `ReviewFocusCard` export would normally need adding to a barrel, but `OverviewTab.tsx` — Step 9 — imports it directly via relative path per the codebase's actual pattern of `import { IntentCard } from "./IntentCard"`, not through the barrel, so this is consistent with existing style, not a gap).

Verdict: **the disjoint-paths claim holds.** Wave 1 parallelization is safe as described.

One softer risk not about file collision but about **contract timing**: Steps 6/7/8 all consume `ReviewFocusItem`/enriched `Risk`/`RiskLevel` types from Step 1 (Wave 0) — correctly sequenced as a hard dependency, not a Wave-1 peer, so this is fine.

---

## Bounded-input invariant — enforceability check

- The design routes every input source (intent, blast summary via `container.blast.getBlast()`, diff stats via `pr_files` + `classifyFile`, findings, PR title/body, history, context excerpts) through `assembleLlmInput()` before it reaches `completeStructured`. No described code path sends the full diff or full file bodies — `diff-loader.ts`'s full unified diff is never referenced as an input to this feature anywhere in Step 3/4.
- The drop-order (context excerpts → history → half diff-stats) is deterministic and never throws — matches AC-5's "soft target" language.
- One real gap: **the plan caps per-file `pseudocode_summary` to 300 chars and per-finding `rationale` to 150 chars, but never states a cap on the intent's own `in_scope`/`out_of_scope` arrays or the `intent` string itself** — Section 1 ("intent — never dropped") is exempted from truncation entirely. In the vast majority of PRs this is fine (intent text is typically short, itself already a classifier's condensed output), but there's no textual guarantee against an unusually verbose intent blowing the 8K soft target on its own before any other section is even considered. Non-blocking (soft target, not hard reject, per spec), but worth a one-line note in Step 3 acknowledging intent is unbounded-but-typically-small, so a reviewer doesn't mistake the omission for an oversight.

---

## Traceability result

**All 21 ACs (AC-1 through AC-21) are mapped to at least one implementation step and at least one test** in the plan's §6 Acceptance Criteria table and §7 Testing Plan. Cross-checked each row against the actual step content (not just the table) — the mappings are accurate to what each step actually implements, with the following caveat:

- **AC-14 is claimed as covered by Step 9**, but as detailed in Blocking Issue #3, Step 9 as currently written does not account for the pre-existing `latest?.verdict` gate in `OverviewTab.tsx` that would prevent the empty state from rendering at all for a PR with zero reviews. The AC is *listed* and a test is *planned*, but the step's own instructions would not satisfy the AC unless amended per the fix above. This is a coverage-quality gap, not a missing-from-table gap — worth flagging distinctly since a plan-verifier pass checking "does AC-14 have an implementing step + test" would currently say yes, while the actual behavior would still fail the AC's real-world edge case (zero-review PR) unless Step 9 is corrected first.

No AC is entirely unaddressed or untested in the plan as written.

---

## Summary of required changes before implementation begins

1. Fix Step 4c: use `container.blast.getBlast(workspaceId, prId)` directly; delete the "reimplement via repoIntel" instruction and the associated Project-Constraints §4 note.
2. Fix Step 2: either wrap `upsertBrief`/`upsertLlmBrief` in `db.transaction()` + row lock, or explicitly document the accepted lost-update race and its blast radius (no data corruption, just a possible reversion requiring a retry).
3. Fix Step 9: explicitly instruct removing/restructuring the `{latest?.verdict && (...)}` gate around the PR BRIEF section in `OverviewTab.tsx` so the empty state can render for PRs with zero reviews, and add a test seeding a zero-review PR.

All three are targeted edits to the existing plan document, not a rewrite. With these three changes, this plan is ready for implementation.
