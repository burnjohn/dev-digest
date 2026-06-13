# План: зрізання `apps` до стартер-template (DevDigest)

> **Джерело істини:** Notion «🏠 DevDigest — Домашні завдання (план уроків)»
> (`https://app.notion.com/p/37614dad625681b6805ae6942136f235`), звірено 2026-06-12.
> Локальні `../16-homework-assignments.md` і `../lessons/L0*-script-*` — **застарілі чернетки**, не використовувати як джерело.

## ⚠️ Головна поправка (чому переписано)

Перша версія плану спиралася на чернетку й помилково вважала, що стартер має «тупий» рев'ю без severity/grounding і без repo-intel. **Notion це спростовує.** Стартер (template, який студент отримує через «Use this template») **з першого дня** має **повноцінний рев'ювер**:

- **structured findings + severity + score** (L01 ДЗ лише додає *фільтр* за severity — отже severity вже є);
- **grounding gate** працює мовчки (L06 його лише *розкриває*);
- **repo-intel** індексує репо на clone, є бейдж **Indexed**, repo-map потрапляє в промпт рев'ю (видно в логах з L01);
- **створення агентів** у продукті (pre-work «створити агента», L01 лаб «створюємо першого агента» — жоден урок не будує цей CRUD);
- **model-router** у коді, але **не під'єднаний** (вмикається на L08) — лишаємо сплячим;
- движок підтримує **map-reduce** (L08 його обговорює як наявний дорогий дефолт).

**Висновок:** `reviewer-core` і `repo-intel` лишаються майже без змін. Зрізаємо **фічі, які будуються на уроках** — на рівні серверних модулів і сторінок клієнта — та видаляємо пакети `mcp/`, `agent-runner/`.

---

## 1. Що РЕАЛЬНО є в стартері (day-1 template) — ЛИШАЄМО

| Можливість | Де живе |
|---|---|
| Локальний запуск `pnpm dev` (web + API + Postgres у Docker) | `scripts/dev.sh`, `docker-compose.yml` |
| Settings: OpenRouter key + GitHub PAT | `server/modules/settings`, `client .../settings/api-keys` |
| Додати репо (git clone) | `server/modules/repos`, `client/onboarding` |
| **repo-intel: індексація на clone + бейдж Indexed** (astgrep + depgraph + PageRank + repo-map + інкрементально) | `server/modules/repo-intel`, адаптери `astgrep`/`codeindex`/`depgraph`, `db/schema/repo-intel.ts`, client index-badge |
| Імпорт PR (список + diff, коміти, текст, linked issue) | `server/modules/pulls` + `polling`, `client .../pulls` |
| Перегляд diff | `client/components/diff-viewer`, `DiffTab` (базовий) |
| **Створення/редагування агентів** (model + system prompt) | `server/modules/agents` (повний CRUD), `client/agents` |
| **Запуск рев'ю одним агентом** → structured findings (**severity + score**), **grounding gate** (мовчазний), **repo-map** у промпті | `server/modules/reviews` (спрощений call-site), `reviewer-core` (без змін) |
| Список знахідок (з severity, але **без фільтра** — фільтр це L01 ДЗ) | `client FindingsTab` (спрощений) |
| Базовий run + SSE-події прогону (без багатого Run Trace UI) | `server/modules/runs` (trace-data), `reviews/routes` SSE |
| `reviewer-core` рушій повністю (prompt+grounding+structured+map-reduce) | `reviewer-core/` (без змін) |
| `model-router` присутній, **не під'єднаний** | `server/platform/model-router.ts` (сплячий) |
| **Уся БД-схема** (всі таблиці, більшість порожні) | `server/src/db/schema/*` |

---

## 2. Що БУДУЄТЬСЯ на уроках = ВИДАЛЯЄМО зі стартера

Кожен рядок — фіча/модуль, який повертається на конкретному уроці (лаб або Core-ДЗ).

| Фіча | Урок | Тип | Видалити (сервер / клієнт / пакет) |
|---|---|---|---|
| **Run cost badge** | L01 | Лаб | client: бейдж вартості на прогоні |
| **Severity-фільтр знахідок** (лічильники + фільтр) | L01 | ДЗ | client: filter-bar у FindingsTab (саму severity лишаємо) |
| **Skills у продукті** (DB-скіли, лінк до агента, інжект у промпт, Skills page, import, community) | L02 | Лаб | server `modules/skills`; client `/skills`, hooks/skills; slot `skills` у call-site |
| **Conventions Extractor** | L02 | ДЗ | server `modules/conventions`; client `/repos/:id/conventions` |
| **Intent Layer** | L03 | Лаб | server `reviews/intent.ts` + `/pulls/:id/intent`; client intent-картка, `usePrIntent` |
| **Smart Diff** (core/wiring/boilerplate + split nudger) | L03 | ДЗ | server `reviews/smart-diff.ts` + `/pulls/:id/smart-diff`; client `SmartDiffViewer` (лишаємо базовий `DiffViewer`), `useSmartDiff` |
| **devdigest-mcp** | L04 | Лаб | пакет `mcp/` цілком |
| **Blast Radius** | L04 | ДЗ | server `modules/blast`; client `BlastRadius`/Blast tab (фасад `repoIntel.getBlastRadius` ЛИШАЄТЬСЯ) |
| **Project Context Folder** (`.devdigest/specs/` → авто-контекст) | L05 | Лаб | server `modules/context`; client `/repos/:id/context`; slot `specs` у call-site |
| **Onboarding Generator** | L05 | Лаб | server `modules/onboarding`; client `/repos/:id/onboarding` |
| **Why + Risk Brief (PrBriefCard)** + WhyTimeline | L05 | ДЗ/Stretch | server `modules/brief`; client `PrBriefCard`, `WhyTimelineDrawer`, hooks/brief |
| **Secret-Leak Gate + Phantom-API Gate** (detectors) | L06 | Лаб/ДЗ | server `modules/hooks` (фасад `repoIntel.getUnresolvedReferences` лишається) |
| **Plan Verifier / Conformance** | L06 | Лаб | server `modules/conformance`; client conformance UI |
| **Eval Pipeline** | L06 | ДЗ | server `modules/eval`; client `/eval` |
| **Export to CI** (майстер + agent-runner) | L06 | Лаб | server `modules/ci` + `modules/compose`; пакет `agent-runner/` цілком |
| **Multi-Agent Review + Trifecta** | L07 | Лаб | server `runs/{service,trifecta,conflicts}.ts` + multi-agent роути; client multi-agent UI, `TrifectaVenn` |
| **Run Trace + Live Log** (багатий UI) | L07 | Лаб | client `RunTraceDrawer`/live-log (базові run-події лишаємо) |
| **Persistent Memory** (embeddings, Learn, top-K) | L07 | ДЗ | server `modules/memory` + адаптер `embedder`; client `/memory`, hooks/memory; slot `memory` у call-site |
| **Per-Agent Stats** + **Curator** | L07 | ДЗ/Stretch | server `runs/{stats,curator}.ts`; client Stats tab |
| **Plugin Export/Import** | L08 | ДЗ | server `modules/plugins`; client Settings→Plugins |
| **Agent Performance dashboard** | L08 | ДЗ | server `modules/performance`; client `/agent-performance` |
| **Scheduled-агент / Weekly digest** | L08 | Stretch | server `modules/digest`; client digest UI |

> **repo-intel — НЕ видаляємо.** Лишається індексатор + адаптери (`astgrep`/`codeindex`/`depgraph`) + схема + фасад `repoIntel.*`. Прибираємо лише **фічі-споживачі** (Blast/Brief/Conventions/Onboarding/Phantom) — уроки L02/L04/L05/L06 під'єднають їх до вже наявного фасаду. repo-map контекст у рев'ю **лишається** (day-1).

---

## 3. Стратегія гілок

```sh
git checkout main && git pull
git branch reference/full-build            # знімок повного main (= майбутній devdigest-reference)
git push -u origin reference/full-build
git checkout -b chore/part0-starter        # тут робимо зрізання (фази §6)
```
- **`reference/full-build`** = поточний повний `main` (еталон для звірки).
- **`main`** після злиття = `devdigest-starter` (template).
- ⚠️ Force-операції над `main` (reset vs merge) — окреме рішення (§10).

---

## 4. Детальний план по пакетах

### 4.1 `reviewer-core/` — БЕЗ ЗМІН
Це day-1 рушій (prompt + grounding + structured + map-reduce + to-review). Лишаємо як є. `to-review.ts` без споживача у стартері (agent-runner з'явиться на L06) — нешкідливо лишити.

### 4.2 `server/`
**Видалити цілі модулі** (`server/src/modules/`):
```
skills/ conventions/ blast/ brief/ context/ onboarding/ eval/ compose/
conformance/ ci/ hooks/ memory/ plugins/ performance/ digest/
```
**Видалити адаптер** `adapters/embedder/` (потрібен лише для memory, L07).
**ЛИШИТИ:** `repos/ pulls/ polling/ settings/ reviews/ agents/ workspace/ runs/ repo-intel/`, адаптери `llm/ github/ git/ secrets/ auth/ tokenizer/ astgrep/ codeindex/ depgraph/ mocks`.

**Підрізати `reviews/`** — звести call-site до day-1 шляху:
- видалити `intent.ts` (L03), `smart-diff.ts` (L03);
- `run-executor.ts`: лишити `assemblePrompt(system + diff + prDescription + **repoMap**)` → `reviewPullRequest` (strategy `auto`) → grounding (вбудований) → персист findings з severity/score. **Прибрати** інжект skills/memory/specs/intent/callers і smart-diff;
- `findings.ts`: лишити базовий стан знахідки; прибрати `actOnFinding` learn/eval-case-хуки (L06/L07);
- роути: лишити `POST /pulls/:id/review` (один агент), `GET /pulls/:id/reviews`, `GET /runs/:id/events` (SSE), `DELETE /runs/:id`; прибрати `/intent`, `/smart-diff`.

**Підрізати `runs/`** — лишити trace-дані (`trace-builder.ts`, `run_traces`, `agent_runs`); **видалити** `service.ts` (multi-agent fan-out), `trifecta.ts`, `conflicts.ts`, `stats.ts`, `curator.ts` + роути `multi-agent-run`, `agents/:id/stats`, `memory/curate`.

**`agents/`** — лишити **повний CRUD** (create/update/list/get + версії). Звести built-in seed до 2 пресетів (General + Security), але редактор лишити робочим.

**`platform/`** — `model-router.ts` лишити (сплячий). Якщо `grounding.ts`/`structured.ts`/`prompt.ts` — це re-exports з reviewer-core, лишити (рушій не змінюється).

**`modules/index.ts`** — прибрати реєстрацію видалених модулів.

**БД-схема** — **НЕ ЧІПАЄМО** (усі таблиці лишаються, pgvector з дня 1). `db/seed.ts` звести до Частини 0: demo-repo + кілька PR + 2 агенти; прибрати seed скілів/conventions/memory/eval.

**Тести** — видалити по видалених фічах (`skills* conventions* blast* brief* context* onboarding* eval* compose* conformance* ci* hooks* phantom* memory* multi-agent* trifecta* stats* plugins* performance* digest* intent* smart-diff*`). **Лишити:** `reviews*`, `routes-smoke`, `contracts`, `runs`(trace), `adapters`, `integration`, `settings-models`, **усі `repo-intel*`/`indexer*`/`astgrep*`** (repo-intel лишається).

**`package.json`** — лишити deps repo-intel (`@ast-grep/napi`, `dependency-cruiser`, `graphology*`) і pgvector-тип. Прибрати лише те, що тягнули видалені модулі (за фактом після `tsc`).

### 4.3 `client/`
**Видалити роути** (`client/src/app/`):
```
skills/ eval/ memory/ agent-performance/ ci-runs/ showcase/
repos/[repoId]/context/ repos/[repoId]/conventions/
repos/[repoId]/multi-agent/ repos/[repoId]/onboarding/
repos/[repoId]/pulls/[number]/conformance/
agents/[id]/evals/        (підмаршрут evals — L06; редактор агента лишаємо)
```
**ЛИШИТИ роути:** `/`, `/onboarding`, `/settings/[section]` (api-keys; за потреби models), `/repos/[repoId]/pulls`, `/repos/[repoId]/pulls/[number]`, **`/agents` + `/agents/[id]`** (редактор агента — day-1).

**Видалити компоненти детальної PR:** `VerdictBanner`(severity-банер — це не базовий список; перевірити), `TrifectaVenn`, `PrBriefCard`, `BlastRadius`, `ConformanceTab`, `RunTraceDrawer`, `WhyTimelineDrawer`.
**Спростити:** `DiffTab`/`SmartDiffViewer` → базовий `DiffViewer`; `FindingsTab`/`FindingCard` → список з severity, **без** filter-bar (L01), без cost-badge (L01), без Blast/Brief; `RunStatus`/`ReviewRunAccordion` → базовий статус, без multi-agent доріжок.
**Лишити:** `PrDetailHeader` (таби + Review), `RunReviewDropdown`, `RunHistory`, агент-редактор, Indexed-бейдж.

**Хуки (`client/src/lib/hooks/`)** — видалити: `skills eval memory multiagent conformance ci plugins performance stats onboarding digest brief context conventions trace`. У `reviews.ts` прибрати `usePrIntent`, `useSmartDiff`. **Лишити:** `hooks.ts`, `hooks/reviews.ts`, `hooks/agents.ts` (CRUD), `hooks/repo-intel.ts` (Indexed-бейдж).

**Навігація (`vendor/ui/nav.ts`):** лишити **Pull Requests, Agents, Settings**. Прибрати Skills/Eval/Memory/Multi-Agent/Agent-Performance/CI/Conventions/Context/Onboarding.

**Settings:** лишити api-keys (+ за потреби models для вибору моделі агента). Прибрати auto-reviews/integrations/plugins/about.

### 4.4 `mcp/` — видалити повністю (L04 лаб).
### 4.5 `agent-runner/` — видалити повністю (L06 лаб). Прибрати `.devdigest/agents/*.yaml`.
### 4.6 `e2e/` — підрізати під стартер: лишити флоу boot / repo-pulls-detail / **agents** / basic-review; прибрати skills/dashboards/multi-agent флоу.
### 4.7 CI (`.github/workflows/`): видалити `mcp.yml`, `agent-runner.yml`, `devdigest-review.yml`. Лишити `client/server-unit/server-integration/reviewer-core`. Підрізати `e2e-web.yml`.
### 4.8 docs/specs/root: видалити `docs/github-actions-pipeline.md`; repo-intel-доки **лишити** (інфра жива). `.devdigest/specs` очистити (L05). `docker-compose.yml`/`scripts/dev.sh`/`.gitignore` лишити.

---

## 5. ❗ Перемалювати всі схеми роботи рев'ювера (вимога замовника)

Після зрізання діаграми в репо описують видалені пакети (mcp/agent-runner/CI/multi-agent) — їх треба **перемалювати під стартер**:

1. **`README.md` (root) — головна архітектурна mermaid-схема.** Прибрати MCP / agent-runner / CI / ingest. Лишити: `client (Next.js)` ↔ `server (Fastify)` ↔ `Postgres(pgvector)`; `server → reviewer-core → LLM(OpenRouter)`; **гілка repo-intel:** `clone → repo-intel index → repo-map`; `repo-map → промпт рев'ю`.
2. **Схема пайплайну рев'ю** (нова/оновлена, у `reviewer-core/README.md` і/або `docs/`): `diff (+ repo-map контекст) → assemblePrompt → LLM → structured findings (severity, score) → grounding gate (відсіює негрунтовані) → персист → UI список`. Явно показати, що **grounding і severity — day-1**, а slots skills/intent/memory/specs **додаються пізніше** (помітити «(L02)», «(L03)»… як точки розширення).
3. **Схема repo-intel** (`server/modules/repo-intel` README або `docs/`): `walk → astgrep(symbols/refs) → depgraph(edges) → PageRank(file rank) → repo-map cache`; фасад `repoIntel.*` (getRepoMap / getBlastRadius / getConventionSamples / getUnresolvedReferences) з підписами «споживач з'явиться на L0X».
4. **`client/README.md` — мапа роутів.** Лишити Pulls / PR-detail / Agents / Settings; прибрати видалені сторінки.
5. **`server/README.md` — мапа API.** Лишити роути day-1; прибрати ендпоінти видалених модулів.

> Формат — mermaid (узгоджено зі стилем наявних README). Кожна схема має чесно показувати «що є з дня 1» vs «точки, куди уроки додають фічі».

## 6. ❗ Опис усього репозиторію (вимога замовника)

Окремий deliverable — **повний опис стартер-репозиторію** для студента (template йде з ним):
- **`ONBOARDING.md` / `ARCHITECTURE.md`** (оновити): призначення кожної папки (`server` `client` `reviewer-core` `repo-intel` `e2e`), потік даних від «додав репо» до «побачив знахідки», де що шукати.
- Таблиця **«фіча → де код → який урок її розширює»** (де доречно — посилання на §1/§2).
- Розділ **«що працює мовчки з дня 1»** (grounding, repo-intel, structured findings, model-router сплячий) — щоб студент не думав, що це магія.
- Звірити з `README.md` (не дублювати, а доповнити); прибрати згадки про видалені пакети.

---

## 7. Порядок виконання (фази з гейтами)

> Гейт кожної фази: `pnpm typecheck` + `pnpm test` у зачеплених пакетах + ручний `pnpm dev`.

- **Ф0 — гілки.** `reference/full-build` запушено; створено `chore/part0-starter`.
- **Ф1 — видалити пакети.** `mcp/`, `agent-runner/`, відповідні воркфлоу, `.devdigest/agents`.
- **Ф2 — server: видалити 15 модулів-фіч + адаптер `embedder`.** Прибрати з `modules/index.ts`. Гейт: server збирається.
- **Ф3 — server: підрізати `reviews`/`runs`, звести `seed` до 2 агентів.** Гейт: `POST /pulls/:id/review` (один агент) дає findings з severity; grounding працює; repo-map у промпті.
- **Ф4 — client: видалити сторінки/хуки, спростити nav/Findings/Diff.** Лишити Agents-редактор. Гейт: `pnpm build`, ручний прохід.
- **Ф5 — e2e + CI + docs.** Підрізати флоу/воркфлоу; почистити docs/.devdigest.
- **Ф6 — СХЕМИ + ОПИС РЕПО** (§5, §6). Перемалювати всі діаграми; написати опис репозиторію.
- **Ф7 — фінальна верифікація.** `docker compose down -v` → `./scripts/dev.sh` → ручний прохід усіх day-1 можливостей від нуля; CI зелений.
- **Ф8 — злиття** `chore/part0-starter` → `main`.

---

## 8. Definition of Done

- [ ] `reference/full-build` = поточному повному `main`.
- [ ] З нуля: `./scripts/dev.sh` піднімає все; додав репо → **бейдж Indexed** → імпорт PR → diff → **створив агента** → запустив → бачу findings **з severity** (grounding мовчки відсіює негрунтовані).
- [ ] repo-map контекст видно в логах прогону.
- [ ] У навігації лише Pull Requests / Agents / Settings.
- [ ] Немає коду/UI для: skills, conventions, intent, smart-diff, blast, brief, context, onboarding, eval, conformance, ci-export, secret/phantom gates, multi-agent, trifecta, run-trace-UI, memory, stats, curator, plugins, performance, digest, cost-badge, severity-filter.
- [ ] `mcp/`, `agent-runner/` відсутні; CI без `mcp/agent-runner/devdigest-review`.
- [ ] **repo-intel живий** (індексація на clone, фасад `repoIntel.*`).
- [ ] Усі таблиці БД на місці.
- [ ] **Усі схеми рев'ювера перемальовані** (§5); **опис репозиторію готовий** (§6).
- [ ] Кожен урок L01–L08 має що будувати (фіча відсутня у стартері).

---

## 9. Ризики

1. **Нативні deps repo-intel** (`@ast-grep/napi`) у стартері → можливі труднощі `pnpm install`/першої індексації на чужій машині. Це **за дизайном** (Indexed з дня 1); мітигація — чіткий розділ у docs + обмеження «JS/TS, не гігантські monorepo».
2. **Каскадні імпорти** видалених модулів у `modules/index.ts`/`reviews`/`runs` — видаляти зверху вниз, `tsc` після кожного.
3. **`embedder` vs схема memory.** Прибираємо runtime embedder, але таблиця `memory` і pgvector лишаються порожні — insert не робиться, тип `vector` зберігаємо.
4. **agents CRUD лишається** — переконатися, що видалення skills не ламає лінк-логіку агента (agent_skills лишити в схемі, прибрати лише UI/інжект).
5. **Netflix-сліди / `.claude` harness.** Перед комітом перевірити lock-файли на `pypi.netflix.net` і skip-worktree (пам'ять `netflix-deps-skip-worktree`). Наразі skip-worktree файлів немає.
6. **e2e seed-залежність** — синхронізувати `seed.ts` (Ф3) з флоу (Ф5).

---

## 10. Відкриті питання

1. **`.claude/` harness стартера.** Що лишити? Курс будує CLAUDE.md (L01), скіли/субагентів/хуки (L02/L03/L06) — отже стартер має йти **без** них. Але L02 згадує готовий скіл `/spec` як наявний → лишити `/spec` як приклад. **Рекомендація:** мінімальний/порожній `CLAUDE.md` (або без нього) + лишити `/spec`, прибрати engineering-insights/security-reviewer/решту.
2. **`main`: merge чи hard-reset?** Для template чистіше **reset** (буквально чистий стартер), але це переписування історії — потрібен явний дозвіл.
3. **Назва reference-гілки** — `reference/full-build` ОК?
4. **Settings → Models.** Лишати секцію вибору моделі в Settings, чи вибір моделі тільки в редакторі агента?
