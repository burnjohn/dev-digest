# Session handoff — prompt-version rework (DONE) + review demo-PR (2026-07-07)

> Open this in the next session. Two independent pieces of work happened this
> session. **Task A has repo changes to commit; Task B is a DB-only demo
> artifact with nothing to commit.** Branch: `feat/lesson_06`. Dialogue
> Ukrainian, artifacts English. Never restart the user's `:3001`/`:3000`.

---

## Task A — Eval Dashboard "vN = prompt version" rework ✅ DONE (uncommitted)

`vN` now means the **prompt version** everywhere (bumps only when an agent's
system-prompt text changes; repeated runs on an unchanged prompt share one vN;
runs predating prompt-snapshot tracking render `—`). The run/attempt ordinal is
retired. Full prior plan: `docs/plans/2026-07-07-eval-dashboard-ui-handoff.md` §3.

**4 decisions (confirmed by user):** (1) duplicate vN across same-prompt runs is
OK — date/time distinguishes them; (2) Compare-modal title compares by prompt
version → "v1 → v1" accepted; (3) pre-0021 (no snapshot) → `—`; (4)
`fullBatchVersionMap` deleted.

**Changed files (15, all `M`, UNCOMMITTED):**

- Client: `AgentCard.tsx` (`?? "—"`), `EvalDetailView.tsx`
  (`fullBatchVersionMap`→`promptVersionMap`), `RecentRunsFeed.tsx` (`—` on null),
  `BatchHistoryTable.tsx` (dropped modal `versionByBatchId` pass-through),
  `CompareModal.tsx` (title by prompt version; removed run-version machinery),
  `CompareModal.test.tsx` (+2 title assertions), `TrendChart.tsx` (comment),
  `helpers.ts` (deleted `fullBatchVersionMap`), `index.ts` (barrel),
  `client/src/vendor/shared/contracts/eval-batch.ts`.
- Server: `modules/eval/repository.ts` (new `promptVersionsByAgent` fold;
  `latest_version` + recent-feed `version` = prompt version; recent feed does a
  3rd query for the agents' full snapshot history; `row_number()` removed),
  `vendor/shared/contracts/eval-batch.ts` (`EvalRecentBatchRow.version` →
  `.nullable()`), `test/eval-repository.test.ts`, `test/eval-service.test.ts`,
  `insights.md` (one Decision entry; superseded the old row_number Pattern).

**Field names KEPT** (`version` / `latest_version`); only their MEANING +
doc-comments changed — a rename would churn both shared mirrors + all fixtures.

**Gates GREEN:** client `pnpm typecheck` ✓ + full client suite **275/275** ✓
(eval 39); server `pnpm typecheck` ✓ + eval suite **285/285** ✓ (repository 51 /
service 44 / routes 42). Server full hermetic run has 8 pre-existing Windows-only
failures in `indexer-pipeline` + `conventions-extractor` (ENOENT / path — NOT
this work).

### NEXT for Task A (user actions)

1. **Commit** the 15 files (commit message in §Commit below).
2. **Restart `:3001`** — `EvalRecentBatchRow.version` became `.nullable()`, a
   `@devdigest/shared` contract change; `tsx watch` does NOT reload the
   path-aliased contract, so Zod would strip/reject the nullable `version` until
   a manual restart. Client `:3000` picks the mirror up on its own recompile.

---

## Task B — Review demo-PR #900 (DB-only artifact; nothing to commit)

Goal was: make a PR whose review yields ~2 CRITICAL / 2 WARNING / 2 SUGGESTION
from the **General** + **Security** reviewers. Per user decision, built a **new
small demo PR** (not the real 636-file L06 PR) so the reviewed diff is tiny and
controlled.

**What exists (DB only, workspace `default`):**
- `pull_requests` row: repo `felkost/dev-digest`
  (`aa1b8a97-b698-4c74-958f-4b45669d8712`), **number 900**, title
  *"demo: report share/export (L06 review fixture)"*, status `open`, bogus
  `head_sha` → `git diff` fails → reviewer reads the `pr_files` fallback (so the
  diff is fully controlled, real codebase untouched).
- `pr_files`: two planted files (`server/src/modules/reports/report-export.ts`,
  `.../report-utils.ts`) — 6 planted issues: SQLi + path-traversal (CRIT),
  insecure cookie + async-`forEach` (WARN), redundant ternary + unused-var
  assignment (SUGG).
- Reviewer agents: General `a5de5b1c-fc74-4130-b8f3-ba67425bdae4`, Security
  `ebcd6a12-96db-49ba-b820-29ef08973955`.

**How to run:** open PR #900 in `:3000` and click Run Review per agent, or
`POST http://localhost:3001/pulls/<pr900-id>/review` with
`{"agentId":"<id>"}` (no auth header — LocalNoAuthProvider → default workspace).

**Result / caveat (user chose "leave as-is"):** the diff is correctly engineered
and hits exactly 2/2/2 on good runs (General was 2/2/2 twice), BUT the reviewer
model `deepseek/deepseek-v3.1-terminus` is **high-variance** — the *same* diff
gave General 2/2/2 and 3/1/1 on different runs (it flips async-`forEach`
CRITICAL↔WARNING, the cookie flagged↔ignored, style-nits suggestion↔ignored).
The two injections are the only rock-solid CRITs every run. A *stable* 2/2/2 for
both is not achievable by editing code alone; the lever would be switching the
reviewer agents' model to a more consistent one (e.g. Claude Haiku 4.5) — user
declined for now.

**Bait source files** (to re-tune / re-seed): `<scratchpad>/bait/report-export.ts`
+ `report-utils.ts`. The temporary seed script (`server/_demo-pr-seed.ts`) was
**deleted** after use (it hardcoded workspace/repo/agent UUIDs — must not be
committed). To re-seed a changed diff, recreate a similar script that inserts the
PR row + `pr_files` (bogus head_sha) and prints the id.

### Remove the demo-PR when done with the demo

```sh
docker exec devdigest-postgres psql -U devdigest -d devdigest -c "delete from pull_requests where repo_id='aa1b8a97-b698-4c74-958f-4b45669d8712' and number=900;"
```

(Cascade clears its `pr_files`, `reviews`, and `findings`. Any orphaned
`agent_runs` rows get `pr_id` set null — harmless.)

---

## Commit (Task A only — Task B has no repo changes)

Title: `feat(evals): make vN denote the prompt version everywhere`

```
feat(evals): make vN denote the prompt version everywhere

The eval dashboard's vN badge now means the PROMPT version — it bumps only
when an agent's system-prompt text changes, so repeated runs on an unchanged
prompt share one version; the run/attempt ordinal is retired from the UI.

Client:
- EvalDetailView derives versions via promptVersionMap (was fullBatchVersionMap),
  flipping the detail VERSION column and the trend tooltip to prompt versions
- CompareModal drops the run-version prop/fallback; its title now compares by
  prompt version too ("v1 -> v1" when two runs share a prompt)
- RecentRunsFeed and AgentCard render "-" for runs that predate prompt tracking
- remove the now-unused fullBatchVersionMap helper + its barrel export

Server (eval/repository.ts):
- new promptVersionsByAgent fold (mirrors the client promptVersionMap)
- listEvalConfiguredAgentSummaries.latest_version and the recent-feed version
  are now prompt versions; the recent feed folds each agent's full snapshot
  history (row_number() removed)

Contract: EvalRecentBatchRow.version is now nullable (batches predating prompt
snapshots have no prompt version). Requires a :3001 restart (tsx-watch quirk).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Rules (unchanged)

Commits by the USER only. Never start/restart the user's servers — pause + warn;
after a `@devdigest/shared` change ask the user to restart `:3001`. SDD steps
manual. Related memory: `agent-eval-dashboard-handoff`, `skill-eval-pipeline-sdd`,
`l06-eval-pipeline-resume`.
