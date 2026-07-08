# Інструкція: skill-creator у контексті dev-digest

`skill-creator` — це Anthropic-плагін (`.claude/skills` живуть у проєкті, сам плагін —
зовнішній, підвантажується через `Skill` tool як `anthropic-skills:skill-creator`). Він не
пише код продукту — він створює, тестує й оптимізує самі **скіли** (`.claude/skills/*`), якими
потім користуються агенти цього репо (`implementer`, `spec-creator`, `researcher` тощо).

Використовуйте його, коли зміна стосується поведінки скіла, а не самого коду `server/`/`client/`.
Для дрібного правки тексту в `SKILL.md` (одне речення, одне уточнення) простіше відредагувати
файл напряму — цей плагін виправдовує себе, коли потрібно **перевірити**, що зміна справді
покращує (а не ламає) поведінку.

## Межі застосування: скіли, а не агенти

`skill-creator` за власним описом і будовою обмежений **скілами** (`.claude/skills/*`,
те, що викликається через `Skill` tool) і не поширюється на **агентів** (`.claude/agents/*.md`,
суб-агентні визначення цього репо: `implementer`, `spec-creator`, `researcher`,
`plan-verifier`, `doc-writer`, `test-writer` тощо).

Слово "agent"/"subagent" у самому плагіні зустрічається лише як **механізм виконання** —
він сам спавнить службових субагентів, щоб прогнати тестовий промпт "зі скілом" (а файли
`agents/grader.md`, `agents/comparator.md`, `agents/analyzer.md` — це інструкції саме для
цих службових виконавців, а не для оцінювання визначень агентів проєкту). Тобто плагін не
вміє:

- перевіряти, чи `.claude/agents/<name>.md` коректно тригериться / правильно обмежує
  список tools;
- бенчмаркати одну версію промпту агента проти іншої (A/B за якістю виконання задачі);
- оптимізувати `description` в frontmatter агента — там інший формат і інше призначення
  (маршрутизація при spawn через `Agent` tool, а не Skill-тригеринг).

Найближче в цьому репо до "оцінювання агентів" — скіл **`workflow-retro`**: він робить
ретроспективу вже виконаного прогону (токени, cache-hit, паралелізм, тривалість), але це
аналіз одного прогону постфактум, а не A/B-тест якості самого промпту агента. Спеціального
інструменту на кшталт `skill-creator`, але для `.claude/agents/*`, у цьому репо наразі нема.

## Сценарій 1 — створити новий скіл із нуля

**Коли:** з'явився повторюваний патерн роботи, якого ще нема серед `.claude/skills/`
(наприклад: "перевірка міграцій Drizzle на безпечність", "генерація OpenAPI з Fastify-схем",
"чекліст перед `git push` для L0x lesson-гілки").

**Як:** описати задачу словами прямо в терміналі — Claude сам розпізнає, що це задача для
плагіна `skill-creator`, проведе інтерв'ю (що робить, коли тригериться, який формат
виводу), сам запише `SKILL.md` + `references/`/`scripts/`/`assets/` за потреби.

**Очікуваний результат:** нова папка `.claude/skills/<name>/` з `SKILL.md` (frontmatter
`name` + "трохи наполеглива" `description` для тригерингу) і, за потреби, 2-3 тестові
промпти в `evals/evals.json`.

**Приклад — промпт у термінал `claude`:**
```
створи новий скіл через skill-creator: він має перевіряти нові Drizzle-міграції на
порушення правила "DB schema is stable" з AGENTS.md — заборонено ALTER існуючих
колонок, дозволено лише нові нумеровані міграції
```
Очікувано: `.claude/skills/drizzle-migration-safety/SKILL.md` + `criteria.md`
(приклади дозволених/заборонених діффів міграцій), сумісний з `server/drizzle/`
з `AGENTS.md`.

## Сценарій 2 — покращити наявний скіл (найчастіший у цьому репо)

**Коли:** скіл існує, але щось не так — недотригерюється, видає неправильний формат,
пропускає крайні випадки. Приклад із цієї сесії: `engineering-insights` дублював записи,
губив номер рядка в anchor.

**Як:** написати в терміналі щось на кшталт "evaluate/improve <ім'я скіла> with
skill-creator". Плагін сам знайде `.claude/skills/<name>/`, спитає, чи є вже `evals/`,
і піде або одразу в ітерацію (якщо evals є), або спершу спитає тестові кейси.

**Очікуваний результат:** `iteration-N/` з парними прогонами (стара/нова версія скіла або
зі скілом/без), `benchmark.json` + `review-iteration-N.html` для перегляду, і після вашого
фідбеку — відредагований `SKILL.md`.

**Приклад — промпт у термінал `claude` (реально виконано в цьому репо):**
```
evaluate my engineering-insights skill with skill-creator
```
Результат: `.claude/skills/engineering-insights/evals/iteration-1/` з 4 фікстурами
(eval-0..3), `benchmark.json` (100% зі скілом / 100% без — виявили забруднення
baseline, див. гочу нижче), `review-iteration-1.html`; після фідбеку виправлено
втрату номера рядка в anchor і формат dedup-розширення.

## Сценарій 3 — кількісний benchmark (з навичкою / без навички)

**Коли:** треба чесно виміряти, чи скіл взагалі щось дає (не просто "виглядає розумно"), і
за скількома тест-кейсами одразу, не одним "на око".

**Промпт у термінал `claude`:**
```
запусти кількісний benchmark для скіла engineering-insights (порівняй прогони зі
скілом і без нього на всіх evals у evals/) і покажи мені pass_rate та дельту
```
Claude сам виконає це через Bash — під капотом викликає:
```sh
python <skill-creator>/scripts/aggregate_benchmark.py <workspace>/iteration-N --skill-name <name>
python <skill-creator>/eval-viewer/generate_review.py <workspace>/iteration-N \
  --skill-name "<name>" --benchmark <workspace>/iteration-N/benchmark.json \
  --static <workspace>/review-iteration-N.html   # десктоп без сервера -> завжди --static
```
`aggregate_benchmark.py` очікує `grading.json` у `eval-X/<config>/run-N/` з блоком
`"summary": {"pass_rate", "passed", "failed", "total"}` — без нього мовчки видасть 0%.

**Очікуваний результат:** `pass_rate`/`time`/`tokens` (mean ± stddev) для кожної
конфігурації + дельта. Для скілів-**детекторів** коду (типу `backend-onion-architecture`)
цей крок майже не потрібен — там природніше рахувати recall/precision по
`expected-findings.json` напряму. Benchmark у цьому стилі найкорисніший для скілів-**суддів**
(judgment/writer, як `engineering-insights`), де нема фіксованого списку "знахідок".

**Реально виконано в цьому репо через:**
```sh
python .claude/skills/engineering-insights/evals/grade.py \
  .claude/skills/engineering-insights/evals/iteration-1
python <skill-creator>/scripts/aggregate_benchmark.py \
  .claude/skills/engineering-insights/evals/iteration-1 --skill-name engineering-insights
```
Результат: `eval-0 with_skill: 6/6`, `eval-0 without_skill: 6/6`, ... для всіх 4 evals →
`benchmark.json` з `pass_rate: 1.0` для обох конфігурацій, `Delta: +0.00` (справжня причина
нуля — забруднення baseline, не марність скіла; див. нотатку про `cwd` нижче).

**⚠️ Гоча цього репо:** якщо агент-baseline (без скіла) працює з `cwd` усередині проєкту,
він може сам натрапити на `.claude/skills/<name>/` і відтворити її поведінку — дельта
"зі скілом vs без" тоді штучно обнуляється. Копіюйте фікстури поза деревом проєкту, якщо
потрібна чесна дельта.

## Сценарій 4 — оптимізація опису тригера (`description` у frontmatter)

**Коли:** скіл існує й працює, але недотригерюється (Claude не викликає його там, де
мав би) або тригериться забагато (фолз-позитиви на суміжні запити).

**Параметри запуску:**
```sh
python <skill-creator>/scripts/run_loop.py \
  --eval-set <шлях-до-trigger-eval.json> \
  --skill-path .claude/skills/<name> \
  --model claude-opus-4-8 \
  --max-iterations 5 --verbose
```
Ключові прапорці: `--holdout 0.4` (частка на test, за замовчуванням), `--runs-per-query 3`
(стабільність), `--trigger-threshold 0.5`. Набір eval-запитів (8-10 should-trigger + 8-10
should-not-trigger, реалістичні, з деталями/шляхами) готується заздалегідь і затверджується
через HTML-форму (`assets/eval_review.html`), не наосліп.

**Очікуваний результат:** `best_description` — новий текст `description`, обраний за
результатом на **test**-спліті (щоб уникнути оверфіту на train), плюс HTML-звіт з
прогресом по ітераціях. Застосовується вручну в `SKILL.md`.

**Приклад — промпт у термінал `claude`:**
```
скіл backend-onion-architecture іноді плутається з frontend-architecture (обидва
про "architecture") — оптимізуй йому trigger description через skill-creator,
підготуй 8-10 should-trigger і 8-10 should-not-trigger запитів, включно з
near-miss кейсами на frontend-architecture
```
Claude сам збудує eval-set, дасть його вам на затвердження через HTML-форму, і
запустить під капотом:
```sh
python <skill-creator>/scripts/run_loop.py \
  --eval-set trigger-eval-backend-onion.json \
  --skill-path .claude/skills/backend-onion-architecture \
  --model claude-opus-4-8 --max-iterations 5 --verbose
```
Очікувано: `best_description`, який чіткіше відділяє "де в backend лежить логіка"
від фронтенд-питань.

## Сценарій 5 — сліпе порівняння двох версій скіла (A/B)

**Коли:** є дві версії скіла (стара vs нова після великого рефакторингу) і хочеться
незалежної оцінки "яка справді краща", а не власного упередженого висновку.

**Як:** прочитати `agents/comparator.md` + `agents/analyzer.md` у skill-creator, дати
результати обох версій незалежному агенту без підказки, яка версія яка. Потребує
субагентів; для дрібних правок (як у нас з `engineering-insights`) зазвичай досить
звичайного людського рев'ю у viewer — цей крок опціональний і важчий.

**Очікуваний результат:** вердикт "версія A/B краща" + пояснення чому (не просто
оцінка, а причина виграшу/програшу).

**Приклад — промпт у термінал `claude`:**
```
у мене є стара і нова версія engineering-insights (стара губила номер рядка в
anchor і дублювала dedup-записи, нова — ні) — зроби сліпе A/B порівняння через
skill-creator, дай обидва виводи незалежному агенту без підказки, яка версія яка,
і скажи, яка краща і чому
```
Технічно Claude прочитає `agents/comparator.md` + `agents/analyzer.md` зі
skill-creator і сам спавнить незалежного агента-суддю з обома виводами.
Очікувано: вердикт "версія B краща" з поясненням (збереження `schema.ts:140`
замість голого `schema.ts`, окремий датований під-булет замість inline-дужок) —
причина виграшу, а не просто оцінка.

## Сценарій 6 — пакування скіла для експорту

**Промпт у термінал `claude`:**
```
запакуй скіл engineering-insights у .skill файл для експорту в інший проєкт
```
Під капотом:
```sh
python <skill-creator>/scripts/package_skill.py .claude/skills/engineering-insights
```
**Очікуваний результат:** файл `engineering-insights.skill`. Важливо — `evals/`
виключається з пакування автоматично (на рівні кореня скіла), тобто весь наш
harness (`fixtures/`, `grade.py`, `iteration-1/`) у файл не потрапить —
заекспортується лише `SKILL.md` + `criteria.md` + `format.md` + `templates/`.

## Сценарій 7 — швидка валідація структури скіла

**Параметри:** `python <skill-creator>/scripts/quick_validate.py .claude/skills/<name>`

**Очікуваний результат:** миттєва перевірка формату (frontmatter, довжина SKILL.md,
наявність referenced-файлів) без запуску жодного агента — найдешевший сценарій, вартий
запуску одразу після ручного редагування `SKILL.md`.

**Приклад — промпт у термінал `claude`:**
```
я щойно відредагував .claude/skills/engineering-insights/SKILL.md вручну —
швидко провалідуй структуру скіла через skill-creator, без запуску агентів
```
Під капотом: `python <skill-creator>/scripts/quick_validate.py .claude/skills/engineering-insights`.
Очікувано: `True, "Skill is valid"` (або конкретна помилка на кшталт "SKILL.md not
found" чи "multiple SKILL.md files found", якби, наприклад, `templates/insights.md`
випадково назвали `SKILL.md`).

## Довідка: усі скрипти плагіна

| Скрипт | Обов'язкові параметри | Що видає |
| --- | --- | --- |
| `scripts/aggregate_benchmark.py` | `benchmark_dir`, `--skill-name` | `benchmark.json` + `.md` (mean±stddev, delta) |
| `eval-viewer/generate_review.py` | `workspace`, `--static <file>` (десктоп без display) | автономний HTML-viewer із вкладками Outputs/Benchmark |
| `scripts/run_loop.py` | `--eval-set`, `--skill-path`, `--model` | оптимізований `description` + HTML-звіт по ітераціях |
| `scripts/run_eval.py` | `--eval-set`, `--skill-path` | одноразовий прогін trigger-eval (без циклу покращень) |
| `scripts/improve_description.py` | `--eval-results`, `--skill-path`, `--model` | один запропонований варіант `description` |
| `scripts/package_skill.py` | `<skill-folder>` | `<name>.skill` файл |
| `scripts/quick_validate.py` | `<skill-folder>` | pass/fail по структурі, без агентів |

## Практичні нотатки для цієї машини (Windows, десктоп-харнес)

- Немає браузера/сервера для перегляду → завжди `--static <file>.html` у
  `generate_review.py`, ніколи без прапорця (інакше спроба підняти сервер).
- `grading.json` потрібен у **двох місцях** одночасно: `eval-X/<config>/run-1/grading.json`
  (читає `aggregate_benchmark.py`) і `eval-X/<config>/grading.json` (читає viewer) — якщо
  пишете власний грейдер під конкретний скіл, кладіть в обидва.
- Субагенти на цій машині мають `cwd` усередині репо → бачать `.claude/skills/*`
  за замовчуванням; для чесного "без скіла" baseline ізолюйте фікстури поза деревом
  проєкту (тимчасова тека, не `.claude/skills/...`).
- Кеш дозволів `.claude/settings.local.json` — локальний, не в git; ручні правки під час
  живої сесії Claude Code часто відкочуються, бо харнес періодично перезаписує весь список
  зі своєї пам'яті сесії. Це нешкідливо (застарілі exact-match рядки просто ніколи більше
  не спрацюють) — не варто боротися з цим у той самий сеанс.
