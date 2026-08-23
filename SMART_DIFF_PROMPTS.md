# Smart Diff — покроковий план промптів для Claude

> Кожен крок — окремий промпт. Чекай завершення кроку перед наступним.
> Якщо Claude зробив щось не так — поясни конкретно що не так і попроси виправити в тому ж чаті.

---

## Крок 1 — Класифікатор файлів (серверна константа + логіка)

```
Реалізуй детерміністичний класифікатор файлів PR для фічі Smart Diff.

Контекст:
- Проект: dev-digest, пакет server/
- Контракт SmartDiffRole вже є в server/src/vendor/shared/contracts/brief.ts: 'core' | 'wiring' | 'boilerplate'
- Класифікація тільки за шляхом файлу — без LLM, без async

Що зробити:

1. Створи файл server/src/modules/pulls/smart-diff/constants.ts з патернами:
   - BOILERPLATE_PATTERNS: масив glob/regex для lock-файлів (package-lock.json, pnpm-lock.yaml, yarn.lock, bun.lockb),
     dist/, build/, .next/, generated/, __snapshots__/, *.min.js, *.d.ts
   - WIRING_PATTERNS: для index.ts, index.tsx, routes.ts, config.ts, .env.*, docker-compose*, migrations/,
     schema.ts, *.sql, *.json (крім package.json), setup.*, module.ts
   - Все інше → core
   - Також константу: SPLIT_THRESHOLD_LINES = 500

2. Створи server/src/modules/pulls/smart-diff/classifier.ts з функцією:
   classifyFile(path: string): 'core' | 'wiring' | 'boilerplate'
   Функція перевіряє шаблони по порядку: спершу boilerplate, потім wiring, інше — core.
   Використовуй тільки рядкові методи (includes, endsWith, startsWith, match) — не glob-бібліотеки.

3. Напиши unit-тести в server/src/modules/pulls/smart-diff/classifier.test.ts (vitest):
   - package-lock.json → boilerplate
   - src/index.ts → wiring
   - src/services/payment.service.ts → core
   - dist/bundle.js → boilerplate
   - src/modules/auth/routes.ts → wiring
   - Мінімум 10 кейсів

Нічого більше не роби — тільки ці три файли.
```

---

## Крок 2 — Сервісна функція buildSmartDiff

```
Додай сервісну функцію buildSmartDiff в пакет server/.

Контекст:
- Класифікатор вже є: server/src/modules/pulls/smart-diff/classifier.ts (classifyFile)
- Контракти в server/src/vendor/shared/contracts/brief.ts:
  SmartDiff, SmartDiffGroup, SmartDiffFile, SmartDiffRole
- Тип файлу PR з pulls/routes.ts: { path, additions, deletions, patch }
- Тип finding з DB: { file: string, start_line: number, end_line: number, severity: string }
- Константа SPLIT_THRESHOLD_LINES вже є в constants.ts

Що зробити:

Створи server/src/modules/pulls/smart-diff/service.ts з функцією:

  buildSmartDiff(
    files: Array<{ path: string; additions: number; deletions: number; patch: string | null }>,
    findings: Array<{ file: string; start_line: number | null; end_line: number | null }>
  ): SmartDiff

Логіка:
1. Для кожного файлу: classifyFile(path) → роль
2. finding_lines для файлу = унікальні start_line (не null) всіх findings де finding.file === file.path
3. Групувати файли за роллю: ['core', 'wiring', 'boilerplate'] — порядок фіксований
4. split_suggestion:
   - total_lines = сума (additions + deletions) всіх файлів
   - too_big = total_lines > SPLIT_THRESHOLD_LINES
   - proposed_splits: якщо too_big — розбити core-файли на групи по ~150 рядків кожна,
     назвати "Part 1", "Part 2" тощо; якщо не too_big — порожній масив
5. pseudocode_summary: залиш null (поки не реалізуємо)
6. Повертає об'єкт, що відповідає Zod-схемі SmartDiff

Додай unit-тест в smart-diff/service.test.ts (vitest):
- 3 файли (core/wiring/boilerplate), 2 findings на core-файл → перевір групи та finding_lines
- Перевір too_big коли total_lines > 500

Нічого більше не роби.
```

---

## Крок 3 — Серверний роут GET /pulls/:id/smart-diff

```
Додай роут GET /pulls/:id/smart-diff до server/ пакету.

Контекст:
- Модуль pulls: server/src/modules/pulls/routes.ts
- buildSmartDiff вже є: server/src/modules/pulls/smart-diff/service.ts
- Модуль reviews має reviewsForPull(prId): повертає масив { review, findings }
  findings кожного review мають поля: file, start_line, end_line, severity
- GET /pulls/:id вже є в routes.ts і повертає { files: Array<{path, additions, deletions, patch}>, ... }
- ReviewRepository доступний через container в routes.ts (дивись як інші роути його отримують)
- SmartDiff Zod-схема є в vendor/shared/contracts/brief.ts

Що зробити:

1. В server/src/modules/pulls/routes.ts додай новий роут:
   GET /pulls/:id/smart-diff

2. Логіка роуту:
   a. Отримати PR з DB (вже є логіка в цьому ж файлі для GET /pulls/:id — переймай підхід)
   b. Взяти files PR (якщо PR не знайдено — 404)
   c. Взяти всі reviews для PR через ReviewRepository.reviewsForPull(prId)
   d. Взяти findings останнього review (reviews[0].findings якщо є, інакше [])
   e. Викликати buildSmartDiff(files, findings)
   f. Повернути результат з reply.send(result)

3. Schema для Fastify: використай z.toJSONSchema(SmartDiff) або inline schema (дивись як це зроблено в інших роутах файлу)

Нічого більше не роби — тільки роут.
```

---






## Крок 4 — Клієнтський хук useSmartDiff

```
Додай React Query хук для Smart Diff в клієнтській частині (пакет client/).

Контекст:
- Хуки знаходяться в client/src/lib/hooks/reviews.ts
- Axios instance імпортується звідти ж (дивись існуючі хуки — наприклад usePrReviews)
- SmartDiff тип є в client/src/vendor/shared/contracts/brief.ts (або re-export з server)
- prId — рядок (UUID)

Що зробити:

1. Перевір чи є SmartDiff тип у client/src/vendor/shared/contracts/brief.ts
   Якщо немає — додай export типу SmartDiff звідти (це дублікат з server/src/vendor/shared, так і має бути)

2. В client/src/lib/hooks/reviews.ts додай хук:

   export function useSmartDiff(prId: string) {
     return useQuery({
       queryKey: ['smart-diff', prId],
       queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`).then(r => r.data),
       staleTime: 60_000,
     })
   }

   Де api — це axios instance що вже використовується в цьому файлі.

Нічого більше не роби.
```

---

## Крок 5 — Компонент SmartDiffViewer (структура і групи)

```
Створи React компонент SmartDiffViewer в пакеті client/.

Контекст:
- Компоненти PR detail знаходяться в: client/src/app/repos/[repoId]/pulls/[number]/_components/
- Хук useSmartDiff вже є в client/src/lib/hooks/reviews.ts
- Тип SmartDiff є в client/src/vendor/shared/contracts/brief.ts
- SmartDiffGroup має: { role: 'core' | 'wiring' | 'boilerplate', files: SmartDiffFile[] }
- SmartDiffFile має: { path, additions, deletions, finding_lines: number[] }
- Існуючі компоненти використовують Tailwind CSS (дивись FindingCard або OverviewTab для стилю)

Що зробити:

Створи папку client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/
з файлами:

1. SmartDiffViewer.tsx — головний компонент:
   Props: { prId: string }
   - Викликає useSmartDiff(prId)
   - Показує loading spinner поки завантажується
   - Рендерить три секції: core, wiring, boilerplate
   - Для кожної секції: заголовок з роллю + кількість файлів, список файлів

2. FileRow.tsx — рядок одного файлу:
   Props: { file: SmartDiffFile; defaultCollapsed?: boolean }
   - Показує: шлях файлу, +additions / -deletions у зеленому/червоному
   - Якщо finding_lines.length > 0 — показує бейдж: жовтий кружечок з числом "N findings"
   - defaultCollapsed=true → файл collapsed (тільки заголовок видно, без patch)
   - Клік на заголовок — toggle collapse
   - Поки що тіло collapsed-файлу просто порожнє (patch додамо в наступному кроці)

3. index.ts — re-export SmartDiffViewer

Секції:
- core: заголовок "Business Logic" — завжди розгорнуті
- wiring: заголовок "Config & Wiring" — розгорнуті
- boilerplate: заголовок "Generated & Lock Files" — завжди collapsed (defaultCollapsed=true для кожного файлу)

Нічого більше не роби.
```

---

## Крок 6 — Додати SmartDiffViewer у PR detail page

```
Підключи SmartDiffViewer до сторінки деталі PR.

Контекст:
- Сторінка PR: client/src/app/repos/[repoId]/pulls/[number]/page.tsx або layout.tsx
- Вже є табовий лейаут: OverviewTab, FindingsTab, DiffTab (дивись що є в _components/)
- PRDetailContext.tsx надає prId через контекст
- SmartDiffViewer знаходиться в ./_components/SmartDiffViewer/

Що зробити:

1. Відкрий page.tsx (або layout.tsx — дивись де рендеряться таби)
2. Знайди де визначені таби (масив або JSX)
3. Додай новий таб "Smart Diff" поряд з існуючими
4. В тілі цього табу рендери: <SmartDiffViewer prId={prId} />
5. Імпортуй SmartDiffViewer і otримай prId з контексту або params

Якщо таби реалізовані через URL (searchParams або segment) — дотримуйся того ж патерну.
Якщо через стан — теж.

Нічого більше не роби.
```









---

## Крок 7 — Скрол до рядка по кліку на бейдж

```
Додай навігацію по кліку на бейдж findings у SmartDiffViewer.

Контекст:
- FileRow.tsx вже рендерить бейдж "N findings" коли finding_lines.length > 0
- SmartDiffFile.finding_lines — масив номерів рядків
- DiffTab вже існує і рендерить patch файлів — подивись як він ідентифікує рядки в DOM
  (пошукай data-line або id="line-N" або схожі атрибути в DiffTab компонентах)

Що зробити:

1. Спершу прочитай DiffTab компоненти і знайди як рядки diff ідентифікуються в DOM
2. Якщо є data-атрибут або id для рядків — використай його для скролу
3. В FileRow.tsx: при кліку на бейдж findings:
   a. Перемкнутись на таб "Smart Diff" якщо не там (або просто скролити в межах SmartDiffViewer)
   b. Розгорнути файл якщо він collapsed
   c. Проскролити до першого рядка зі знахідками:
      document.getElementById(`line-${finding_lines[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      (адаптуй до реального патерну ідентифікації рядків)

4. Якщо DiffTab і SmartDiffViewer — різні таби і patch не рендериться в SmartDiff —
   тоді бейдж при кліку просто перемикає на DiffTab і скролить там.
   В такому разі: передай onFindingClick callback з SmartDiffViewer вгору і обробляй на рівні page.tsx

Покажи мені що знайшов в DiffTab перед тим як писати код — я підтверджу підхід.
```

---

## Крок 8 — Фінальна перевірка і демо

```
Перевір що Smart Diff реалізований правильно згідно з критеріями.

Зроби наступне:

1. Запусти unit-тести:
   cd server && pnpm exec vitest run src/modules/pulls/smart-diff

2. Перевір що в логах серверу при GET /pulls/:id/smart-diff немає рядків
   про LLM виклик (anthropic, openai, openrouter, chat/completions)

3. Відкрий великий PR в UI (з 10+ файлами включно з lock-файлом)
   і перевір:
   - core файли зверху
   - lock-файл в групі "Generated & Lock Files" і collapsed
   - бейджі з'являються після Run Review
   - клік на бейдж веде до потрібного місця

4. Якщо є TypeScript помилки — покажи їх мені (npx tsc --noEmit в client/ і server/)

Звіт: напиши що перевірив і що знайшов.
```

---

## Підсумок архітектури

```
server/src/modules/pulls/smart-diff/
  constants.ts      ← патерни класифікації, SPLIT_THRESHOLD_LINES
  classifier.ts     ← classifyFile(path) → role
  classifier.test.ts
  service.ts        ← buildSmartDiff(files, findings) → SmartDiff
  service.test.ts

server/src/modules/pulls/routes.ts
  ← додано GET /pulls/:id/smart-diff

client/src/lib/hooks/reviews.ts
  ← додано useSmartDiff(prId)

client/src/app/repos/.../pulls/[number]/_components/SmartDiffViewer/
  SmartDiffViewer.tsx
  FileRow.tsx
  index.ts
```
