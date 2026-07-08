# L06 Eval Pipeline — handoff / стан роботи (2026-07-06)

> **Призначення цього файлу:** відкрий його в новій сесії, щоб швидко ввести агента в курс
> справи по фічі L06 Eval Pipeline. Тут: що зроблено, де шукати деталі, операційні нотатки,
> і **журнал для нових багів** (секція наприкінці — саме туди дописуй нові описи проблем).

---

## TL;DR стану

- Фіча **реалізована → code-review (29+2 CONFIRMED) → фікс-хвиля → друга сесія UX/правок (2026-07-06 веч.)**.
- **Гілка `feat/lesson_06`, робоче дерево ЧИСТЕ — усе закоммічено** (HEAD `82383ca`). Коміт робить **лише користувач**.
- Гейти зелені на таргетованих прогонах цієї сесії: server+client typecheck; `eval-routes` **30/30**, `eval-{service,scoring,contracts}`; `EvalsTab` **16/16**; `FindingCard` **9/9**. Прямі `architecture-reviewer` евали **4/4**.
- ⚠️ **Перед merge:** прогнати повний `verify:l06` + client `vitest` (числа зсунулись від нових тестів) і **re-run CI** (підтвердити workflow-евал після фіксу субагентної моделі).
- Деталі другої сесії — секція **«Сесія 2»** нижче; відкриті питання — там же + «🐞 Журнал».

---

## 📋 Промпт для нової сесії (скопіюй увесь блок)

```
Продовжуємо/супроводжуємо L06 Eval Pipeline (гілка feat/lesson_06; дерево ЧИСТЕ, усе закоммічено до HEAD 82383ca).

Стан: фіча реалізована + code-review + фікс-хвиля + друга сесія UX/правок. Гейти зелені на
таргетованих прогонах (server+client typecheck; eval-routes 30/30; EvalsTab 16/16; FindingCard 9/9;
architecture-reviewer евали 4/4). Перед merge варто прогнати повний verify:l06 + client vitest і re-run CI.

Прочитай ПЕРШИМИ (самодостатні):
1. docs/plans/2026-07-06-l06-eval-handoff.md — цей файл: стан, індекс, журнал багів, лог «Сесія 2», follow-ups.
2. docs/plans/2026-07-05-eval-pipeline.review.md — знахідки рев'ю + фікси.
3. docs/plans/2026-07-05-eval-pipeline.md — план (Implementation Steps / AC / Testing Plan).
4. docs/feature-requirements/2026-07-05-eval-pipeline.md — специфікація (39 EARS AC).

Код: server/src/modules/eval/**, server/src/adapters/llm/anthropic.ts (temperature-retry) + pricing.ts,
server/src/db/{schema/eval.ts, seed.ts}, migrations 0016/0018(eval_run_counts)/0019(eval_run_error), контракти
server|client/src/vendor/shared/contracts/{eval-batch.ts, findings.ts} (byte-identical дзеркала; expectation має category),
reviewer-core/src/llm/structured.ts ($ref-dereference для Gemini), client/src/lib/hooks/eval.ts,
client EvalsTab: client/src/app/agents/[id]/_components/AgentEditor/_components/
EvalsTab/** (CaseRow, EvalMetrics, TrendChart, BatchHistoryTable, CaseEditor),
FindingCard: .../pulls/[number]/_components/FindingCard/, harness: evals/proxy/litellm.config.yaml + evals/**.

КЛЮЧОВІ ФАКТИ/РІШЕННЯ (НЕ переграй):
- Моделі агентів: РОБОЧІ (Clean із cost) = claude-haiku-4-5-20251001 / google/gemini-2.5-flash /
  deepseek/deepseek-v3.1-terminus / gpt-5-2025-08-07. fable-5/sonnet-5 native НЕ працюють — Anthropic
  forced-tool-use + always-on/adaptive thinking + пінований @anthropic-ai/sdk 0.33 → модель віддає ПОРОЖНІЙ
  structured-output (усі 4 поля Review Required). СВІДОМО відкладено (рішення користувача). Фікс, якщо треба:
  мігрувати AnthropicProvider.completeStructured з forced-tool-use на output_config.format + bump SDK
  (shared-адаптер, впливає на ВСІ Anthropic-рев'ю, поза L06).
- Review.verdict = .default('comment') — НЕ став .nullable(): дефолт дає omit-grace (haiku/Anthropic часто
  омітять verdict); .nullable() робить пропуск hard parse-error (регресія haiku 2026-07-06, відкочено).
  Gemini-фікс живе в reviewer-core/src/llm/structured.ts (dereference $ref), НЕ в findings.ts.
- Чому Degraded видно в UI: eval_runs.error_message (міграція 0019) + drill-down BatchHistoryTable
  (клік по батчу → per-case Error-рядок, повний текст у title). stderr-логи не потрібні.
- contracts/eval-ci.ts (AgentManifest/Provider/CiFailOn) — трек Export-to-CI, НЕ L06; окремий коміт.

insights: server/insights.md + client/insights.md + reviewer-core/insights.md (гуглити по "eval"/"temperature").

Правила: коміт робить лише користувач (давай commit messages, не комінь сам);
не запускай своїх dev-серверів — у користувача свої :3001/:3000; питання став українською.
Операційне: рестарт :3001 після pull; re-seed (delete eval_runs/eval_batches/eval_cases → pnpm db:seed)
якщо seed-дані змінились (onConflictDoNothing не перезаписує наявні кейси).

Відкриті питання й нові баги — секції "🐞 Журнал нових багів" + "Сесія 2 / follow-ups" цього файлу.
```

---

## Що зроблено (стисло)

**Реалізація (Phases 0–5):** повний eval-pipeline — `eval_batches`/`eval_runs`, детерміноване
скорінг (recall/precision/citation, без LLM), batch/calibration/degraded/flaked, seed з 5 кейсів,
клієнтська вкладка Evals (case list, editor, batch history, trend, compare, KPI-delta),
кнопка «Add to evals» на finding-картці. Спека — SDD (spec → plan → implement).

**Code-review (Phase 6, xhigh):** 29 CONFIRMED + 2 net-new (N1 negative precision, N2 tiebreak).
Повний ранжований список із фікс-підказками — у `…eval-pipeline.review.md`.

**Фікс-хвиля (2026-07-06):** усі correctness-баги + обрані cleanup. Ключові рішення користувача:
- #9 run-роут → **202 + polling** (detached fan-out, клієнт полить batch-detail);
- #13 citation → **pooled** per AC-22 (kept/dropped через CaseRunOutcome);
- #14 strategy у fingerprint → **лишили за буквою AC-17** (відомий gap спеки, свідомо не додано);
- cleanup: client wire types → shared, `createHash('sha256')`, S5 KPI-delta route+UI, S3 rate-limit per-workspace, N+1 countSkillOwned, стейл AGENTS.md.
- N1 (HIGH): precision більше не йде в мінус (violations рахуються per-kept-finding, clamp).
- Баг #1 (seed line-numbers) — перетрасовано на new-side нумерацію (12/20/14/8).
- UI-баг Select-типу в CaseEditor — знято `<label>`-обгортку (див. журнал нижче, вирішено).

**Свідомо НЕ робили:** #14 strategy, S1 (нешкідливий snapshot-drift 0016/0017), composite index (deferred).

---

## Сесія 2 (2026-07-06, друга половина) — зроблено + follow-ups

**Фікси (усе закоммічено):**
- **CI-red виправлено:** `eval-routes.test.ts` — 2 тести `POST /findings/:id/evals/case` давали 500 (незамокований `findCaseBySourceFindingId` #12, який `createCaseFromFinding` кличе першим). Замокано → **30/30**. Це реальний баг у **закоміченому** тесті (падав на чистому checkout `dd5cde3`), не робоче-дерево-артефакт.
- **Workflow-евал:** субагент `architecture-reviewer` брав frontmatter `model: sonnet` → SDK резолвив у голий `claude-sonnet-5` → проксі слав `openrouter/claude-sonnet-5` (невалідний) → субагент падав, оркестратор не читав api-contracts.md. Фікс у `evals/proxy/litellm.config.yaml`: exact-роути `sonnet`/`claude-sonnet-5` → `openrouter/anthropic/claude-haiku-4.5` **перед** wildcard (усі прод-піни агентів лишились). **Треба re-run CI.**
- **Drill-down FINDINGS завжди 0:** `getBatchDetail` хардкодив `findingsCount: 0` (не серед persisted-лічильників). Тепер рахує з `run.actualOutput` (read-time, ретроактивно — після рестарту :3001 видно на існуючих батчах).
- **B6 Anthropic `temperature`-deprecation** (fable-5/sonnet-5 → Degraded): `anthropic.ts` retry без `temperature` при 400 + pricing — див. журнал B6.
- **rubric розфлап:** `architecture-reviewer.cases.ts` «ends with»→«emits» → прямі евали **4/4**.

**UX (усе закоммічено):**
- **CaseRow під зразок:** моно-назва + бейдж `MUST FIND`/`MUST NOT FLAG` + правий чип `severity · category` / `assert empty`. Додано `category` у `Expectation`-контракт (обидва дзеркала, additive/nullish), `createCaseFromFinding` копіює `finding.category`, seed оновлено (bug/perf/security). **Потрібен re-seed** для seed-кейсів; наявні user-кейси не мають category заднім числом (отримають при пере-створенні з finding).
- **TrendChart:** прибрано дубль-таблицю під графіком; звʼязано з Batch History (hover точки → підсвітка+скрол відповідного рядка); легенда кольорів (значення показуються на hover); дата в tooltip. `LineChart` отримав опційний `onActiveIndexChange`.
- **EvalMetrics** — нова інфографіка зверху вкладки (recall/precision/citation + дельти vs попередній full-батч, `traces passed` = passed/total останнього батча) + заголовок «Eval cases N/M passing». «View full dashboard →» — **розміщено, але неактивно** (placeholder).

**Follow-ups (не блокери):**
- **CaseEditor-форма** не має полів severity/category → **ручні** кейси показують бейдж без чипа (severity/category беруться з finding, не з форми). Додати ці поля, якщо треба чип і для hand-authored.
- **«TRACES PASSED»** рахує лише останній батч; для «по всій історії» — потрібен серверний агрегат (sum passed runs / total runs).
- **«View full dashboard»** inert — реалізувати сторінку/лінк, тоді активувати.
- Re-run повного **CI** (workflow-евал + verify:l06) для підтвердження зеленого.

---

## Де що лежить (індекс)

| Тема | Файл |
|------|------|
| Специфікація (WHAT, 39 EARS AC) | `docs/feature-requirements/2026-07-05-eval-pipeline.md` |
| План (HOW, steps/AC/testing) | `docs/plans/2026-07-05-eval-pipeline.md` |
| Знахідки code-review + фікси | `docs/plans/2026-07-05-eval-pipeline.review.md` |
| Інструкція користувача (вкладка Evals) | `docs/eval-tab-guide.md` |
| Цей handoff + журнал багів | `docs/plans/2026-07-06-l06-eval-handoff.md` |
| Server-код | `server/src/modules/eval/{routes,service,run-orchestrator,repository,scoring,helpers}.ts` |
| Schema + міграції | `server/src/db/schema/eval.ts`, `server/src/db/migrations/{0016_eval_batches,0018_eval_run_counts}.sql` |
| Контракти (2 дзеркала) | `server|client/src/vendor/shared/contracts/eval-batch.ts` |
| Client hooks | `client/src/lib/hooks/eval.ts` |
| Client UI | `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/**` |
| Server-тести | `server/test/eval-{scoring,repository,service,routes}.test.ts` |
| Client-тести | `EvalsTab.test.tsx`, `CaseEditor.test.tsx`, `FindingCard.test.tsx` |
| Insights (гуглити "eval") | `server/insights.md`, `client/insights.md` |

---

## Операційні нотатки (щоб фіча працювала в запущеному застосунку)

1. **Міграції застосовані** (0016 + 0018) до dev-БД — повторно НЕ треба.
2. **Seed виправлений і пересіяний** (12/20/14/8). Пам'ятай: seed кейсів = `onConflictDoNothing`,
   тож зміна seed-даних вимагає спершу `delete from eval_runs; delete from eval_batches; delete from eval_cases`, тоді `pnpm db:seed`.
   **Сесія 2:** seed отримав `category` (bug/perf/security) → щоб чип у CaseRow показав категорію на seed-кейсах, потрібен **пере-сід** за цією ж процедурою.
2b. **Рестарт :3001 після Сесії 2** обовʼязковий — контракт (`Expectation.category`), drill-down FINDINGS-фікс і Anthropic `temperature`-retry живуть у серверному коді.
3. **Рестарт API :3001** обов'язковий після pull/зміни коду — Fastify реєструє роути на старті.
4. Перший справжній прогін — кнопка **Run all evals** (реальний LLM-виклик, коштує $).

---

## Незакриті дрібниці / follow-ups (не блокери)

- `compareBatches` тепер повертає **422**, якщо обидва батчі all-errored (метрики null) — UI compare
  варто показувати «not comparable» замість тосту-помилки. Рідкісний edge (S2 обмежує compare до full-батчів).
- `getTrend` **тихо** відкидає sealed-but-all-errored full-батчі з тренду (немає wire-сигналу «N excluded») —
  наслідок замороженого non-nullable контракту `EvalTrendPointV2`. Видимий індикатор = зміна контракту.
- `client/src/vendor/shared/contracts/eval-ci.ts` синкнуто з сервером (AgentManifest) — це трек
  **Export-to-CI**, НЕ L06. Має йти **окремим комітом** (не в L06-коміт).

---

## 🐞 Журнал нових багів

> **Сюди дописуй нові баги.** Формат кожного запису — заголовок + що бачиш + де (URL/крок) + скрін (за наявності).
> Коли візьмеш баг у роботу — постав статус. Вирішені лишай із познач́кою ✅ (для історії).

**Шаблон:**
```
### [ID] Короткий заголовок — СТАТУС (new / in-progress / ✅ fixed)
- Симптом: <що саме не так, як відтворити>
- Де: <екран / роут / файл, якщо відомо>
- Скрін: <опис або посилання>
- Діагноз/фікс: <заповнюється при вирішенні>
```

### B1 CaseEditor: Select типу очікування не відкривався, клік перемикав на «must find» — ✅ fixed (2026-07-06)
- Симптом: клік по «Expectation type» не розкривав список; значення тихо ставало першим варіантом.
- Де: модалка «Edit eval case» → рядок expectation → Select типу.
- Діагноз/фікс: `SelectInput` був у `<label>`; React синхронно флашить discrete-подію, тож клік
  синтетично «дострілював» по першій кнопці-опції. Знято `<label>` → `<div>` у `CaseEditor.tsx`.
  Регресійний тест у `CaseEditor.test.tsx`. Деталі — `client/insights.md` (2026-07-06).

<!-- Нові баги додавай нижче цього рядка -->

### B6 Newer Anthropic models Degraded — `temperature` deprecated (CODE bug in AnthropicProvider) — ✅ fixed (2026-07-06)
- **FIX APPLIED:** `anthropic.ts` gained `createMessage()` wrapper + `isTemperatureDeprecatedError()` (status===400 + /temperature/i on body/message) → retries once with `temperature` stripped, no hardcoded model list; both `doComplete`+`completeStructured` route through it. Test `server/test/anthropic-provider.test.ts` (4/4). Also `pricing.ts` gained `claude-sonnet-5` ($3/$15) so Claude-5 runs show COST (fable-5 was already priced). After restart :3001, fable-5/sonnet-5 give Clean **with** cost. Commit: `fix(server): retry Anthropic calls without temperature on deprecation 400` (+ pricing entry, can fold in).
- **ФАКТ (з БД `eval_runs.error_message`, витягнуто після drill-down-фічі):** `400 invalid_request_error: "`+"`"+`temperature`+"`"+` is deprecated for this model."` для `claude-fable-5` (провайдер anthropic). **Це НЕ model-access** — модель доступна, Anthropic відхиляє **параметр запиту**. Попередня «інференція про 404/alias» була **ХИБНА** — саме тому й будували drill-down-фічу; вона одразу дала правду.
- Причина (код): `server/src/adapters/llm/anthropic.ts` **хардкодить** `temperature` у двох місцях — `doComplete` (:75 `?? 0.2`) і `completeStructured` (:111 `?? 0`, цим іде review/eval). Новіші Anthropic-моделі (fable-5, ~sonnet-5) задепрекейтили `temperature` → 400. haiku ще приймає → Clean. Ламає **будь-який** рев'ю з новішими Anthropic-моделями, не лише eval.
- Симптом: bare Anthropic-id (`claude-fable-5`/`claude-sonnet-5`, `provider=anthropic`) → усі кейси Error, метрики/cost «—», Degraded. haiku на тому ж ключі — Clean.
- Фікс (код, shared adapter): не слати `temperature` для моделей, що його відхиляють — найробустніше **retry без `temperature` при 400 з «temperature»** (обидва методи), без хардкод-списку моделей. Обхід без коду: лишити робочі моделі (haiku / gpt-5 / gemini-2.5-flash / deepseek).
- Побічно: `claude-sonnet-5`/`claude-fable-5` відсутні в `server/src/adapters/llm/pricing.ts` `PRICING` → COST=«—» навіть за успішного прогону (додати ціни + синк із backfill-міграцією за конвенцією файлу).

### B7 (UX / redesign) CaseEditor — переробити під зразок «Eval case» (source-aware, two-panel) — ✅ implemented (2026-07-06, UNCOMMITTED)
- Симптом: поточний CaseEditor — проста однопанельна модалка (Name / Diff / рядки Expectation / Notes). НЕ показує: тип теста (Accept→`must_find` / Dismiss→`must_not_flag`), провенанс («seeded from an accepted/dismissed finding»), агента-власника, банер **NEGATIVE CASE**, панель «Expected output» у вигляді finding-skeleton JSON + «+ Finding skeleton», стрічку «Last run … · Ns · $», toggle «Run on save», кнопку «Run case». Треба переробити під зразок зі скрінів: двоколонкова розкладка (ліворуч Input із табами Diff/Files/PR meta, праворуч Expected output; для `must_not_flag` — «assert empty» / `[]`), source-aware заголовок+підзаголовок, банер негативного кейса; те саме вікно для СТВОРЕННЯ нового (manual) кейса. Плюс інструкція: яка інформація auto-підтягується / обирається зі списку / вводиться вручну (на базі `createCaseFromFinding` + review-agent `Finding`-контракту).
- Де: client `.../EvalsTab/_components/CaseEditor/CaseEditor.tsx` (модалка edit+create); джерело авто-даних — server `modules/eval/service.ts::createCaseFromFinding`; контракти `contracts/eval-batch.ts` (`Expectation`/`EvalCaseListItem`) + `contracts/findings.ts` (`Finding`); дія «Add to evals» у `FindingCard.tsx`.
- Скрін: 2 зразки — (1) позитивний `stripe-key-leak` (Security Reviewer · assert expected output; JSON з 1 finding); (2) негативний `no-unused-import-warning` (Seeded from a dismissed finding · банер NEGATIVE CASE · `[]` assert empty). Обидва: Run-on-save toggle · Cancel/Run case/Save · стрічка «Last run passed · expected 1, got 1 · 1.8s · $0.02».
- Діагноз/фікс: **РЕАЛІЗОВАНО** за планом `docs/plans/2026-07-06-case-editor-redesign.md`. Scope-рішення користувача: (Q1) expected-output = finding-skeleton VIEW над наявним `Expectation[]` (без JSON-парсера, без зміни AC-19/AC-24 матчингу); (Q2) повний скрін вкл. Files/PR-meta — але Files парситься з диффа клієнтом, PR-meta уже в case-item, тож ЄДИНА backend-дельта = стрічка Last-run; (Q3) тип = редагований Select + провенанс у заголовку.
  - **Phase A (backend):** `EvalCaseListItem` +`last_run_duration_ms`/`last_run_cost_usd` (nullish) у ОБОХ байт-ідентичних дзеркалах `contracts/eval-batch.ts`; `caseListItem` (`server/src/modules/eval/helpers.ts`) заповнює з `latestRun`. Без міграції.
  - **Phases B–F (client):** `CaseEditor.tsx` переписано — двопанель, source-aware header/subtitle (проп `agentName`), банер NEGATIVE CASE для `must_not_flag`, `Tabs`(Diff/Files/PR-meta) + `Toggle`(Run on save) з vendored-ui, finding-skeleton панель (`+ Finding skeleton`, бейдж valid JSON / assert empty, read-only JSON-view), стрічка Last-run, кнопка `Run case` → `onRunCase` (EvalsTab.runCase, 202+poll). `EvalsTab` передає `agentName`/`onRunCase`/`runDisabled` в обидва call-site. i18n у `messages/en/agents.json` (`evals.editor.*`).
  - **✅ severity/category РЕДАГОВАНІ у формі (follow-up #1 закрито):** для `must_find`-рядка додано `Severity` (CRITICAL/WARNING/SUGGESTION + «—») та `Category` (bug/security/perf/style/test + «—») Select'и; показуються ЛИШЕ для `must_find` (тож `must_not_flag`-рядок лишається 1-combobox і не ламає B1-регрес — його фінальний assert переведено на стабільне `trigger`-посилання). `emptyExpectation('must_find')` префілить WARNING/bug → finding-skeleton JSON повний із коробки. Значення персистяться у save-payload (display-only, AC-24 — у скорингу не беруть участь). Закриває й давній handoff-нюанс «CaseEditor-форма не має полів severity/category».
    - **Косметичний фікс (зі скріна користувача):** `skeletonJson` більше НЕ підставляє дефолти `?? "WARNING"`/`?? "bug"`, а **пропускає** невиставлені severity/category → JSON-view чесно збігається зі станом Select «—» (раніше Select показував «—», а JSON — «bug»; причина «—» на seed-кейсах = БД сідовано до додавання category + `onConflictDoNothing` не перезаписує → потрібен re-seed або вибір у Select). PR-meta «—» (Source PR / Source finding) на seed-кейсах — очікувано: seed не пише `input_meta`, тож `source='manual'`; заповнюється лише для кейсів із «Add to evals».

### B8 Seed: 5 eval-кейсів для Security Reviewer — ✅ done (2026-07-06, UNCOMMITTED)
- Симптом/запит: у Security Reviewer порожня вкладка Evals; треба 5 кейсів «як у General», щоб теж тестувались.
- Де: `server/src/db/seed.ts` — новий блок `if (securityReviewer) { … }` одразу після General-блоку (перед `return`).
- Діагноз/фікс: додано 5 кейсів (UUID `22222222-2222-4222-a222-00000000000{1..5}`, `ownerId = 'Security Reviewer'`), структурно дзеркалять General (2× must_find, 1× must_not_flag, 1× mixed, 1× clean), теми з домену агента (secrets/injection/SSRF): (1) hardcoded Stripe key `src/config.ts:12` CRITICAL/security; (2) SSRF `webhooks/service.ts:16-18`; (3) parameterized-query-safe `auth/repository.ts:23-26` must_not_flag; (4) command-injection `export/service.ts:8` + rename must_not_flag `:30-31`; (5) clean `auth/middleware.ts` `[]`. New-side номери протрасовано напряму по `diff-parser.ts` (`newLineNumbers`) — усі в межах ханків. Server typecheck ✅.
- **ОПЕРАЦІЙНЕ:** нові UUID → **звичайний `cd server && pnpm db:seed` доллє 5 рядків БЕЗ видалення** наявних (onConflictDoNothing не чіпає General-кейси). Далі рестарт :3001 (не обовʼязково для лише-seed, але для узгодженості) і вкладка Evals у Security Reviewer покаже 5 кейсів; перший **Run all evals** — реальний LLM-виклик ($).

### B9 Calibration (single-case) run «зависає / не звітує» — ✅ fixed (2026-07-06, UNCOMMITTED)
- Симптом: одиночний прогін (per-row ▷ або нова кнопка «Run case») створює **calibration**-батч, який у UI ніколи не завершується — pending не спадає, метрики/case-list не оновлюються; у Batch History рядок лишається «Calibration» з «—».
- Корінь: `run-orchestrator.executeBatch` запечатував калібрацію як `status = null` (`batch.kind === 'calibration' ? null : …`). А клієнт (`hooks/eval.ts` `useEvalBatchDetail` refetchInterval + `useEvalRunCompletion`) використовує `status == null` як «ще виконується» → калібрація для клієнта не завершується НІКОЛИ (нескінченний polling, немає інвалідації). Прееxisting баг з L06, який нова «Run case» зробила помітнішим.
- Фікс: запечатувати **кожен** батч реальним `clean/degraded` (`const status = anyError ? 'degraded' : 'clean'`). Безпечно: лейбл «Calibration» у `BatchHistoryTable` береться з `batch.kind` (не status); `listTrendBatches`/`previousFullBatch` фільтрують `kind='full'` → калібрація НЕ потрапляє в тренд/KPI (AC-28 ок). Оновлено коментар схеми `db/schema/eval.ts` (status=null лише поки батч не запечатано). Регрес-тест у `eval-service.test.ts` (calibration seal `not.toBeNull()`). Гейти: server typecheck + eval 62/62 ✅.
- Про конкретний рядок 17:01:44 (усі «—»): найімовірніше цей одиночний кейс **впав у рантаймі** (провайдер/таймаут) → сілився з усіма-null метриками; **розгорни рядок** у Batch History → drill-down покаже `Error: …`. Старі «завислі» null-рядки заднім числом не полагодяться — прибрати через **Clear history**; нові прогони після рестарту :3001 працюватимуть коректно.

### B10 PR-meta порожнє на seed-кейсах → провенанс-backfill (Опція A) — ✅ done (2026-07-06, UNCOMMITTED)
- Запит: у seed eval-кейсів PR-meta показує «Hand-authored / Source PR — / Source finding —» (бо це hand-authored fixtures без `input_meta`). Користувач обрав **Опцію A**: засідати демо-PR + findings і звʼязати.
- Фікс (`server/src/db/seed.ts`): новий helper `seedEvalProvenance(db, {…})` — upsert-ить fixture-PR (спільний `number: 9001`, «Eval fixtures (provenance)»), review (deterministic id, `agentId` = агент) і findings (deterministic ids, `acceptedAt`/`dismissedAt` за рішенням). У кожному блоці (General/Security) після інсерту кейсів: викликає helper (4 findings на агента) + **UPDATE `eval_cases.input_meta`** для 4 finding-derived кейсів (`{source:'finding', source_finding_id, source_pr_number:9001}`). UPDATE (не insert) → **backfill наявних рядків на звичайному `pnpm db:seed` БЕЗ видалення**. Мапінг: must_find-кейси ← accepted finding; must_not_flag (case 3) ← dismissed finding; clean-кейс (`…0005`) **лишається hand-authored** (у нього немає source finding за визначенням — задокументований виняток). Finding ids: General `aa000000-…-011..014` (review `aa…-001`), Security `bb000000-…-011..014` (review `bb…-001`).
- Наслідки: після re-seed 8 кейсів (4 General + 4 Security) показують Source «Promoted from a finding» · Source PR «#9001» · Source finding «<id>»; підзаголовок редактора → «Seeded from an accepted/dismissed finding»; case 3 → dismissed + NEGATIVE banner. Side-effect: fixture-PR **#9001** зʼявиться у списку PR репо (self-labeled, прийнятно для демо). Провенанс лише display — прогони/скоринг не змінюються. Server typecheck ✅.
- **ОПЕРАЦІЙНЕ:** `cd server && pnpm db:seed` (backfill через UPDATE — **видаляти нічого не треба**) → рестарт :3001 → PR-meta заповнене. «Auto під час створення» вже працює для «Add to evals» (createCaseFromFinding); ручна форма джерела не має за визначенням.
  - **Гейти зелені:** server typecheck + eval 62/62; client typecheck + **CaseEditor 14/14** (8 нових: subtitle/banner/tabs/run-on-save×2/run-case/severity-render/severity-persist) + EvalsTab 16/16.
  - **Інструкція AUTO/CHOSEN/MANUAL** вписана секцією 5 у `docs/eval-tab-guide.md` (стара 6→7).
  - **Follow-ups (не блокери):** (2) таб PR-meta показує номер PR як текст, не GitHub-лінк (немає repoFullName у case-item); (3) `Run on save` тумблер скидається при кожному відкритті (локальний стан, не persist). **Re-seed НЕ потрібен** (зміни лише в коді+контракті). Рестарт :3001 — потрібен (серверний `caseListItem`).
