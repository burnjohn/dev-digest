# Eval Dashboard — UI-fidelity + prompt-version rework (handoff)

> **Open in the next session to continue.** This session brought the Eval
> Dashboard UI to the mockups and rebuilt the Compare modal. One **rework is
> still requested** (see §3): make the `vN` badge mean the **prompt version**
> everywhere, not the run/attempt ordinal. That rework is NOT started yet.

Branch: `feat/lesson_06` · everything below is **UNCOMMITTED**. Commits are the
user's job. Dialogue Ukrainian, artifacts English. Never restart the user's
`:3001`/`:3000` — after a **shared-contract** (`@devdigest/shared`) change the
user must restart `:3001` manually (`tsx watch` does NOT reload the path-aliased
contract → Zod silently strips the new fields; see `server/insights.md`).

---

## 1. TL;DR — state

- **DONE + verified this session** (all client-only unless noted): landing
  horizontal agent rows, bar recent-feed (full-only, calibration hidden),
  server-derived **run** versions (`v1..vN`), full-width sparklines, detail
  back-link / model badge / Run-eval / MetricCard KPIs / trend card / always-on
  Compare button, chart→row hover highlight, full-width trend charts (3 places),
  a nav-i18n crash fix, and a **rebuilt Compare modal** (4 metric cards + prompt
  diff + Close/Promote) with a **separate prompt-version** concept in the modal.
- **Gates green:** client `pnpm typecheck` ✓, full client suite **274+** ✓
  (all eval tests 39 ✓); server `pnpm typecheck` ✓, server eval tests 136 ✓.
- **db:migrate** — nothing new this session (0021/0022 already applied earlier).
- **NEXT (this handoff's point):** the **prompt-version rework** in §3.

---

## 2. What was built this session (context for the reviewer)

Ordered roughly as it happened:

1. **Landing `AgentCard`** — vertical grid card → **full-width horizontal row**
   (icon · name + model badge · "Last run v{n} · ts · N/M pass" · compact recall
   sparkline · 3 colored metric cols RECALL=`--accent`/PREC=`--ok`/CITE=`--warn`
   · chevron). Name never truncates; the long model badge ellipsizes.
   `client/src/app/evals/_components/AgentCard/{AgentCard.tsx,styles.ts}`
2. **`RecentRunsFeed`** — colored progress bars (blue/green/amber) + a VERSION
   token + bold `N/M`; Status column dropped; **full-only** (calibration hidden).
   `client/src/app/evals/_components/RecentRunsFeed/{RecentRunsFeed.tsx,styles.ts}`
3. **`EvalsLandingView`** — "AGENTS" section header, list layout, pass/total
   joined client-side from the recent feed (`/evals/overview` carries no pass
   counts). `client/src/app/evals/_components/EvalsLandingView/*`
4. **`EvalDetailView`** — "‹ All agents" back link, inline model badge, subtitle,
   **Run eval** button (AC-17, mirrors EvalsTab), `MetricCard` KPI trio (per-metric
   sparkline + Δ), amber `KpiBanner`, **trend wrapped in a card**, chart→table
   hover highlight (`onHighlightBatch` ⇄ `highlightBatchId`), section titles.
5. **`BatchHistoryTable`** (detail, `barMetrics`/`useModalCompare`) — full-only,
   VERSION column, always-visible header **Compare** button (disabled until 2
   selected). `client/src/components/eval/BatchHistoryTable/BatchHistoryTable.tsx`
6. **Charts full width** — the vendored `LineChart` capped width at
   `maxWidth: w` (620px); added a `fill` prop that drops the cap. `TrendChart`
   forwards it as `fillWidth`; enabled on the dashboard detail trend, the agent
   Evals-tab trend, and the skill `SkillTrendChart`. Legend right-aligned in
   `fill` mode. `client/src/vendor/ui/charts/LineChart.tsx`,
   `client/src/components/eval/TrendChart/TrendChart.tsx`,
   `client/src/app/skills/.../SkillTrendChart/SkillTrendChart.tsx`,
   `client/src/app/agents/[id]/.../EvalsTab/EvalsTab.tsx`
7. **Nav i18n crash fix** — command palette threw `MISSING_MESSAGE:
   shell.nav.evals` because the NAV key is `evals` but `shell.json` had `eval`
   (singular). Renamed to `evals`; dropped dead GLOBAL keys.
   `client/messages/en/shell.json`
8. **Server: derived RUN versions (no migration)** — `listRecentBatchesAcrossAgents`
   filtered to `kind='full'` + a `row_number()` window → `EvalRecentBatchRow.version`;
   `listEvalConfiguredAgentSummaries` → `EvalAgentSummary.latest_version` (= count
   of the agent's full batches). Contracts mirrored (server + client). Verified vs
   the live DB. `server/src/modules/eval/{repository.ts,service.ts}`,
   `{server,client}/src/vendor/shared/contracts/eval-batch.ts`
9. **Compare modal rebuild** — subtitle, 4 metric cards (old→new + delta chip),
   `System prompt diff` (old/new legend + word diff, or graceful fallbacks),
   `Close`+`Promote` footer. Handles every snapshot case (both present+diff →
   diff; both+identical → "unchanged"; newer-only → verbatim + note; newer-null →
   "no stored prompt", Promote disabled). Removed the old view-toggle buttons and
   `BatchCompare` usage from the modal (BatchCompare still used inline in the
   per-agent Evals tab). `client/src/components/eval/CompareModal/CompareModal.tsx`
10. **Prompt-version concept (modal only, partial)** — added
    `promptVersionMap(batches)` (helper): the **prompt** version bumps ONLY when
    `system_prompt_snapshot` text changes chronologically (an unchanged prompt
    keeps the same `prompt vN` across many runs). The Compare modal's legend,
    "unchanged" note, old-missing note, and Promote label now use PROMPT versions.
    `client/src/components/eval/helpers.ts` (`promptVersionMap`),
    `client/src/components/eval/CompareModal/CompareModal.tsx`

**Data caveat that shapes everything below:** `eval_batches.system_prompt_snapshot`
is populated ONLY for batches created after migration 0021. In the current dev DB
only each agent's single latest full batch (2026-07-07) has a snapshot; all older
runs are `null`. So most comparisons can't diff, and prompt versions are only
computable for the post-0021 runs.

---

## 3. REWORK REQUESTED (do this next session)

**Goal (user, 2026-07-07):** the `vN` badge must denote the **prompt version**
everywhere — NOT the run/attempt ordinal. Two runs on an unchanged prompt should
show the SAME `vN`; `vN` increments only when the system-prompt text actually
changes. The run/attempt ordinal should be retired from the UI (or demoted).

### 3.1 Current vs target per surface

| Surface | Today (run/attempt ordinal) | Target (prompt version) |
|---|---|---|
| Landing `AgentCard` "Last run v{n}" | `summary.latest_version` (server row-count) | prompt version of the agent's latest run |
| Landing `RecentRunsFeed` VERSION col | `row.version` (server `row_number()`) | prompt version of that run |
| Detail `BatchHistoryTable` VERSION col | `versionByBatchId` = `fullBatchVersionMap` | `promptVersionMap` |
| Detail `TrendChart` tooltip | `versionByBatchId` | `promptVersionMap` |
| Compare modal — prompt section + Promote | **already prompt version** ✓ | keep |
| Compare modal — title `Compare runs · vX → vY` + metric cards | run versions | **DECISION NEEDED** (see 3.4) |

### 3.2 Client work (easy — full history is available client-side)

- `EvalDetailView`: replace `const versionByBatchId = fullBatchVersionMap(batchList)`
  with `promptVersionMap(batchList)` and pass it as `versionByBatchId` to both
  `BatchHistoryTable` and `TrendChart`. That single swap flips the detail table +
  trend tooltip to prompt versions (they already read the map).
  `client/src/app/evals/_components/EvalDetailView/EvalDetailView.tsx:127`
- Where a batch has no snapshot (older/pre-0021), `promptVersionMap` returns no
  entry → the table already renders `"—"`; keep that.

### 3.3 Server work (needed for the cross-agent landing surfaces)

The landing feed + cards are cross-agent and cannot compute prompt versions from
the 25-row feed alone (a run's prompt version depends on its agent's FULL snapshot
history). So compute prompt version server-side:

- **Prompt version per batch** = count of prompt-text CHANGES up to and including
  this batch, per agent, chronological, over runs that HAVE a snapshot. SQL sketch
  (guard nulls — a `null` snapshot must NOT count as a change and has no version):
  ```sql
  -- over full batches WITH a non-null snapshot, per agent, ran_at asc, id asc
  1 + count(*) filter (
        where system_prompt_snapshot
              is distinct from lag(system_prompt_snapshot) over w
      ) over (w rows between unbounded preceding and current row)
  ```
  Simpler/safer: fetch the agent's full snapshot history and fold it in JS (mirror
  the client `promptVersionMap`), then join back — the recent feed is already a
  two-query method.
- Replace `EvalRecentBatchRow.version` and `EvalAgentSummary.latest_version`
  semantics with the prompt version (rename to `prompt_version` /
  `latest_prompt_version` for clarity, or keep names + change meaning — pick one
  and update BOTH shared mirrors + the tests that stub the repo rows).
  Files: `server/src/modules/eval/{repository.ts,service.ts}`,
  `{server,client}/src/vendor/shared/contracts/eval-batch.ts`,
  `server/test/{eval-repository,eval-routes,eval-service}.test.ts` (fixtures),
  client eval fixtures (`latest_version`/`version` in the `*.test.tsx`).
- **After the contract change, the user must restart `:3001`** (tsx-watch quirk).

### 3.4 Open decisions (confirm with the user before building)

1. **Runs on an unchanged prompt become indistinguishable by `vN`** (e.g. the
   recent feed would show `v1, v1, v1, v2`). Is that acceptable, or should the run
   row still carry a secondary run marker (timestamp already distinguishes them)?
2. **Compare modal title** "Compare runs · vX → vY": if `vN` = prompt version,
   comparing two runs on the same prompt reads "v1 → v1". Options: keep run
   ordinals in the TITLE only (it literally compares runs), or title by prompt
   versions and accept "v1 → v1". Recommend: title stays run-oriented but WITHOUT
   a `vN` (e.g. "Compare runs · {date} → {date}"), and every `vN` badge is a
   prompt version. Confirm.
3. **Pre-0021 runs have no prompt version.** Show `—`, or `v0`/`v?`. Recommend `—`.
4. Whether to keep `fullBatchVersionMap` at all (it becomes unused once the detail
   surfaces switch). Likely delete it + its export once nothing references it.

### 3.5 Suggested order

1. Confirm 3.4 decisions.
2. Client-only swap (3.2) — instant win on the detail page, no server dependency.
3. Server prompt-version + contract rename (3.3) → user restarts `:3001`.
4. Update all fixtures/tests; `pnpm typecheck` + suites green.
5. Delete `fullBatchVersionMap` if unused.

---

## 4. Verification snapshot (end of this session)

- client `pnpm typecheck` ✓ · full client suite **274+** ✓ (eval 39 ✓)
- server `pnpm typecheck` ✓ · eval tests 136 ✓
- Live: `/evals`, `/evals/:id`, `/skills`, `/agents/:id` all HTTP 200, no console/compile errors.

---

## 5. Commit message (for THIS session's work — user commits)

```
feat(evals): polish Eval Dashboard UI + rebuild the Compare modal

Bring the Eval Dashboard to the design mockups and fix several UI/UX gaps:

Landing:
- agent cards -> full-width horizontal rows (icon, name + model badge,
  "Last run v{n}" meta, compact recall sparkline, colored RECALL/PREC/CITE
  columns, chevron); name never truncates
- recent-runs feed -> colored metric bars + version token + pass count;
  full-batches only (calibration hidden from the dashboard)

Detail:
- back link, inline model badge, Run-eval button, MetricCard KPI trio with
  per-metric sparklines, amber KPI banner, trend wrapped in a card
- chart-point hover now highlights the matching Recent-Runs row
- always-visible Compare button (enabled once two runs are selected)

Compare modal rebuilt: subtitle, four old->new metric cards, system-prompt
diff with an old/new legend and graceful fallbacks for runs that predate
prompt snapshots, Close + Promote footer. Introduces a prompt-version concept
(bumps only when the prompt text changes) used by the modal.

Charts: vendored LineChart gains a `fill` mode so trend lines span the full
block width (dashboard detail, agent Evals tab, skill Evals tab).

Server: cross-agent recent feed is full-batches-only with a derived per-agent
run version (row_number, no migration); overview carries latest_version.

Fixes a command-palette crash (MISSING_MESSAGE shell.nav.evals — NAV key
`evals` vs message key `eval`).

Refs SPEC-2026-07-07-agent-eval-dashboard.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

> Note: the commit above is the UI-polish work. The **prompt-version rework**
> (§3) is a follow-up — commit it separately next session once §3.4 is confirmed.

---

## 6. Rules (unchanged)

Commits by the USER only. Never start/restart the user's servers — pause + warn;
after a `@devdigest/shared` change, ask the user to restart `:3001`. SDD steps
manual. Related memory: `agent-eval-dashboard-handoff`, `skill-eval-pipeline-sdd`,
`l06-eval-pipeline-resume`.
