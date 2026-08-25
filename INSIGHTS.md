# INSIGHTS — крос-модульне та інфраструктура

Знахідки, що не належать одному модулю: спільні контракти, `scripts/`, CI,
Docker, тулінг репозиторію. Append-only — див.
[`.claude/skills/engineering-insights`](.claude/skills/engineering-insights/SKILL.md).

---

## 2026-07-28 · gotcha
**`skills-lock.json` описує лише вендорені скіли — локальні туди не додаються**
Кожен запис має реальний `source` на GitHub і `computedHash` для перевірки
цілісності. Локально написаний скіл апстріму не має, тож запис із синтетичним
джерелом зламає перевірку. Локальні скіли живуть у `.claude/skills/` поза
lock-файлом.
Доказ: skills-lock.json:5

## 2026-07-28 · gotcha
**Симлінк `.cursor/skills/` задокументований, але в репозиторії його немає**
README каталогу скілів обіцяє `.cursor/skills/ → ../.claude/skills` для
сумісності з Cursor. Фактично теки `.cursor` не існує — Cursor скіли не підхопить,
доки симлінк не створять руками.
Доказ: .claude/skills/README.md:3

## 2026-07-28 · gotcha
**pnpm блокує `pnpm exec`/`pnpm run <script>` без інтерактивного підтвердження build-скриптів — і це стається в КОЖНОМУ pnpm-пакеті репо**
`pnpm exec drizzle-kit generate` (і будь-яка інша команда, що йде через
`pnpm exec`/`pnpm <script>`) валиться з `ERR_PNPM_IGNORED_BUILDS`, бо pnpm
спершу прогонює прихований `pnpm install` для перевірки залежностей, а той
впирається в неапрувнуті build-скрипти (esbuild, sharp, cpu-features, ...) і
чекає на `pnpm approve-builds`, якого в неінтерактивній сесії ніхто не дасть.
Обхід: викликати бінарник напряму, минаючи pnpm-обгортку —
`node node_modules/<pkg>/bin.cjs ...` (напр. `node node_modules/drizzle-kit/bin.cjs generate`)
або `node_modules/.bin/tsc`/`node_modules/.bin/vitest` замість `pnpm exec`.
Доказ: server/package.json:14 (`"db:generate": "drizzle-kit generate"`)

## 2026-07-28 · gotcha
**Testcontainers (`.it.test.ts`) можуть зависати на 120с навіть коли `docker info` успішний**
`dockerAvailable()` перевіряє лише `docker info`, але фактичний запуск
контейнера через testcontainers-node — окремий шлях, який у пісочниці агента
може підвисати на hook timeout, а не чисто скіпатись. Якщо `.it.test.ts` висять
на таймауті замість очікуваного skip/pass — спробуй прогін з вимкненим
пісочним обмеженням інструменту Bash, перш ніж робити висновок про поламаний код.
Доказ: server/test/helpers/pg.ts:23,36

## 2026-07-31 · gotcha
**`server/src/vendor/shared` і `client/src/vendor/shared` — дві фізично окремі, git-tracked копії контрактів `@devdigest/shared`, без симлінка чи sync-скрипта**
`client/tsconfig.json` мапить аліас `@devdigest/shared` на
`./src/vendor/shared/index.ts` — власну копію клієнта, а не на серверний пакет.
Коміт `5ce9475` ("feat(pulls-api): add per-PR findings_summary...") додав
`findings_summary`/`FindingsSummary`/`FindingsSummaryItem` лише в
`server/src/vendor/shared/contracts/platform.ts`, не торкнувшись клієнтської
копії — хоча план (task-4-brief) стверджував, що тип уже "flows through" до
клієнта. Реально `pnpm typecheck` у client валився з
`Property 'findings_summary' does not exist` доки я вручну не портував той
самий diff у `client/src/vendor/shared/contracts/platform.ts`. Попередній
коміт `91263c0` ("feat(reviews): show run cost...") оновлював ОБИДВІ копії
разом — тобто дублювання навмисне й відоме, але однопакетний таск-бриф це
легко проґавлює. Перевіряй обидві копії при будь-якій зміні контракту.
Доказ: server/src/vendor/shared/contracts/platform.ts:158-201 vs
client/src/vendor/shared/contracts/platform.ts (до фіксу цього ж дня не мав
`findings_summary` взагалі)

## 2026-08-11 · gotcha
**Порядок секцій у `.claude/agents/README.md` — не алфавітний, а конвеєрний**
Секції йдуть у порядку хендофу (`researcher` → `implementation-planner` →
`implementer` → `test-writer` → `architecture-reviewer` → `plan-verifier` →
`doc-writer`), як описано в секції "Хендоф" унизу того ж файлу, і збігається
з порядком у заголовку `docs/claude-code-agents.md:1`. При перейменуванні чи
додаванні агента зберігай його позицію в конвеєрі — не "виправляй" на
алфавітний порядок (я спершу помилково запланував саме це при перейменуванні
`planner.md` → `implementation-planner.md`, довелось відкотити рішення після
повторного читання файлу).
Доказ: .claude/agents/README.md:200-211


## 2026-08-18 · gotcha
**`skill-creator`'s `scripts/aggregate_benchmark.py` тихо занулює tokens і ігнорує описово названі eval-теки — обидва без жодного попередження**
Два незалежні дефекти зловлені під час Експерименту 1 (L06, скіл `zod`, 2
кейси × with/without × 2 прогони):
(1) Виявлення eval-тек читає буквально `benchmark_dir.glob("eval-*")` —
тека з описовою назвою (`user-profile-route-review/`), яку сам SKILL.md
скіла прямо радить використовувати ("Give each eval a descriptive name...
not just eval-0"), просто пропускається з "No eval directories found" без
іншого попередження. Обхід — префіксувати описову назву `eval-N-`
(`eval-1-user-profile-route-review`) — реальний `eval_id` все одно береться
з `eval_metadata.json`, префікс потрібен лише для glob'а.
(2) Токени рахуються ЛИШЕ з сусіднього `timing.json`, і лише якщо
`result["time_seconds"] == 0.0` — якщо `grading.json` сам містить
`"timing": {"total_duration_seconds": ...}` (а `agents/grader.md`'s Step 8
прямо радить туди скопіювати timing.json), гілка з токенами взагалі не
виконується і всі прогони показують `tokens: 0` без жодного попередження.
Обхід — не класти `total_duration_seconds` всередину `grading.json`, лишати
timing-дані тільки в сусідньому `timing.json`.
Доказ: `~/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator/scripts/aggregate_benchmark.py:86-152`

## 2026-08-19 · gotcha
**`Bash`-тул відсутній у сесії `implementer`-агента з самого початку (SPEC-05
T13) — не "стався збій", а взагалі не був у списку доступних інструментів**
Задача прямо попереджала, що це вже траплялось двічі раніше в цьому ж плані
("both times caught and fixed by the coordinator running tests manually") —
підтверджено втретє: у списку `functions` цієї сесії був лише
`Read/Edit/Write/Skill/Grep/Glob`, без `Bash`. Наслідок — неможливо виконати
`pnpm typecheck`/`pnpm test`/`pnpm run verify:l06`, і неможливо фізично
перемістити/видалити файли (немає інструменту видалення) — довелось лишити
старий `EvalCaseModal`-каталог (`client/src/app/agents/[id]/_components/
AgentEditor/_components/EvalsTab/_components/EvalCaseModal/`) осиротілим
замість справжнього `mv`, коли компонент промотили в
`client/src/components/eval-case-modal/`. Правило: щойно виявив відсутність
`Bash` у списку інструментів — одразу зафіксувати це в звіті координатору
(а не намагатись "симулювати" typecheck вручну чи мовчки обходити відсутність
видалення файлів) — так само, як цей запис.
Доказ: system prompt цієї сесії (`<functions>`-блок без `Bash`), задача-промпт
секції "Run the full test suite afterward... this has happened twice before"

## 2026-08-19 · gotcha
**Відсутність `Bash` у сесії `implementer` для SPEC-05-евалів — не разовий
збій, а системне: підтверджено ЧЕТВЕРТИЙ раз, на іншому плані того ж
"сімейства" (`evals-tab-mockup-alignment.md`)**
Продовжує запис вище (2026-08-19, "втретє") — цього разу для окремого,
пізнішого плану (`.claude/plans/evals-tab-mockup-alignment.md`, той самий
`EvalsTab`/`eval-dashboard` кут кодової бази), і знову список `functions`
сесії містив лише `Read/Edit/Write/Skill/Grep/Glob`, без `Bash`. Візерунок:
проблема прив'язана не до конкретного плану чи задачі, а до того, ЯК
координатор запускає `implementer`-агента для цієї гілки роботи (evals/
SPEC-05) — варто перевірити конфігурацію дозволів інструментів для цього
конкретного ланцюжка агентів, а не List кожен раз як окремий інцидент.
Наслідок для виконавця: імплементація (Read/Edit/Write) пройшла повністю, але
`pnpm test`/`pnpm typecheck` в `client/` та `pnpm exec vitest run` в `server/`
не були запущені цією сесією — координатор/наступна сесія має прогнати їх
вручну перед тим, як вважати роботу підтвердженою.
Доказ: system prompt цієї сесії (`<functions>`-блок без `Bash`); той самий
симптом задокументовано вище для іншого плану того ж SPEC-05 evals-треку.

## 2026-08-20 · gotcha
**Існує ТРЕТЯ, задокументована лише коментарем копія `FEATURE_MODELS` —
`client/src/lib/feature-models.ts` — окремо від вже відомого dual-copy
`vendor/shared` (запис 2026-07-31), і вона вже розійшлась зі значеннями**
Крім `server/src/vendor/shared/contracts/platform.ts` і
`client/src/vendor/shared/contracts/platform.ts` (типова dual-copy пара),
`client/src/lib/feature-models.ts` тримає ЩЕ ОДНУ ручну копію самого масиву
`FEATURE_MODELS` — власний коментар файлу пояснює чому: імпорт `vendor/shared`
як RUNTIME-значення (не типу) тягне `vendor/shared/index.ts` у webpack-бандл,
чиї `./contracts/*.js` реекспорти Next не резолвить, тож масив довелось
продублювати вручну (`client/src/lib/feature-models.ts:1-11`). Ця третя копія
вже розійшлась ДО цієї сесії: `review_intent` тут має `defaultProvider:
'openai'`/`defaultModel: 'gpt-4.1'` (`client/src/lib/feature-models.ts:21-27`),
тоді як обидві копії `vendor/shared` мають `'openrouter'`/
`'deepseek/deepseek-v4-flash'`; `conventions` тут має `'openai'`/`'gpt-5.4'`
(`client/src/lib/feature-models.ts:42-48`) проти `'openrouter'`/
`'deepseek/deepseek-v4-flash'` в обох `vendor/shared`. Ця сесія (SPEC-06 T6,
план skill-editor.md Step 1) додала новий `FeatureModelId` `'skill_eval'` +
відповідний запис `FEATURE_MODELS` в ОБИДВІ копії `vendor/shared`
(`server/src/vendor/shared/contracts/platform.ts`,
`client/src/vendor/shared/contracts/platform.ts`), але НЕ торкнулась
`client/src/lib/feature-models.ts` — поза обсягом server-only кроку. Тип
`FeatureModelId` реекспортується з `vendor/shared` і лишається синхронним
автоматично, а `FEATURE_MODELS`-МАСИВ — ні: наступний, хто торкнеться
`client/src/app/settings/[section]/_components/SettingsView/_components/SettingsModels/SettingsModels.tsx`
(яка читає саме цю третю копію,
`SettingsModels.tsx:9-10`), мусить додати туди `'skill_eval'` вручну — інакше
нова фіча мовчки не з'явиться в Settings UI, без жодного падіння typecheck чи
тесту.
Доказ: client/src/lib/feature-models.ts:1-11,21-27,42-48;
client/src/app/settings/[section]/_components/SettingsView/_components/SettingsModels/SettingsModels.tsx:9-10

## 2026-08-22 · gotcha
**Відсутність `Bash` у сесії `implementer` — підтверджено ще і для ТРЕТЬОГО,
незалежного плану (`multi-agent-review.md`, SPEC-07), поза "сімейством"
evals/SPEC-05, яке вже фіксували два записи від 2026-08-19**
Ті записи припускали, що проблема прив'язана саме до "цієї гілки роботи
(evals/SPEC-05)". Ця сесія (Implementer 1 — Contracts + DB, план
`.claude/plans/multi-agent-review.md`) — зовсім інший план, інший таск-бриф,
інший координатор-виклик — і знову список `functions` містив лише
`Read/Edit/Write/Skill/Grep/Glob`, без `Bash`. Висновок сильніший, ніж
попередній: це не особливість конкретного ланцюжка агентів (evals), а
систематична поведінка ЦЬОГО типу дочірньої сесії (`implementer`, викликаний
з написаного плану) незалежно від теми плану. Наслідок для цього конкретного
плану: T2 (`node node_modules/drizzle-kit/bin.cjs generate` + `pnpm
db:migrate`) і крок 3 (`pnpm typecheck`) НЕ були виконані цією сесією — лише
Read/Edit-частина (contracts + `db/schema/runs.ts`) готова; координатор
мусить сам згенерувати міграцію і прогнати typecheck, а не вважати ці кроки
підтвердженими.
Доказ: system prompt цієї сесії (`<functions>`-блок без `Bash`); попередні
підтвердження — root INSIGHTS.md, записи 2026-08-19 (двічі, для evals/SPEC-05)

## 2026-08-22 · gotcha
**Додавання нового `.nullable()` (НЕ `.optional()`) поля до спільного
zod-контракту в `vendor/shared` ламає typecheck у КОЖНОМУ пакеті, що імпортує
той самий тип для типізованого fixture-builder'а — не лише в пакеті, що
"власник" зміни**
`RunSummary.multi_agent_run_id: z.string().nullable()` (нове поле, SPEC-07 T1)
є REQUIRED у виведеному TS-типі (просто `string | null`, не
`string | null | undefined`) — тож будь-який літерал, явно типізований як
`RunSummary` (fixture-builder з дефолтами + `...overrides`), мусить явно
включати поле, інакше `tsc` кричить "Property is missing", НЕЗАЛЕЖНО від
того, парситься об'єкт через zod чи ні (це компіляційна, а не рантайм-помилка,
на відміну від запису 2026-08-03 про required-поля в `.parse()`-фікстурах).
Знайдено одразу в трьох місцях, з яких лише одне (server) було в "Modules
involved" плану: `server/src/modules/brief/service.test.ts` (власний
пакет), `client/.../RunHistory/RunHistory.test.tsx` (інший пакет, той самий
тип через client-копію `vendor/shared`), і
`mcp-server/test/support/fixtures.ts` +
`mcp-server/test/tools/run-agent-on-pr.test.ts` (ТРЕТІЙ пакет, зовсім поза
"Modules involved" плану й поза `TESTING.md` — `mcp-server/tsconfig.json:14`
аліасить `@devdigest/shared` прямо на серверну копію, тож серверна правка
дiстає його типчек безкоштовно). Перевіряй `grep -rn "<TypeName>" .` по
ВСЬОМУ репо (не лише всередині "Modules involved" плану), коли додаєш
non-optional поле (nullable чи ні) до спільного контракту — package-scoped
grep пропустить сусідні пакети, що теж імпортують ту саму `vendor/shared`
копію.
Доказ: server/src/vendor/shared/contracts/trace.ts (`multi_agent_run_id:
z.string().nullable()`); mcp-server/tsconfig.json:14 (`"@devdigest/shared":
["../server/src/vendor/shared/index.ts"]`)

## 2026-08-22 · gotcha
**Відсутність `Bash` у сесії `implementer` — підтверджено ВЧЕТВЕРТЕ, тепер і для
Implementer 4 (Client: results views) того самого плану `multi-agent-review.md`,
що вже дав підтвердження №3 для Implementer 1 того ж плану того ж дня**
Записи від 2026-08-19 (×2, evals/SPEC-05) і від 2026-08-22 вище (Implementer 1,
цей самий план) уже показали, що це системна поведінка `implementer`-сесій, не
особливість однієї теми плану. Ця сесія (Implementer 4 — ColumnsView/
TabsDetailView/AgentsDisagreeSection/i18n, кроки 15-20 того самого плану)
підтверджує це ЩЕ РАЗ — і додає новий факт: підтвердження №3 і №4 стались в
ОДНОМУ Й ТОМУ Ж плані, у двох різних, послідовно запущених implementer-групах
(Implementer 1 і Implementer 4), тобто це не "одна нетипова сесія" — кожна
implementer-група в multi-agent workflow цього плану отримала сесію без Bash.
Наслідок для координатора: `pnpm typecheck`/`pnpm test` в `client/` для T11-T16
(нові `_components/ColumnsView`, `_components/TabsDetailView`,
`_components/AgentsDisagreeSection`, промоція `outcomeOf` у `client/src/lib/
run-outcome.ts`, новий хук `useReviewGroups` у `client/src/lib/hooks/reviews.ts`)
НЕ були виконані цією сесією — лише Read/Edit/Write-частина готова, координатор
мусить сам прогнати їх.
Доказ: system prompt цієї сесії (`<functions>`-блок без `Bash`); попередні
підтвердження — root INSIGHTS.md, записи 2026-08-19 (×2) і 2026-08-22 вище

## 2026-08-22 · gotcha
**Відсутність `Bash` у сесії `implementer` — П'ЯТИЙ підтверджений раз, тепер
на зовсім іншому треку (`export-to-ci.md`, окремий git worktree
`devdigest-ci`, не evals/SPEC-05)**
Продовжує записи від 2026-08-19 (там — двічі, обидва на evals/SPEC-05 треку,
з гіпотезою "прив'язано до того, як координатор запускає evals-ланцюжок
агентів"). Ця сесія спростовує вузьке трактування тієї гіпотези: той самий
симптом (список `functions` = лише `Read/Edit/Write/Skill/Grep/Glob`, без
`Bash`) стався на ЗОВСІМ іншому плані (Group 2 з `export-to-ci.md`,
server-side `ci/`-модуль, жодного зв'язку з evals/SPEC-05) і в окремому git
worktree. Тобто причина системніша, ніж "конкретний evals-ланцюжок" —
схоже, координатор інколи запускає `implementer`-агента без `Bash` незалежно
від задачі/плану/worktree. Наслідок цієї сесії: увесь `server/src/modules/ci/`
(5 нових файлів + реєстрація в `modules/index.ts`) написаний і
самоперевірений виключно читанням коду (типи, імпорти, drizzle-схема,
контракти) — `pnpm typecheck`/`pnpm exec vitest run` у `server/` НЕ
запускались цією сесією; координатор має прогнати їх сам перед тим, як
вважати Group 2 підтвердженою.
Доказ: system prompt цієї сесії (`<functions>`-блок без `Bash`); попередні
записи 2026-08-19 (двічі) вище в цьому ж файлі, обидва на іншому треку/плані

## 2026-08-22 · gotcha
**ШОСТИЙ підтверджений раз відсутності `Bash` у сесії `implementer` — тепер
на Group 3 ТОГО САМОГО плану (`export-to-ci.md`), одразу після запису вище
про Group 2 в тому самому worktree**
Продовжує попередній запис (той самий день, той самий план, Group 2). Group 3
(`server`: `GitHubClient.listWorkflowRunsFor`/`downloadRunArtifact` +
`octokit.ts`/`mocks.ts` + `ci/repository.ts`/`service.ts`/`routes.ts`'s
ingest+read half) написана й самоперевірена виключно читанням коду (типи,
drizzle-схема, Zod-контракти, звірка з реальними Octokit-типами в
`node_modules`) — `pnpm typecheck`/`pnpm exec vitest run` у `server/` НЕ
запускались цією сесією. Той самий симптом двічі поспіль в одному плані
підсилює гіпотезу з попереднього запису: координатор явно й систематично
запускає `implementer`-агентів цього плану без `Bash`, а не разово. Наслідок
для координатора: обидві групи (2 і 3) потребують реального прогону
typecheck/тестів перед тим, як вважати їх підтвердженими — жодна з двох
сесій-імплементерів не могла це зробити сама.
Доказ: system prompt цієї сесії (`<functions>`-блок без `Bash`); запис вище
для Group 2, той самий план і той самий worktree `devdigest-ci`

## 2026-08-22 · gotcha
**СЬОМИЙ підтверджений раз відсутності `Bash` у сесії `implementer` —
Group 4 того самого плану (`export-to-ci.md`), клієнтська частина**
Продовжує два записи вище (Group 2, Group 3, той самий день, той самий
worktree `devdigest-ci`). Group 4 (`client`: нова вкладка CI в
`AgentEditor`, `_components/CiTab/`, увесь `ExportWizard` — 24 нових файли
+ 3 відредаговані існуючі + `messages/en/ci.json`) написана й
самоперевірена виключно читанням коду (типи, імпорти, `@devdigest/ui`
барели, i18n-ключі звірені вручну по кожному виклику `t(...)`) —
`pnpm typecheck`/`pnpm test` у `client/` НЕ запускались цією сесією. Тепер
підтверджено на ТРЬОХ групах поспіль одного плану (2, 3, 4) — гіпотеза
"координатор систематично запускає `implementer`-агентів цього плану без
`Bash`" більше не потребує додаткового підтвердження для цього плану
конкретно; кожна наступна група того ж плану має вважатись такою, що
потребує реального прогону typecheck/тестів координатором, за замовчуванням.
Доказ: system prompt цієї сесії (`<functions>`-блок без `Bash`); записи
вище для Group 2/Group 3, той самий план і той самий worktree `devdigest-ci`

## 2026-08-25 · gotcha
**Відсутність `Bash` у сесії `implementer` — ВОСЬМИЙ підтверджений раз, тепер
на плані `agent-performance-dashboard.md` (server + client, обидва пакети
одної сесії)**
Продовжує довгий ряд записів вище (2026-08-19 ×2, 2026-08-22 ×4) — знову
список `functions` цієї сесії містив лише `Read/Edit/Write/Skill/Grep/Glob`,
без `Bash`. Новий факт: цього разу це один суцільний implementer-прогін, що
торкнувся ОБОХ пакетів одразу (`server/src/modules/agents/*`,
`client/src/app/agent-performance/**`, `client/src/lib/hooks/agents.ts`,
`client/src/vendor/ui/nav.ts`) — попередні підтвердження завжди були
по-пакетно (окремий implementer на server, окремий на client). Наслідок:
`pnpm exec vitest run` (server unit + `.it.test`) і `pnpm test`/`pnpm
typecheck` (client) НЕ були виконані цією сесією — лише Read/Edit/Write.
Координатор/наступна сесія має прогнати їх сама, включно з новим
`server/test/agent-stats.it.test.ts` кейсом (потребує Docker) і новим
`client/.../AgentPerformanceView/AgentPerformanceView.test.tsx`.
Доказ: system prompt цієї сесії (`<functions>`-блок без `Bash`); попередні
підтвердження — записи 2026-08-19 (×2) і 2026-08-22 (×4) вище в цьому файлі
