# Agent Eval Dashboard — handoff (ПІСЛЯ імплементації, 2026-07-07)

> **Призначення:** відкрий у новій сесії, щоб продовжити/завершити фічу.
> Це **НЕ resume реалізації** — фіча вже реалізована й верифікована. Лишились
> лише організаційні кроки (коміт + flip spec-статусу). db:migrate — ВЖЕ виконано.

---

## TL;DR

- **SPEC ✅ · PLAN ✅ · /implement ✅** (усе 2026-07-07).
  - Спека: `docs/feature-requirements/2026-07-07-agent-eval-dashboard.md` (27 AC).
  - План: `docs/plans/2026-07-07-agent-eval-dashboard.md` (14 кроків).
- **Верифікація: 55 ✅ / 0 ⚠️ / 0 ❌.** Completeness 41/41 · Architecture 0C/0H/0M · Testing Plan 14✅ (⚠️ закрито — `BatchHistoryTable.test.tsx` додано, 6/6).
- **Гейти зелені:** server typecheck ✓, `verify:l06` 178/178, server hermetic 672 (мінус 2 відомі Windows-ENOENT: `indexer-pipeline`/`conventions-extractor`); client typecheck ✓, client suite 267.
- **Стан: УСЕ НЕ ЗАКОМІЧЕНО** на гілці `feat/lesson_06` (39 tracked + 14 untracked + новий `BatchHistoryTable.test.tsx`).
- **db:migrate ВЖЕ ВИКОНАНО користувачем** (міграції `0021`/`0022` застосовано, `:3001` перезапущено).

## Що лишилось (для користувача)

1. **Закомітити** увесь діф (див. текст коміту нижче). Комітить лише користувач.
2. **Flip spec Status → `implemented`** у `docs/feature-requirements/2026-07-07-agent-eval-dashboard.md` (через spec-creator, не /implement).
3. (Опційно) Якщо `BatchHistoryTable.test.tsx` ще не додано — закриває єдину ⚠️.

## Що збудовано

**Server (`eval` + `agents` модулі):**
- `GET /evals/overview` · `GET /evals/recent` · `POST /evals/run-all` (202 + detached fan-out; per-workspace rate-limit 2/min; concurrency cap = 3 агенти).
- `POST /agents/:id/evals/promote` — промоут prompt-snapshot батчу в нову версію агента (guard'и: ownership → 422, null-snapshot → 422; provenance stamping).
- `container.evalRepo` getter (R6-сумісний крос-модульний read, лише `getBatchPromptSnapshot`).
- Міграції `0021_eval_batch_prompt_snapshot` (`eval_batches.system_prompt_snapshot`, nullable) + `0022_agent_version_provenance` (`agent_versions.source`/`source_batch_id`, FK `ON DELETE SET NULL` + індекс).

**Client:**
- `/evals` (landing: `AgentCard` grid + `RecentRunsFeed`) та `/evals/[agentId]` (detail: `EvalDetailView` + `AgentSwitcher` + `KpiBanner` + `CompareModal` з word-diff `diffWords` LCS).
- Спільні eval-компоненти винесено в нейтральний **`client/src/components/eval/`** (барель `index.ts`): `EvalMetrics`, `TrendChart`, `BatchHistoryTable`, `BatchCompare`, `CompareModal` + `helpers.ts`/`styles.ts`. Імпорт `from "@/components/eval"`.
- Nav-пункт «Eval Dashboard» + шорткат `g e`; активовано раніше-інертне посилання в `EvalMetrics`.

**Shared contracts** (server + client дзеркала синхронні): `EvalBatch.system_prompt_snapshot`, `EvalBatchCompareResult.{prompt_diff_available, deltas.cost_usd}`, `EvalAgentSummary`/`EvalRecentBatchRow`/`EvalRunAllResult`/`EvalPromoteRequest`, `AgentVersion.source`/`source_batch_id`.

## Виправлення bug-review (Phase 6)

- **A.** `Sparkline.tsx` — NaN на серії з 1 точки → guard `max(len-1,1)` + пропуск `<path>`; тест `Sparkline.test.tsx`.
- **B.** `startRunAll` — тепер пропускає **будь-яку** per-agent помилку (не лише `ValidationError`) з логом (concurrent delete не 500-ить fan-out).
- **C.** `getOverview`/`listEvalConfiguredAgentSummaries` — `ORDER BY asc(agents.name)`.
- **E.** `executeRunAll` — успадковує дефолт `CONCURRENCY` (не літерал `3`).

## Рішення користувача (застосовано)

- Run-all cap: **3 агенти** (≤9 LLM-викликів, як у плані) — лишили.
- Detail-page «Traces passed —» card: лишили плейсхолдер.
- **Refactor coupling** (обрано): спільні компоненти → `client/src/components/eval/`; grep підтвердив 0 крос-імпортів `/evals ↔ agents/[id]`; повторний arch-review = RESOLVED.
- Cleanup G (`fmtCostDelta` helper) + H (`TABLE_ROW_HEIGHT_PX` з shared-токенів) — зроблено.

## Прийняті відхилення від плану

- `EvalMetrics.agentId` → **optional** (розв'язка Step 12/14).
- `ValidationError` → HTTP **422** (не 400).
- Promote-gate — по хронологічно-новішому батчу (`ran_at`), не `prompt_diff_available`.
- `startRunAll` повертає `{result, started}` (роут деструктурує).
- Реальні хвилі: **5** (план казав 4; Step 5 залежить від 4; 12↔13 циркулярне; 14 required-prop).

## ⚠️ → ЗАКРИТО

Додано `client/src/components/eval/BatchHistoryTable/BatchHistoryTable.test.tsx` (6 тестів: inline-шлях / modal-шлях / `preselectBatchId` / empty-state / expand-collapse / default-collapsed — 6/6 зелених, client typecheck ✓). Відкритих пунктів немає.

## Текст коміту (для користувача)

```
feat(evals): add Agent Eval Dashboard (cross-agent overview, detail, compare/promote)

Workspace-wide Eval Dashboard: a landing page aggregating every eval-configured
agent's health + a cross-agent recent-runs feed with a "Run all agents" fan-out,
plus a per-agent detail page with agent-switcher, KPI-change banner, and a compare
modal with word-level system-prompt diff and one-click promote.

Server (eval + agents modules):
- GET /evals/overview, GET /evals/recent, POST /evals/run-all (202 + detached
  fan-out; per-workspace rate-limit 2/min; concurrency cap 3 agents)
- POST /agents/:id/evals/promote (ownership + null-snapshot guards; version
  provenance stamped: source=eval_promote, source_batch_id)
- container.evalRepo getter for the R6-compliant cross-module read
- migrations 0021 (eval_batches.system_prompt_snapshot) + 0022
  (agent_versions.source/source_batch_id, FK ON DELETE SET NULL)

Client:
- /evals landing (AgentCard grid + RecentRunsFeed) and /evals/[agentId] detail
  (EvalDetailView + AgentSwitcher + KpiBanner + CompareModal, word-level prompt
  diff via a dependency-free LCS)
- shared eval components promoted to client/src/components/eval/ (neutral home)
- nav entry + g-e shortcut; activated the previously-inert dashboard link

Shared contracts extended (system_prompt_snapshot, deltas.cost_usd,
prompt_diff_available, EvalAgentSummary/RecentBatchRow/RunAllResult,
AgentVersion.source/source_batch_id); server + client mirrors kept in sync.

Verified: completeness 41/41 (14 steps + 27 AC), architecture 0 critical/high/medium,
typecheck + hermetic suites green (verify:l06 178/178, client 267).

Implements SPEC-2026-07-07-agent-eval-dashboard.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

## Правила

Коміти — лише користувач. Сервери самому не запускати. Діалог українською (артефакти — англійською). SDD-кроки — вручну. Пов'язане: `[[skill-eval-pipeline-sdd]]`, `[[l06-eval-pipeline-resume]]`.
