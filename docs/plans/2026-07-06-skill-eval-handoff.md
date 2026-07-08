# Skill Eval Pipeline — handoff для сесії /implement (2026-07-06)

> **Призначення:** відкрий цей файл у новій сесії, щоб продовжити фічу **Skill Eval Pipeline**
> (вкладка Evals для розділу Skills) на етапі **виконання плану (`/implement`)** за Повним SDD.

---

## TL;DR стану

- **Спека ✅** — `docs/feature-requirements/2026-07-06-skill-eval-pipeline.md` (39 EARS AC, status: draft).
- **План ✅** — `docs/plans/2026-07-06-skill-eval-pipeline.md` (**multi-agent**, 11 кроків, 6 хвиль).
- **Реалізація ⬜** — НАСТУПНИЙ крок: `/implement` на плані вище.
- **Верифікація + коміт ⬜** — коміт робить **лише користувач** (давати commit-меседжі).
- Гілка: `feat/lesson_06`. Коміт SDD-артефактів — окремо від паралельного треку CaseEditor-redesign (B7–B10), який лежить у робочому дереві незакомічений.

## Що це за фіча (стисло)

Скіл сам по собі інертний (немає моделі/промпта). Щоб його оцінити — приєднуємо до **обираного хост-агента** (дефолт `"General Reviewer"`), запускаємо його живий `reviewPullRequest()` зі скілом, **доданим до вже прилінкованих скілів агента** (marginal-contribution, НЕ ізоляція), і скоримо вихід **методологією власного харнеса репо** (`evals/src/dsl/case.ts`): дешевий детермінований `patternMatch`-гейт (grounding-підрядки) біжить першим і замикає суддю на невдачі; далі **practices-суддя** (реальний LLM-виклик) — бінарний pass/fail на практику з дослівним доказом, лише якщо grounding пройшов.

**Це sibling до agent-eval (`server/src/modules/eval/`), НЕ його заміна/розширення.** Різні методології скорингу і різні роути (`/skills/:id/evals/*` vs `/agents/:id/evals/*`).

## Прочитай ПЕРШИМИ

1. `docs/plans/2026-07-06-skill-eval-pipeline.md` — план (Implementation Steps / AC / Testing Plan / wave-мапа).
2. `docs/feature-requirements/2026-07-06-skill-eval-pipeline.md` — спека (39 AC).
3. `evals/src/dsl/case.ts` (:82–113), `evals/src/scoring/pattern-match.ts`, `evals/src/scoring/llm-judge.ts` — методологія-референс (ДЗЕРКАЛИТИ серверно, `evals/` НЕ імпортується в API).
4. `server/src/modules/eval/**` — agent-eval движок як прецедент патернів (startBatch/executeBatch 202+poll, concurrency-cap, batch-seal).

## КЛЮЧОВІ РІШЕННЯ (НЕ переграй)

- **Методологія = harness** (prompt + practices→judge + grounding→patternMatch, per-case `threshold` дефолт 0.6, редагований у Case Editor). НЕ agent-eval must-find/recall-precision.
- **Scoring НЕ zero-LLM** — суддя (practices) це реальний LLM-виклик; grounding детермінований і біжить першим. Вартість кейса = review-прогін + judge. Стеля батча **$0.15**.
- **Прогін:** обираний хост-агент (дефолт `"General Reviewer"`, fallback — перший агент за `created_at`); **модель = модель хост-агента** (окремого model picker НЕМА). **Marginal** (скіл + наявні скіли агента).
- **Створення кейсів v1:** ① ручний Case Editor + ② з finding (автор САМ обирає скіл — атрибуція finding↔skill не автоматична) + ③ seed ≥5. Клон-з-agent-кейса = Non-goal.
- **Snapshot** = skill.body + skill.version + host-agent model + host-agent id.
- **Метрики:** judge score (avg) / grounding pass rate / cases passing (N/M) / cost. 5 станів кейса: never_run / passed / failed_grounding / failed_judge / error.
- **Verdict-контракт:** `{ score, results: [{ practice, passed, evidence }] }` (поле `passed`, як у `evals/`).
- **Дисципліна назв:** нова функція `patternMatch` ≠ reviewer-core `groundFindings()` (різні механізми, лише слово «grounding» збігається) — коментувати в коді.
- **Відкладено (Non-goals):** TrendChart, BatchCompare, KPI-delta, двопанельний CaseEditor-redesign, клон, isolation-режим, окремий model picker, flaked-детекція.

## Дані (рішення планувальника)

- Нова таблиця `skill_eval_batches` (`workspace_id` + `skill_id`→skills + `host_agent_id`→agents + `model` + агрегати + status + snapshot) — ОДНА нова нумерована міграція.
- Additive nullable `eval_runs.skill_batch_id` FK (`ON DELETE SET NULL`). Жодна існуюча колонка НЕ змінюється.
- Форма кейса лягає на існуючі колонки `eval_cases` БЕЗ зміни схеми: fixture→`input_diff`; `{practices, grounding, threshold}`→`expected_output` JSONB; provenance→`input_meta`.
- Rate-limit **2/хв per-workspace** + concurrency cap **3**.
- Новий shared-контракт `contracts/skill-eval.ts` (additive; НЕ чіпає `eval-batch.ts`) — дзеркалити в ОБИДВА `server/` і `client/` vendor/shared в тому ж кроці.

## Тестування (обов'язкове — у плані)

Server hermetic: `skill-eval-scoring.test.ts`, `skill-eval-repository.test.ts`, `skill-eval-service.test.ts`, `skill-eval-routes.test.ts` (MockLLMProvider + fake db). Client RTL: `EvalsTab.test.tsx`, `SkillCaseEditor.test.tsx`, `HostAgentSelect.test.tsx`. Кожен крок має Verify-чеклист (typecheck + таргетовані тести). Крок 11 — повний hermetic sweep.

**`verify:skill-eval` ДОДАНО** у `server/package.json` (дзеркалить `verify:l06`; поки інертний — стане зеленим, коли Кроки 3–6 створять 4 тест-файли).

**Фінальна верифікація (обов'язково в самому кінці, після всіх кроків):**
1. `cd server && pnpm verify:l06` — регресія: agent-eval має лишитись зеленим.
2. `cd server && pnpm verify:skill-eval` — новий гейт зелений.
3. `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — повний server sweep.
4. `cd client && pnpm typecheck && pnpm test` — клієнтський сьют (= GitHub-чек `client / tests`).

**GitHub-чеки для PR цієї фічі (за path-фільтром):** `server unit / typecheck` + `server unit / tests` (від `server/**`; CI ганяє повний sweep, НЕ `verify:*`), `client / tests` (від `client/**`), `server integration` (`.it.test.ts` — фіча нових не додає). **`evals / model evals (OpenRouter)` НЕ спрацьовує** для цієї фічі — його фільтр лише `.claude/**`/`CLAUDE.md`/`evals/**`; це харнес для ВЛАСНИХ скілів/агентів репо, ортогональний до in-app вкладки Skill Evals.

## Залишкові ризики імплементера (не блокери)

1. Точна форма «output text» з `ReviewOutcome` для `patternMatch`/судді — findings структуровані; можливо, треба зібрати текст із title+rationale+file:line кожного finding.
2. Точний structured-output метод на `LLMProvider` для судді (`completeStructured` vs `parseWithRepair` + `toJsonSchema` з reviewer-core).
3. Reuse vs дублювання case-CRUD (`SkillEvalRepository` ↔ наявний `SkillsRepository.insertEvalCase`).

## Правила та операційне

- Коміт — **лише користувач** (давати англомовні commit-меседжі). НЕ запускати свої dev-сервери (у користувача свої :3001/:3000). Питання — **українською**.
- Після `/implement`: **застосувати нову міграцію** (`cd server && pnpm db:migrate`) + **рестарт :3001** + **re-seed** (для seed-кейсів скіла).
- Пам'ять: `skill-eval-pipeline-sdd.md` (resume-state) в auto-memory.

## Наступна дія

Запусти **`/implement`** на `docs/plans/2026-07-06-skill-eval-pipeline.md` (multi-agent). Він виконає: імплементери хвилями → gate повноти → архітектурне рев'ю (з фікс-ітераціями) → покриття тестами → bug-рев'ю → фінальна верифікація → sign-off. Спека draft — формальне затвердження лишається поза цим планом.
