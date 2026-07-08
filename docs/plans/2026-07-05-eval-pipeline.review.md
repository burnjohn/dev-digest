# Eval Pipeline (L06) — /code-review findings (Phase 6 of /implement)

**Date:** 2026-07-05 · **Scope:** uncommitted working tree on `feat/lesson_06` (whole eval-pipeline feature)
**Method:** xhigh — 10 finder angles (74 raw candidates) → dedup (26) → 6 verifiers (1-vote) → sweep (5 net-new, all verified)
**Verdicts:** 29 CONFIRMED · 2 REFUTED

**Status at pause:** Full review complete (Phases 0–3). 24 findings from the main pass (below) + 5 net-new from the re-run sweep (section "Sweep findings" at the end), all CONFIRMED via 1-vote verifiers. **No fixes from this review have been applied yet.** Next session: ask the user about the design-decision items (#9, #13, #14, S3, S5) + which cleanup to fix, then run the fix wave.

---

## Correctness findings (CONFIRMED, ranked most-severe first)

### 1. Seed eval-case expectations misaligned with parser line numbering — demo recall broken
`server/src/db/seed.ts:795-916`. Expectation `line_start/line_end` values were authored counting deleted lines as consuming new-side numbers; `parseUnifiedDiff` (diff-parser.ts:63-74) does not. Verified per case: **case 1** bug line is new-side 12, expectation 13-13 (the `}`); **case 4** SQL-concat line is 8, expectation 10-10, and its must_not_flag zone 23-23 is past real content (safe rename at 20-21) so the precision guard is vacuous; **case 2** offending lines 20-22 (query at 21), expectation 22-24 — pinpoint findings on 20-21 miss; **case 3** guard zone 15-17 excludes added guard line 14. Pinpoint-correct agents fail cases 1&4 forever; wrong flags on guarded code escape must_not_flag. The seed comment (771-774) falsely claims parser-verified numbering. **Fix:** recount every expectation against new-side numbering; add a seed-time assertion script if cheap.

### 2. deleteCase misses ownership check — cross-owner deletion + history cascade
`server/src/modules/eval/service.ts:198-203` checks only workspace existence; `routes.ts:71` discards `req.params.id`. Contrast `updateCase` (:177-179, `existing.ownerId !== agentId → NotFoundError`). Same-workspace DELETE via any agent's URL destroys another agent's or a **skill-owned** case, and `eval_runs.case_id ON DELETE CASCADE` (schema/eval.ts:55) wipes its run history out of sealed batches. **Fix:** pass agentId, require `ownerId === agentId && ownerKind === 'agent'`.

### 3. Trend chart renders time-reversed
`repository.ts:212` `listTrendBatches` orders `desc(ranAt)`; no link re-sorts (service.getTrend map → hook → TrendChart array-order → vendored LineChart x = array index, `XAxis dataKey="i"`). Improving agent renders as regression; TrendChart.tsx:3 comment claims "chronological". **Fix:** reverse in `service.getTrend` (trend path only — batch history table legitimately wants desc).

### 4. Batch drill-down re-scores history against CURRENT expectations
`service.ts:233-250` getBatchDetail: status from stored `run.pass`, counts recomputed via `scoreCase` against the case's **current** `expectedOutput`. Edit a case after a run → drill-down shows `passed` with matched 1/expected 2; header aggregates stay frozen. **Fix:** persist expected/matched counts on the run row at write time (or snapshot expectations onto the run), stop re-scoring at read time.

### 5. null→0 coercions plot no-data as 0% and fabricate deltas
`helpers.ts:132-134` (`row.recall ?? 0` in trendPoint), `service.ts:275-277` (compareBatches), `:299-301` (getKpiDelta). Null is REAL at read time: (a) batch row inserted `status:null`, metrics null, **before** cases run (run-orchestrator.ts:98-104) and `listTrendBatches` has no status filter → in-flight full batch plots as a clean (is_degraded=false) 0%/0%/0% dip; (b) all-errored sealed batch persists null metrics. Deltas vs null fabricate ±80% phantom swings; `previousFullBatch` baseline can itself be unsealed. **Fix:** exclude unsealed (status null) batches from trend/baseline, make trend/compare/delta null-aware ("no data" ≠ 0; note scoring's vacuous-1 convention is a third distinct state).

### 6. Unsealed/crashed batch renders a green "Clean" pill
`BatchHistoryTable.tsx:91-101` three-way fallthrough: full-kind + status null → Clean. In-flight and crash-orphaned batches are indistinguishable from genuinely clean ones. **Fix:** fourth branch (Running/Incomplete, neutral color); optionally label unsealed server-side.

### 7. Batch-kind classification breaks on duplicates / empty / foreign / zero-case inputs
`run-orchestrator.ts:69-78`: `case_ids [A,A]` on a 2-case set → `kind='full'` with only A run (pollutes trend, KPI baseline, flake detection); `case_ids: []` (contract `z.array(z.string()).nullish()`, no `.min(1)`; routes.ts:87 `?? undefined` misses `[]`) → zero-run calibration batch, all-null metrics, HTTP 200; foreign case ids silently dropped → same garbage row; zero-case agent + run → `status='clean'` FULL batch with null metrics enters trend. **Fix:** dedupe via Set before compare+filter; `.min(1)` (+ `.uuid()`) in the contract (both mirrors); 400/404 on unknown ids or empty target set.

### 8. Case-from-finding silently persists an empty diff
`service.ts:111-122`: patchless file (`pr_files.patch` nullable — large/binary) or renamed path → `inputDiff ''` inserted with **no** ≥1-file validation (asymmetric with createCaseManual/updateCase). Accepted finding → case permanently fails; dismissed → permanently (vacuously) green; the editor's own updateCase validation then blocks re-saving it. **Fix:** apply the same ValidationError gate; actionable message ("no diff available for this file").

### 9. Run route blocks for the entire LLM fan-out *(design decision needed)*
`routes.ts:85-89` awaits the whole batch (8+ cases ≈ multi-minute request). Proxy/browser abort → mutation rejects, onSuccess invalidations never fire, batch quietly completes server-side. review-all precedent is fire-and-forget + detached child logger. **Fix option:** insert batch row → return `{batchId}` 202 → detached fan-out → client polls `GET .../batches/:batchId` (status null = in progress). Changes API semantics — **ask the user**.

### 10. Editing a clean-diff case injects a phantom must_find
`CaseEditor.tsx:49-53` initializer: `expected_output.length ? map : [emptyExpectation()]` — a zero-expectation (AC-9) case being edited gets `{type:'must_find', file:'', 1-1}`; save persists it (contract `file: z.string()` allows ''); the case then fails every batch. **Fix:** `initialCase ? map(...) : [emptyExpectation()]`; harden contract `file: z.string().min(1)` (both mirrors); strip empty-file expectations in handleSave.

### 11. Agent-snapshot fingerprint is never displayed (AC-17/AC-29 defeated)
`BatchHistoryTable.tsx:23-35` snapshotLabel reads `display.fingerprint`, but server persists `{fingerprint, display}` with fingerprint TOP-level and `display.model` always present → the AGENT SNAPSHOT column always duplicates MODEL; TrendChart tooltip (:18-27) has no fingerprint at all. Config changes between batches are invisible. **Fix:** read top-level fingerprint, show e.g. `model @ fp.slice(0,12)` in both places; dedupe the three snapshot-unwrap helpers into one.

### 12. Repeat clicks create duplicate eval cases
`FindingCard.tsx:133` disabled only on isPending (isSuccess renders a tag but button stays enabled; state resets on revisit); server `createCaseFromFinding` never checks `inputMeta.source_finding_id`. N clicks → N identical cases double-weighting aggregates. **Fix:** disable on isSuccess client-side AND idempotent server dedupe by source_finding_id (return existing case).

### 13. Batch citation accuracy violates AC-22's pooled formula *(semantic change to stored metric)*
`run-orchestrator.ts:125-127` averages per-case ratios unweighted; spec AC-22 requires pooled kept/(kept+dropped) across the batch's scored cases (1.0 & 0.5 example: stored 0.75 vs required ≈0.545). Note: pooling needs CaseRunOutcome to carry raw kept/dropped counts (currently only the ratio survives). **Fix:** plumb counts, pool at batch level.

### 14. `strategy` excluded from the snapshot fingerprint *(spec gap — user decision)*
`scoring.ts:163-168` fingerprints prompt/skills/model/provider; run passes `agent.strategy` (run-orchestrator.ts:168) which changes reviewer-core behavior on multi-file diffs. Two behaviorally different batches share an identity. Caveat: AC-17 itself omits strategy — the spec gap was faithfully implemented. (Sub-claim about `?? REVIEW_STRATEGY` drift REFUTED — agents.strategy is notNull with default.) **Fix if approved:** add strategy to AgentSnapshotInput + fingerprint + display; note it post-hoc invalidates old fingerprints' comparability.

### 15. Q4 must_not_flag summary wording never produced
The user-confirmed wording "expected 0 flagged in guarded zone(s), got M" exists ONLY as an orphaned i18n key (`agents.json:139 mustNotFlagOnly`, zero t() consumers) — server `summaryForRun` (helpers.ts:73-78) always emits "recall X% · precision Y%", `CaseList.tsx:27-33`'s branch is dead code (its docstring lies), and `EvalsTab.test.tsx:223` fabricates the string as a mock, masking the gap. Spec §9 requires "wording adapted per expectation type". **Fix:** compose the wording (server-side in summaryForRun keyed by mustFindTotal===0 && mustNotFlag present, or client-side via the existing key + counts), fix the dead branch + the fabricated test fixture.

## REFUTED (do not fix as bugs)
- "Add to eval set errors are silent" — global `MutationCache.onError → notify.error` toast exists (providers.tsx:41-43). Residual UX nit only (no inline state; jargon message).
- "null agentId fires GET /agents/undefined/..." — unreachable at all current call sites (props non-nullable, page gates on load). Optional one-line `enabled` hardening for consistency.

## Cleanup / conventions (CONFIRMED facts; fix only what the user picks)
- **N+1s:** listCases 2+2N (service.ts:53-60; intra-case pair serial), getBatchDetail per-run getCase, compareBatches = 2× full detail (+ duplicate skill count) to serve 6 numbers the batch rows already hold.
- `countSkillOwnedCases` fetches all ids, counts in JS → drizzle `count()` (precedent: skills/repository.ts:203).
- createCaseFromFinding duplicates `diffFromPrFiles` (reviews/diff-loader.ts:33-44) AND parses the whole multi-file PR diff only as an existence check, then uses the raw patch anyway (its own doc comment misdescribes this). Module isolation blocks a direct import — hoist the helper or use `prFiles.some(...)`.
- Hand-rolled 32-bit multiply-31 fingerprint hash (scoring.ts:170-175) vs codebase precedent `createHash('sha256')` (conventions/extractor.ts:191); `-${length}` suffix doesn't stop same-length collisions; doc comment overpromises "any change → different fingerprint". node:crypto is pure — allowed by the file's AC-23 rule.
- Hand-rolled concurrency pool (run-orchestrator.ts:246-262) vs `p-queue` already used in platform/jobs.ts:40 and repo-intel full.ts:126 (correct as written — reuse/consistency only).
- **Client wire types violate the shared-types rule AND plan Step 7's explicit "never redefine local ad-hoc interfaces":** `EvalCaseListResponse` (hooks/eval.ts:19) + `EvalRunBatchResponse` (:86, also leaks camelCase over the wire vs snake_case contracts). Move to `contracts/eval-batch.ts` (both mirrors).
- Duplicated client helpers: `pct` (BatchHistoryTable:47 = BatchCompare:11 → lib/format.ts), `modelLabelFrom`/`snapshotLabel` ×3 (merge with finding 11's fix); raw `<button>`s vs vendored `IconBtn` in CaseRow:56.
- Dead code: `CaseRunOutcome.caseRow/durationMs/actualFindingsCount` never read; TrendChart `degradedPoints` {p,i} scaffolding → `points.some(...)`; contract `EvalCaseCreateInput.owner_id` ignored by server (routes take it from URL); `EvalCaseFromFindingInput` schema has zero consumers.
- Tri-state pass→passed/failed/error mapping exists ×3 (repository outcomeFromPass, service getBatchDetail ternary, helpers caseListItem) → one exported helper.
- Workspace-filter hard rule ("no exceptions", modules/AGENTS.md): `latestRunForCase`, `runsForBatch`, `lastThreeFullBatchOutcomesForCase` (already joins eval_batches!) lack the filter. All call sites pre-scoped — defense-in-depth only, zero exploitability today.
- `useRunEvalBatch` always invalidates eval-trend though calibration runs can't change it → condition on response `kind === 'full'`.
- TrendChart rebuilds series every render + hover state re-renders the whole Recharts chart → useMemo + isolate hover state.
- **Stale AGENTS.md registration claims:** root AGENTS.md "L02–L08 … not registered — inert" and modules/AGENTS.md:29 — both false (index.ts registers skills, smartDiff, conventions, contextDocs, onboarding, evalModule). Needs a full re-sync, not just an L06 edit.

## Sweep findings (Phase 3 re-run — 5 net-new, all CONFIRMED)

### S5. `getKpiDelta` + `runSingleCase` are dead — AC-31 not shipped end-to-end *(completeness gap the plan-verifier missed)*
`service.ts:211` runSingleCase and `service.ts:291` getKpiDelta are implemented AND service-unit-tested (eval-service.test.ts:710, :721-750; previousFullBatch at eval-repository.test.ts:428) but **no route in `routes.ts` calls either**, and getKpiDelta's output is folded into no other DTO (helpers.ts has no kpi_delta). So `repo.previousFullBatch` (repository.ts:229) — the whole AC-31 "delta vs previous full batch, skip calibration" mechanism — is unreachable via any HTTP endpoint. The unit tests gave a false green; plan-verifier confirmed the *method* exists but not a *route*. **Fix (user decision on shape):** add a route (e.g. `GET /agents/:id/evals/kpi-delta` or fold the delta into the batches/trend response) and wire the EvalsTab KPI display to it; or, if KPI-delta is intentionally deferred, delete the dead code + tests and note AC-31 as not-shipped. **Ask the user.**

### S2. Batch compare has no kind/case-set guard — deltas between disjoint case sets shown as meaningful
`BatchHistoryTable.tsx:90-108` renders a selectable Checkbox on every row (calibration and full alike; isCalibration only styles the pill); `toggleSelected` accepts any two ids; `compareBatches` (service.ts:261-280) computes recall/precision/citation deltas with no kind or case-set-overlap check. Selecting a 3-case calibration batch vs a 20-case full batch renders a signed "regression/improvement %" the numbers can't support. **Fix:** restrict compare to full batches (or same-case-set), or badge the delta as non-comparable when kinds/case-sets differ.

### S4. Run-all stays clickable during a per-case run → overlapping concurrent batches
`EvalsTab.tsx`: one `runBatch = useRunEvalBatch(agent.id)` backs both actions; Run-all button (line 100) uses `loading={runBatch.isPending && !runningCaseId}` — during a single-case run `runningCaseId` is set, so `loading` evaluates false and the button stays enabled with no `disabled`. TanStack `useMutation` does not block concurrent `mutate()`, so clicking Run-all fires a second full-batch POST while the case run is in flight (blast radius bounded only by the 2/min limit, no per-agent in-flight lock). **Fix:** disable Run-all whenever `runBatch.isPending` (any run); ideally a per-agent in-flight guard server-side too.

### S3. Eval-run rate limit is IP-keyed, not per-workspace *(ambiguous — matches cited precedent, diverges from better one)*
`routes.ts:83` `rateLimit: { max: 2, timeWindow: '1 minute' }` with no keyGenerator → @fastify/rate-limit defaults to IP-keying. This **matches review-all** (reviews/routes.ts:271, plain, IP-keyed) — the precedent the plan explicitly cited (routes.ts:77 comment). But it **diverges from the stronger per-workspace pattern** the other two paid-LLM routes use: brief (reviews/routes.ts:169-174, `keyGenerator → risk-brief-generate:${workspaceId}`, comment "per-workspace not per-IP") and onboarding (onboarding/routes.ts:45-50). Effect: agent A's eval runs share the 2/min bucket with agent B and any IP-shared tenant. **Ask the user:** keep matching review-all, or upgrade to per-workspace keying like brief/onboarding (recommended — eval runs are paid-LLM fan-out).

### S1. Drizzle meta snapshot drift: 0016 snapshot omits its own indexes; 0017 is a misnamed phantom *(permanent-but-harmless)*
`meta/0016_snapshot.json` records `indexes: []` on eval_batches/eval_runs, but `0016_eval_batches.sql:19-21` creates all three indexes — the snapshot lies. This drift is what caused our own arch-fix `db:generate` to emit `0017_medical_tag.sql` (name is a drizzle-random misnomer; body is only the three duplicate `CREATE INDEX IF NOT EXISTS`, a no-op at apply time). `0017_snapshot.json` now records the indexes correctly, so the chain is consistent going forward (a fresh `db:generate` yields no new migration). Severity: harmless — 0016 is applied (forward-only, never edit it), 0017 is a benign no-op. **Optional:** rename 0017's file/tag to something descriptive (`0017_eval_indexes`) for future readers; otherwise leave as-is and just be aware the 0016 snapshot record is permanently wrong.

## Final sweep (2026-07-06 net-new pass, exclusion-list of 29 — CONFIRMED)

### N1. Precision underflows below 0 when one finding satisfies multiple `must_not_flag` expectations *(HIGH — net-new)*
`scoring.ts:104-113` (`aggregatePrecision`) + `run-orchestrator.ts:193-196` (per-run precision in `insertRun`). `mustNotFlagViolations` is counted **per-expectation** (`scoring.ts:58-62` — each `must_not_flag` expectation any kept finding overlaps adds 1), but the precision denominator is `findingsCount` (number of kept findings); nothing ties them and nothing clamps. Two overlapping `must_not_flag` zones on one file + one kept finding in both → `violations=2, findingsCount=1` → precision `(1-2)/1 = -1.0` persisted to `eval_runs.precision` AND `eval_batches.precision`. UI renders `-100%`; TrendChart clips below `yMin=0` (true regression invisible); `getKpiDelta`/`fmtDelta` compute nonsense. Distinct from #5 (null→0) and #13 (citation only). **Fix:** count `must_not_flag` violations as the number of kept findings hitting a forbidden zone (mark each finding once, capping at `findingsCount`) — mirroring how recall caps `must_find` at `mustFindTotal`; clamp per-run precision identically in run-orchestrator.

### N2. `previousFullBatch` / trend ordering unstable on equal `ran_at` *(LOW — net-new, low reachability)*
`repository.ts:229-248` `previousFullBatch` uses strict `lt(ranAt, beforeRanAt)` and orders by `ranAt` alone (no id tiebreaker); `:200-213` `listTrendBatches` same. Two full batches for one agent at an identical `defaultNow()` instant → strict `<` skips a true predecessor; tied-row ordering nondeterministic. Microsecond resolution makes this rare. **Fix (cheap, fold into repository touch):** add `desc(id)` secondary sort key.

## Deferred earlier by the user (do not re-raise)
- Composite index `(workspace_id, owner_kind, owner_id)` on eval_cases (arch finding #2) — deferred.
