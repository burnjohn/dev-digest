# INSIGHTS — client (`@devdigest/web`)

Знахідки по клієнту (Next.js/React). Append-only — див.
[`.claude/skills/engineering-insights`](../.claude/skills/engineering-insights/SKILL.md).

---

## 2026-07-28 · gotcha
**`toPrecision(N)` округлює "рівні" десяткові дроби не так, як очікує людина**
`0.0135` у binary float — насправді `0.013499999999999999847`, тож
`(0.0135).toPrecision(2)` дає `"0.013"`, а не інтуїтивно очікуване `"0.014"`.
Для округлення USD-сум/подібних "чистих" чисел до N значущих цифр надійніше
множити на степінь десяти, застосувати `Math.round`, і ділити назад — це працює
з тим, як насправді округлює `*`/`Math.round`, а не з десятковим представленням.
Доказ: client/src/components/run-cost-badge/helpers.ts:13-19

## 2026-07-28 · gotcha
**`screen.getByText(...)` нормалізує пробіли лише в DOM-тексті, НЕ в самому рядку-матчері**
`@testing-library/dom`'s `matches()` викликає `normalizer()` тільки для
`node.textContent`, після чого порівнює його з матчером через строгу рівність
без будь-якої нормалізації матчера. Якщо компонент рендерить вузький нерозривний
пробіл U+202F (напр. як розділювач тисяч), а очікуваний рядок у тесті набраний
зі звичайним пробілом — після нормалізації DOM-тексту (яка звертає U+202F у
звичайний пробіл) вони все одно НЕ співпадуть, бо матчер лишається ненормалізованим.
Фікс: застосувати те саме `.replace(/\s+/g, " ")` до очікуваного рядка перед
`getByText`.
Доказ: client/src/components/run-cost-badge/RunCostBadge.test.tsx (тест
"detailed/total shows...") та @testing-library/dom/dist/matches.js:31-40
(`matches()` нормалізує лише `textToMatch`, не `matcher`)

## 2026-07-31 · gotcha
**`Chip`'s `color` prop робить видиму зміну лише разом з `icon`**
`Chip` (client/src/vendor/ui/primitives/Chip.tsx:40) застосовує `color` тільки
до іконки (`I && <I style={{color}}>`), не до тексту/фону. Передати `color` без
`icon` — код компілюється, але колір ніде не проявляється. Якщо потрібен
кольоровий чіп (напр. по критичності), обов'язково передавай і `icon`.
Доказ: client/src/vendor/ui/primitives/Chip.tsx:40-41

## 2026-07-31 · decision
**Для severity-кольору/іконки використовуй `SEV` з `primitives/tokens.ts`, а не `SEV_COLOR` з `FindingCard/constants.ts`**
`FindingCard/constants.ts:4-9` дублює лише кольори severity локально для картки;
канонічне джерело — `SEV` у `client/src/vendor/ui/primitives/tokens.ts:6-14`,
яке експортується з `@devdigest/ui` і містить і колір (`c`), і іконку (`icon`)
на рівень (WCAG-нота в Badge.tsx: "never color alone"). Нові UI-елементи, що
показують severity (чіпи, бейджі), мають брати дані звідти, а не заводити
власну мапу кольорів.
Доказ: client/src/vendor/ui/primitives/tokens.ts:6-14

## 2026-07-31 · gotcha
**`Severity` з `@devdigest/ui` ширший (4 значення) за `Severity` з wire-контракту (3 значення) — типізація `Severity[]` ламає індексацію у вузькі об'єкти**
`client/src/vendor/ui/primitives/tokens.ts:3` визначає
`"CRITICAL" | "WARNING" | "SUGGESTION" | "INFO"`, тоді як
`client/src/vendor/shared/contracts/findings.ts:11`
(`z.enum(['CRITICAL','WARNING','SUGGESTION'])`) — лише 3 значення. Якщо спільну
константу порядку відображення типізувати як `Severity[]` з `@devdigest/ui`
(широкий тип), а потім індексувати нею об'єкт, похідний від контракту (напр.
`FindingsSummary.counts`, який має рівно 3 явні ключі без index signature) —
TypeScript падає з TS7053 ("Property 'INFO' does not exist"), навіть якщо
рантайм-значення завжди коректні. Фікс: типізувати такі константи як
літеральний tuple (`as const satisfies readonly Severity[]`), а не як широкий
`Severity[]` — це звужує тип до фактичних 3 літералів і лишається
індекс-безпечним для вузьких контрактних форм.
Доказ: client/src/components/findings-tooltip/FindingsTooltip.tsx (константа
`SEVERITY_DISPLAY_ORDER`) та client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx
(`pr.findings_summary?.counts[sev]`)

## 2026-07-31 · gotcha
**У тестах з кількома однаковими fixture-об'єктами додавання нового дефолтного поля може створити дублікат тексту, який ламає `getByText`**
`FindingsTooltip.test.tsx`'s multi-finding hover-тест рендерить два `finding()`
з різними override для `title`/`file`/`start_line`/`end_line`, але без
override для нового поля `rationale` — обидва тоді успадковують однаковий
дефолт і рендерять ідентичний текст. Будь-яка нова асерція `getByText(...)` на
це поле падає з "multiple elements found", поки для кожного елемента
fixture-виклику не задати унікальне значення (або не перейти на
`getAllByText`).
Доказ: client/src/components/findings-tooltip/FindingsTooltip.test.tsx
(тест "shows each finding's title and file:line on hover..." — другий
`finding({ id: "f2", ... })` виклик тепер явно передає власний `rationale`)

## 2026-08-02 · gotcha
**План/бриф з готовим кодом рахує глибину `../` відносних імпортів для нової
папки на око — і помиляється на один рівень**
Для `EvalsTab/EvalsTab.tsx` (сьомий рівень вкладеності від `src`, як і
`SkillsTab/SkillsTab.tsx`) бриф пропонував `"../../../../../../lib/hooks/evals"`
(6 рівнів) — правильно 7, що видно порівнянням з реальним
`SkillsTab.tsx`. Для вкладеної `EvalsTab/_components/EvalCaseModal/
EvalCaseModal.tsx` (9 рівнів) бриф давав 8. TypeScript це не ловить
(модуль просто не резолвиться до `noUnusedLocals`-подібної перевірки — тут
взагалі падає з чіткою помилкою резолву), але `vi.mock(...)` з неправильним
шляхом тихо НЕ мокає хук (модуль з іншим resolved-шляхом не збігається), і
тест падає пізніше на мережевому виклику, а не на помилці мокання. Рахуй
глибину `node -e "path.relative(...)"` або порівнянням з існуючим файлом
на тому самому рівні вкладеності, а не копіюванням з брифу.
Доказ: client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx:6
(7 рівнів `../`, було виправлено з 6 як у брифі задачі Task 5 Evals Tab)

## 2026-08-02 · gotcha
**Готовий код тесту з брифу (Task 4, Stats Tab) сам містить дублікат тексту, що ламає `getByText`**
`task-4-brief.md`'s `StatsTab.test.tsx` задає одночасно `avg_cost_usd: 0.04`
(рендериться в MetricCard як "$0.04") і `run_history[0].cost_usd: 0.04`
(та сама таблична клітинка рендерить теж "$0.04") — `getByText("$0.04")`
падає з "Found multiple elements", хоча тест у брифі позначений як "Expected:
PASS". Не лише написаний вручну fixture-код (див. запис від 2026-07-31 про
`FindingsTooltip`) — готовий код у бриф-документі теж треба прогнати, а не
скопіювати наосліп. Фікс: зробити `cost_usd` у `run_history` іншим числом,
ніж `avg_cost_usd` (тут — 0.05).
Доказ: client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/StatsTab.test.tsx
(`run_history[0].cost_usd: 0.05`, коментар пояснює причину)

## 2026-08-02 · gotcha
**Глибина `../` імпорту з `_components/StatsTab` різна для `lib/hooks/*` (7 рівнів) і для сусіднього `app/repos/...` (6 рівнів) — та сама папка, різна кількість `../`**
Продовжує запис від 2026-08-02 про EvalsTab: рахувати "на око" по аналогії з
уже наявним імпортом того ж файлу небезпечно, якщо цілі лежать у різних
піддеревах. `StatsTab.tsx`'s `useAgentStats` імпорт іде
`"../../../../../../../lib/hooks/agents"` (7 `../`, бо ціль — `src/lib/...`),
але імпорт `RunTraceDrawer` з `src/app/repos/[repoId]/pulls/[number]/
_components/RunTraceDrawer` — лише 6 `../`, бо ціль сама лежить під `app/`
(на 1 рівень мілкіше за `lib/`, з яким порівнювали). Копіювання кількості
`../` з сусіднього імпорту в тому ж файлі — не надійний евристик; рахуй
`node -e "console.log(path.relative(fromDir, toDir))"` окремо для кожної
цілі.
Доказ: client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/StatsTab.tsx:6-7
(`../../../../../../../lib/hooks/agents` проти `../../../../../../repos/[repoId]/pulls/[number]/_components/RunTraceDrawer`)

## 2026-08-04 · gotcha
**`diff-viewer` не мав ЖОДНОГО механізму scroll-to-line/highlight до Smart Diff — не було що "перевикористати", довелось додавати з нуля в `FileCard`/`CodeLine`**
Плани, що посилаються на "reuse the existing scroll/highlight primitives" у
`@/components/diff-viewer`, мали на увазі майбутню фічу, не факт: до Smart
Diff `CodeLine`/`FileCard` не мали жодного `ref`/`scrollIntoView`/`highlight`
пропу — `grep -n "scrollIntoView" client/src/components/diff-viewer` не
знаходив нічого. Довелось додати мінімальний `highlight?: boolean` пропс у
`CodeLine` (з `useRef` + `useEffect(() => ref.current?.scrollIntoView(...))`)
і `scrollToLine?: number | null` у `FileCard` (форсує `open=true` і рахує
`highlight` для рядка з відповідним `ln.newNo`), а не переписувати diff-рендер
з нуля. Також `FileCard` не експортувався з публічного `diff-viewer/index.ts`
(лише `DiffViewer` + `DiffCommentApi`) — довелось розширити експорт, коли
з'явився другий викликач (`SmartDiffViewer`, що рендерить `FileCard` напряму
для групування по ролях, а не через `DiffViewer`).
Доказ: client/src/components/diff-viewer/CodeLine/CodeLine.tsx:17,29-35;
client/src/components/diff-viewer/FileCard/FileCard.tsx:36,51-53;
client/src/components/diff-viewer/index.ts:2 (новий `export { FileCard }`)

## 2026-08-06 · gotcha
**jsdom у цьому проєкті не реалізує `scrollIntoView` — будь-який ref-based
scroll-effect кине `TypeError`, поки компонент не протестований end-to-end**
`CodeLine`/`ReviewRunAccordion` роками викликали `ref.current?.scrollIntoView(...)`
без жодного полiфілу, і це не спливало, бо жоден існуючий тест насправді не
доводив рендер до точки, де `highlight`/`targetRunId` стає truthy для
змонтованого елемента (напр. `SmartDiffViewer.test.tsx` клікав бейдж, але
`prFile()` мав `patch: null` → рядок з потрібним `ln.newNo` просто не
рендерився). Перший тест, що дійсно домагається кліку/фокусу на змонтованому
вузлі (нова картка `FindingCard` з `forceFocus`), одразу впав з
`cardRef.current?.scrollIntoView is not a function`. Фікс — той самий
патерн, що вже є для `ResizeObserver`: global-стаб у test setup, а не мок у
кожному тестовому файлі окремо.
Доказ: client/src/test/setup.ts (доданий стаб `Element.prototype.scrollIntoView`)

## 2026-08-06 · decision
**Прив'язка Smart Diff "N findings" бейджа до Findings tab, а не до
скролу в diff, вимагала `id` у `SmartDiffFinding` — самого `line`+`severity`
не досить**
Щоб клік по бейджу розгортав КОНКРЕТНУ картку в Findings tab (а не просто
гортав diff), потрібно було адресувати finding за його реальним id, не лише
за номером рядка (кілька findings можуть теоретично лежати на одному рядку).
Контракт `SmartDiffFinding` довелось розширити полем `id` синхронно в
server- і client-копіях — легко забути оновити одну з двох при такій зміні
(вендор-дублювання схем, не спільний пакет).
Доказ: server/src/vendor/shared/contracts/brief.ts (`SmartDiffFinding`),
client/src/vendor/shared/contracts/brief.ts (та ж схема)

## 2026-08-13 · gotcha
**Агрегатний бейдж `ContextTab.tsx` і власний бейдж `ContextDocPicker` навмисно
показують ІДЕНТИЧНИЙ текст, коли `fromSkills === 0` — `getByText` тоді падає
з "multiple elements found"**
`aggregateBadge` ("{count} attached") і `ContextDocPicker`'s `attachedBadge`
("{n} attached") — той самий рядок-формат. Коли в агента нема enabled linked
skills (або вони не додають нових документів), `total === own`, тож на сторінці
рендериться два однакових текстових вузли ("N attached") одночасно. Це не баг
верстки, а прямий наслідок AC-24/Edge-case дизайну (без skills — тільки
власний рахунок, число просто дублюється в двох бейджах). У тестах, де
`fromSkills === 0`, треба `screen.getAllByText(...)` з перевіркою довжини
(2), а не `getByText` — інакше тест ламається саме тоді, коли фіча працює
правильно.
Доказ: client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx
(тести "renders the agent's attached document", "excludes a disabled linked
skill's docs...", "renders no breakdown line...")

## 2026-08-13 · fix
**`<Markdown>` рендерив h1-h6/ul/ol/li/blockquote/hr/pre/table як звичайний
текст — не бракувало react-markdown, бракувало `components`-оверрайдів**
Tailwind preflight (`@import "tailwindcss"` глобально) зануляє дефолтний
font-size/weight/margin для ЦИХ тегів; `Markdown` мав кастомні стилі лише
для `p`/`strong`/`code`/`a`, тож будь-який заголовок/список/цитата/код-блок
у прев'ю `.md`-документа (Project Context page, SPEC-01/SPEC-02) виглядав
візуально ідентично суцільному абзацу — доки хтось не відкрив реальний
багатосекційний документ. Додано явні оверрайди для решти тегів. Пастка №1:
перша спроба рендерити заголовки через `<div>` (не справжній `<hN>`) зламала
`ProjectContextPage.test.tsx`'s `getByRole("heading", ...)` — семантичний
тег обов'язковий, не лише візуальний розмір. Пастка №2: react-markdown v9
більше НЕ передає `inline`-прапорець у `code`-рендерер (був у v7/v8) —
inline vs fenced-блок тепер розрізняється лише за `className` (fenced-код
отримує `language-xxx` від remark, inline — ніколи).
Доказ: client/src/vendor/ui/primitives/Markdown.tsx (компонент), 
client/src/vendor/ui/styles.css:1 (`@import "tailwindcss"`)

## 2026-08-13 · decision
**Замінює попередній запис від 2026-08-13 про `<Markdown>` — ручні
per-element `components`-оверрайди прибрано на користь
`@tailwindcss/typography`'s `.prose`**
Той самий симптом (h1-h6/списки/цитати/hr/pre без типографіки), той самий
корінь (Tailwind preflight), але інше рішення: замість вручну стилізованого
`components`-об'єкта на кожен HTML-тег (крихко — новий remark-gfm конструкт,
напр. task-list чи footnote, знову виглядав би як голий текст, доки хтось
не додасть ще один оверрайд), підключено `@tailwindcss/typography` через
`@plugin "@tailwindcss/typography";` (Tailwind v4, CSS-first конфіг — немає
`tailwind.config.ts` в цьому проєкті) і клас `.prose` замінив увесь
`components`-об'єкт у `Markdown.tsx`. Ключове: **не** знадобився окремий
`.prose-invert`/`dark:`-варіант — застосунок вже тримає тему виключно через
`[data-theme]``-перемикні CSS custom properties (`--text-primary` тощо), тож
`.dd-md`'s `--tw-prose-*` мапляться на ці ж токени напряму (`--tw-prose-body:
var(--text-primary)` і т.д.) — та сама мапа коректна в обох темах без
дублювання. Побічний ефект типографіки, який довелось придушити: `.prose`
за замовчуванням обгортає inline `code` в лапки-бектіки (`::before`/`::after`
з `content: "`"`) — прибрано (`content: none`) і повернуто попередній
"пігулка"-вигляд лише для inline (`:not(pre code)`), щоб не міняти вже
усталений візуальний конвеншн.
Доказ: client/src/vendor/ui/styles.css (`@plugin "@tailwindcss/typography";`
і `.dd-md` блок з `--tw-prose-*`), client/src/vendor/ui/primitives/Markdown.tsx
(спрощено до `className="dd-md prose max-w-none"`, без `components` пропу)

## 2026-08-13 · gotcha
**`<Markdown>` без `rehype-raw` НЕ видаляє сирий HTML з тексту — перетворює
його на видимий текстовий вузол, а не на реальний DOM-елемент**
`react-markdown` v9's `post()` transform (`skipHtml` за замовчуванням
`false`) конвертує mdast-вузли типу `'raw'` у `{type: 'text', value:
node.value}`, а не дропає і не парсить їх у справжні DOM-теги. Тобто
рядок body типу `"...<script>alert(1)</script>..."`, переданий у
`<Markdown>` без жодного санітайзера, рендериться як буквальний видимий
текст `<script>alert(1)</script>` (жодного реального `<script>`-елемента в
DOM, `container.querySelector('script')` — `null`), а не зникає і не
виконується. Це підтверджує, що XSS-захист для LLM-згенерованого `body`
(SPEC-03 T5, stored-XSS NFR) не потребує ручного екранування на клієнті —
дефолтна поведінка `Markdown`-компонента вже безпечна.
Доказ: client/node_modules/react-markdown/lib/index.js:354-359 (`transform`:
`node.type === 'raw'` → `parent.children[index] = {type: 'text', value:
node.value}` коли `skipHtml` falsy); тест
client/src/app/repos/[repoId]/onboarding/_components/OnboardingTourPage/OnboardingTourPage.test.tsx
("renders a literal <script> in the body as visible, inert text")

## 2026-08-13 · gotcha
**`messages/en/onboarding.json`'s `generate.title` і `generate.cta` — буквально
однаковий рядок ("Generate onboarding tour") → `getByText` ламається на
"multiple elements found" в порожньому стані**
`EmptyState` рендерить `title` окремим `<div>` і `cta` окремою кнопкою; коли
обидва пропси отримують однаковий переклад, в DOM одночасно опиняються два
елементи з ідентичним текстом. Непомітно з коду компонента — видно лише при
спробі написати `screen.getByText(...)` в тесті на порожній стан. Фікс:
`screen.getAllByText(...)` з перевіркою довжини (2) для перевірки самого
факту наявності тексту, і `screen.getByRole("button", {name: ...})` замість
`getByText`, коли потрібно саме клікнути по кнопці.
Доказ: client/messages/en/onboarding.json:18,20 (`generate.title` і
`generate.cta` — однаковий рядок); тест
client/src/app/repos/[repoId]/onboarding/_components/OnboardingTourPage/OnboardingTourPage.test.tsx
("shows the 30–60s / ~5,000 tokens copy in the empty state")

## 2026-08-13 · gotcha
**`@testing-library/user-event` не встановлений у `client/package.json` —
`react-testing-library`-скіл радить його "завжди", але тут увесь наявний
тестовий код клікає через `fireEvent`**
`client/package.json`'s `devDependencies` містить `@testing-library/react` і
`@testing-library/jest-dom`, але НЕ `@testing-library/user-event` — усі
існуючі тести з кліками (`DiffTab.test.tsx`, `FindingsPanel.test.tsx`,
`SmartDiffViewer.test.tsx`, `OnboardingTourPage.test.tsx`) використовують
`fireEvent.click(...)`, не `userEvent`. Написання нового тесту з
`import userEvent from "@testing-library/user-event"` компілюється лише
локально в IDE (типи можуть резолвитись транзитивно через інший пакет), але
провалиться в `pnpm test`/CI з "Cannot find module" — додавати пакет під час
імплементації означало б чіпати lockfile (заборонено `CLAUDE.md`). Для цього
репозиторію: продовжуй `fireEvent`, не `userEvent`, поки лишається окремим
рішенням додати залежність.
Доказ: client/package.json (немає рядка `@testing-library/user-event` у
`devDependencies`); client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.test.tsx:56
(`fireEvent.click(...)`)

## 2026-08-19 · gotcha
**`Badge` (`@devdigest/ui`) рендерить усі `children` в ОДНОМУ `<span>` — кілька
JSX-інтерполяцій усередині одного `Badge` зливаються в один текстовий вузол, і
`getByText("КОРОТКА-ЧАСТИНА")` (точний збіг) НЕ знаходить його**
Розширення `EvalCaseModal.tsx` (SPEC-05 T13, "POSITIVE CASE"/"NEGATIVE CASE"
бейдж + людський підсумок поруч) спочатку клав обидва шматки тексту в ОДИН
`<Badge>{label} · {summary.text}</Badge>` — `Badge.tsx`'s `<span>{children}</span>`
(без проміжних елементів між текстовими вузлами) робить повний `textContent`
рівним `"POSITIVE CASE · MUST find ..."`, тож `screen.getByText("POSITIVE
CASE")` (точний збіг за замовчуванням) не збігається НІ з чим — падає "Unable
to find an element". Фікс: рендерити короткий лейбл усередині `Badge`, а
довгий підсумок — окремим `<span>` поруч (поза `Badge`), не всередині нього;
тоді `getByText("POSITIVE CASE")` (точний) і `getByText(/MUST find/)`
(regex-підрядок) знаходять кожен свій елемент незалежно. Той самий клас
пастки, що вже задокументований для дублікатів тексту (записи 2026-07-31/
2026-08-13), але тут причина не дублікат, а конкатенація кількох
JSX-інтерполяцій в один текстовий вузол одного елемента.
Доказ: client/src/vendor/ui/primitives/Badge.tsx:24-48 (`<span>{children}</span>`,
без розділових елементів); client/src/components/eval-case-modal/EvalCaseModal.tsx:203-210
(підсумок винесено в окремий `<span>` поруч із `<Badge>`)

## 2026-08-19 · decision
**`EvalCaseModal` промотовано з `agents/[id]/.../EvalsTab/_components/` у
`client/src/components/eval-case-modal/` — другий викликач (`FindingsPanel`)
з іншого фіче-дерева це вимагав, за правилом react-ui-architecture "promote on
the second user"**
`FindingsPanel` (репо/pulls-фіча) отримав потребу відкривати той самий
`EvalCaseModal`, що раніше обслуговував лише `EvalsTab` (agents-фіча) —
крос-фіче imports (`../../other-feature/...`) — це і є сигнал промоції, не
привід тягнути імпорт напряму. Нову підпапку названо kebab-case
(`eval-case-modal`), за конвенцією вже наявних `client/src/components/*`
(`app-shell`, `diff-viewer`, `run-cost-badge`), а не PascalCase, як у
feature-local `_components/`. Усередині компонента імпорти хуків/утиліт
переведено на `@/lib/hooks/evals` (alias), а не порахований `../`-ланцюжок —
уникає класу пасток із записів 2026-08-02 про неправильний підрахунок
глибини відносних імпортів у цьому ж дереві.
Доказ: client/src/components/eval-case-modal/EvalCaseModal.tsx:6-7 (alias-
імпорти), client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:13
(другий викликач), .claude/skills/react-ui-architecture/SKILL.md ("promote on
the second user" / "A relative import climbs out of one feature and into
another")

## 2026-08-19 · decision
**recall/precision/citation_accuracy не мали жодної кольорової конвенції в
кодовій базі — `METRIC_COLOR` (T14) вводить її вперше**
До Eval Dashboard'а (T14) ці три метрики скрізь рендерились простим текстом
без кольору (`EvalsTab.tsx`, старий `EvalCaseModal`) — жодного "вже наявного"
кольору не було, хоча план це й припускав. Зафіксовано: recall=`var(--accent)`
(синій), precision=`var(--ok)` (зелений), citation_accuracy=`var(--warn)`
(жовтогарячий) — узгоджено з референс-макетом курсу. Якщо ці метрики
з'являться в `EvalsTab`/`EvalCaseModal` пізніше — перевикористовувати цю саму
палітру, а не вигадувати нову.
Доказ: client/src/app/eval-dashboard/_components/EvalDashboardView/styles.ts:4-9
(`METRIC_COLOR`)

## 2026-08-19 · gotcha
**`EvalsTab.tsx` тепер рендерить ДВА різних лічильники з ідентичним
next-intl форматом `"{count} cases"` (заголовок кейсів і кожен рядок
історії сет-ранів) — колізія `getByText`, коли обидва числа збігаються**
`evalsTab.casesCount` (новий, для "N cases" лічильника над списком кейсів) і
вже наявний `evalsTab.historyCasesCount` (для кожного рядка "Set-run
history") — обидва мають рядок-формат `"{count} cases"`. Коли кількість
поточних eval-кейсів агента дорівнює кількості кейсів, що реально
виконались в конкретному історичному сет-рані (типовий фікстур-дефолт: 1
кейс визначено, 1 кейс побіг), `screen.getByText("1 cases")` знаходить ДВА
елементи одночасно і падає. Це той самий клас пастки, що вже
задокументований (2026-07-31, 2026-08-13) — фікс тут: у фікстурі тесту
свідомо тримати РІЗНУ кількість поточних кейсів і кейсів у конкретному
історичному сет-рані (напр. 2 визначено, 1 виконано), а не однакове число,
замість переходу на `getAllByText`.
Доказ: client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx
(тест "a single set-run renders in history..." — коментар пояснює вибір
`cases.length = 2` проти `historyRows`-групи з 1 кейсом); client/messages/en/eval.json
(`evalsTab.casesCount`/`evalsTab.historyCasesCount` — обидва `"{count} cases"`)

## 2026-08-19 · gotcha
**`@devdigest/ui`'s `icon=` prop не має ключа `"Pencil"`, попри те що
underlying lucide-імпорт називається саме `Pencil` — валідний ключ `"Edit"`**
`icons.tsx:147` аліасить `Edit: Pencil` навмисно ("prototype used 'Edit';
lucide exports Pencil/Edit — alias to keep API"), тож `Icon`/`Button icon=`
приймає лише `"Edit"`. `icon="Pencil"` не падає одразу — валиться лише на
`tsc --noEmit` величезною union-type помилкою, що не вказує прямо на фікс.
Впіймано під час верифікації плану evals-tab-mockup-alignment: `implementer`-
агент (без Bash у своїй сесії, див. корневий INSIGHTS.md) не міг прогнати
typecheck сам і залишив `icon="Pencil"` в новій кнопці редагування рядка
кейсу.
Доказ: client/src/vendor/ui/icons.tsx:147; client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx:263 (виправлено на `icon="Edit"`)

## 2026-08-19 · gotcha
**Блок карток метрик (rядок 156+) і секція Compare (рядок 303+) в
`EvalsTab.tsx` рендерять ОДНАКОВУ дельту, коли `groups` має рівно 2 записи
— колізія `getByText`, відмінна від уже задокументованої Badge-пастки**
Обидва блоки рахують дельту з того самого `groups` (`groupRuns(historyRows)`,
`EvalsTab.tsx:83`): картки зверху завжди показують "найновіший сет-ран
проти попереднього" (`metricCards`), Compare-секція — дельту між ДВОМА
ОБРАНИМИ користувачем сет-ранами. Коли в фікстурі/сценарії всього 2
run_group'и, ці дві пари збігаються — і обидва блоки рендерять однаковий
текст (напр. "▼ Δ 50%") в РІЗНИХ, легітимно окремих елементах (не один
елемент зі склеєними текстовими вузлами, як Badge-пастка 2026-08-19 вище).
Незкоуплений `screen.getByText(/Δ 50%/)` тоді знаходить 2 елементи й падає,
хоча з компонентом усе гаразд. Фікс — інший, ніж у Badge-пастці: скоупити
запит через `within()` на контейнер конкретної секції (напр.
`within(screen.getByText("Comparing set-runs").closest("div")!)`), а не
міняти розбиття тексту по елементах.
Доказ: client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx:83,156,303
(спільне джерело `groups`, картки метрик, заголовок Compare-секції);
client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx
(тест "selecting two set-runs..." — виправлено скоупом `within(compareSection)`)

## 2026-08-19 · gotcha
**Інструмент `Glob` (не vitest/Next.js) трактує Next.js dynamic-route теку
`[agentId]`/`[id]` як bracket-character-class у власному патерні — повертає
"No files found" навіть коли тека реально існує**
`Glob({ pattern: "client/src/app/eval-dashboard/[agentId]/**" })` і аналогічний
виклик з `[id]` дали порожній результат попри те, що обидві теки існують і
успішно резолвляться Next.js/vitest (їхній глоб-скан матчить РЕАЛЬНІ шляхи
файлів, де `[`/`]` — звичайні символи; проблема лише в РУЧНОМУ написанні
глоб-патерна з літеральними дужками). Для пошуку файлів під dynamic-route
текою треба `Grep` (`output_mode: files_with_matches`) по шляху-предку або по
відомій підрядці замість `Glob` із буквальним `[...]` у патерні.
Доказ: client/src/app/eval-dashboard/[agentId]/page.tsx (тека існує, `Glob`
на `client/src/app/eval-dashboard/**` під час цієї сесії повернув 0
результатів для неї, `Grep` на `"eval-dashboard"` — знайшов миттєво)

## 2026-08-20 · gotcha
**Твердження плану "`EvalCaseModal` не потребує змін" (SPEC-06 AC-21) не
витримало інспекції — компонент брав голий `agentId: string`, а не
`ownerKind`/`ownerId`**
Development Plan `skill-editor.md` Step 5.3 стверджував, що
`EvalCaseModal` "вже приймає ownerKind/ownerId структурно сумісні пропси".
Інспекція коду ДО зміни показала протилежне: пропс називався `agentId:
string`, і компонент викликав `useCreateEvalCase(agentId)`/
`useUpdateEvalCase(agentId)`/`useRunEvalCase(agentId)` голим рядком. Після
генералізації цих трьох хуків (Step 5.1) до сигнатури `{ ownerKind:
'agent'|'skill'; ownerId: string }` виклики всередині `EvalCaseModal`
зламались би для skill-owned кейсу без знання `ownerKind`. Мінімальний
адитивний фікс: доданий optional `ownerKind?: "agent"|"skill" = "agent"`
пропс (назва `agentId` лишена без змін, тепер це просто generic ownerId) —
обидва існуючі агент-only викликачі (`FindingsPanel.tsx`,
`EvalCaseModal.test.tsx`) не потребували жодної зміни. Висновок: план, що
каже "X не потребує змін" з посиланням на AC, все одно варто перевіряти
інспекцією коду буквально, а не довіряти формулюванню.
Доказ: client/src/components/eval-case-modal/EvalCaseModal.tsx:58 (`const
owner = { ownerKind, ownerId: agentId };`, годує всі три хуки)

## 2026-08-20 · gotcha
**`EvalAgentDashboardView.tsx` — третій, недокументований у плані викликач
`useEvalCases`/`useEvalRunHistory`, не згаданий у жодному Step/"Modules
involved" `skill-editor.md`**
Плани, що генералізують сигнатуру спільного хука (тут: `useEvalCases`/
`useEvalRunHistory` з голого `agentId: string` на `{ownerKind, ownerId}`,
Development Plan `skill-editor.md` Step 5.1), перелічують лише "відомі"
викликачі (тут план називав `AgentEditor`'s Evals tab і `EvalCaseModal`) —
але per-agent Eval Dashboard drill-down (`app/eval-dashboard/[agentId]`)
викликає ті самі два хуки і жодного разу не згадується в плані. Без
project-wide grep по імені хука (не по назві фічі з плану) зміна сигнатури
ламає typecheck у файлі, який ніхто не очікував чіпати. Правило: перед
зміною сигнатури спільного хука — `Grep` на саме ім'я хука по всьому
`client/src`, а не покладатись на список викликачів із плану.
Доказ: client/src/app/eval-dashboard/[agentId]/_components/EvalAgentDashboardView/EvalAgentDashboardView.tsx:35
(`useEvalCases({ ownerKind: "agent", ownerId: agentId })`, до фіксу —
`useEvalCases(agentId)`)

## 2026-08-20 · decision
**`/skills/:id` (SPEC-06 Step 6) НЕ копіює `AgentEditorPage.tsx`/`AgentEditor.tsx`'s
файловий розподіл 1:1 — уся `?tab=`/`ErrorState`/header-логіка живе в
`SkillEditorView`, `page.tsx` — лише `useParams`-обгортка**
Для агентів `page.tsx` тримає `?tab=`-стан, `ErrorState`-гілку і хедер, а
`AgentEditor` — лише таб-бар+тіло (бо `page.tsx` ще й рендерить лівий
сайдбар сусідніх агентів, якого спека для скілів прямо НЕ вимагає). Для
скілів увесь цей стан перенесено В `SkillEditorView` саму — `page.tsx`
звівся до `const {id} = useParams(); return <SkillEditorView id={id} />;`.
Причина: без сайдбару в `page.tsx` не лишається власної відповідальності,
яку варто тримати окремо від делегованого view; побічний виграш —
`SkillEditorView` тестується напряму (`<SkillEditorView id="s1" />`) без
мокання `next/navigation`'s `useParams`, на відміну від `AgentEditorPage`
(яка взагалі не має власного `.test.tsx` — надто важка для змоку
цілком). Якщо наступна фіча копіює "AgentEditorPage-патерн" для роуту без
сайдбару-сусідів, обирай цей (тонший `page.tsx`) варіант, а не буквальну
копію agent-розподілу.
Доказ: client/src/app/skills/[id]/page.tsx (7 рядків, лише useParams+delegate);
client/src/app/skills/[id]/_components/SkillEditorView/SkillEditorView.tsx
(useSearchParams/useRouter/useSkill/ErrorState усі тут, не в page.tsx)

## 2026-08-20 · decision
**Промоція `diffPromptLines`/`PromptDiffLine` у `@/lib/text-diff` (SPEC-06
AC-29, Development Plan `skill-editor.md` Step 9) не потребувала ЖОДНОЇ
зміни в `CompareRunsModal.test.tsx`**
План прямо казав "Update `CompareRunsModal.test.tsx` accordingly" при
промоції, але інспекція показала, що тест ніколи не імпортував
`diffPromptLines`/`PromptDiffLine` напряму з `./helpers` — він лише рендерить
`<CompareRunsModal>` і перевіряє видимий текст діффу. Єдина зміна лишилась
локальною до `CompareRunsModal.tsx` (новий import з `@/lib/text-diff` замість
`./helpers`) і до самого `helpers.ts` (видалення промотованого коду). Урок:
"update the test accordingly" у плані промоції варто верифікувати grep'ом на
ім'я симовлу в тестовому файлі, а не виконувати наосліп — інколи "accordingly"
означає "нічого".
Доказ: client/src/app/eval-dashboard/[agentId]/_components/CompareRunsModal/CompareRunsModal.test.tsx
(жодного `import ... from "./helpers"` у файлі); client/src/lib/text-diff.ts
(нове місце); client/src/app/eval-dashboard/[agentId]/_components/CompareRunsModal/CompareRunsModal.tsx:10
(`import { diffPromptLines } from "@/lib/text-diff"`)

## 2026-08-20 · decision
**`VersionsTab`'s Restore-кнопка — незалежна дія на КОЖНОМУ рядку версії, НЕ
прив'язана до 2-чекбоксового вибору для diff (AC-29 vs AC-30, різні
механізми на тому самому списку)**
Формулювання плану ("a Restore button on a selected version") було
неоднозначним — могло означати "лише на версії, вибраній чекбоксом". Обрано
інше трактування: `VersionsTab.tsx` рендерить Restore-кнопку на КОЖНОМУ
рядку `skill_versions`, незалежно від чекбокс-стану, що використовується
виключно для diff-вибору (рівно 2). Це дозволяє відновити будь-яку версію
одним кліком, без попереднього вибору для порівняння — узгоджується з AC-30
("КОЛИ користувач тисне Restore на версії V", без згадки про попередній
вибір). Якщо Step 10/рев'ювер очікує іншу поведінку (Restore лише при
активному виборі), це свідома, а не випадкова розбіжність.
Доказ: client/src/app/skills/[id]/_components/SkillEditorView/_components/VersionsTab/VersionsTab.tsx:61-74
(Restore-кнопка в `versions.map(...)`, чекбокс-стан `selected` впливає лише
на `older`/`newer`/diff-блок нижче)

## 2026-08-20 · gotcha
**Підключення всіх 6 табів у `SkillEditorView`'s тіло (Step 10) ламає
`SkillEditorView.test.tsx`'s мінімальний мок `@/lib/hooks/skills` — до цього
файл мокав лише `useSkill`, бо тіло було порожньою заглушкою**
Поки `<div style={s.body} />` була заглушкою (Step 6-9), тест-файл виду
"вигляду шапки/таб-бару" мокав лише `useSkill`. Щойно дефолтний таб
("config") реально рендерить `ConfigTab`, той викликає `useUpdateSkill` з
того самого модуля `@/lib/hooks/skills` — а мок цього модуля НЕ мав такого
експорту, тож виклик падав із "useUpdateSkill is not a function" у КОЖНОМУ
з уже наявних тестів (не лише в новому), бо всі вони рендерять
`SkillEditorView` без явного `?tab=` → дефолтний "config". Довелось
розширити мок `@/lib/hooks/skills` до всіх хуків, які реально викликають
6 підключених табів (`useUpdateSkill`, `useSkillContextDocs`,
`useSetSkillContextDocs`, `useSkillStats`, `useSkillVersions`), додати мок
`@/lib/hooks/evals` (Evals-таб читає дані звідти напряму через
`useQuery`/`useMutation`, без QueryClientProvider в тесті) і замокати
`@/components/context-doc-picker` як passthrough (той самий патерн, що вже
є в `AgentEditor.test.tsx`). Той самий крок також зламав тест "shows the
skill's name and version badge in the header" — `ConfigTab` рендерить
власний `"v{version}"`-бейдж, ідентичний хедерному, тож нескоупний
`getByText("v3")` тепер знаходить 2 елементи; фікс — `within()` на
найближчому `<div>`-предку `<h1>` (сам `s.header`-контейнер), а не зміна
`ConfigTab`/хедера. Правило: будь-яке підключення "порожньої заглушки" до
реального дочірнього дерева в уже наявному тест-файлі вимагає перегляду
ВСІХ моків цього файлу на повноту, не лише додавання нових тестів для
нової поведінки.
Доказ: client/src/app/skills/[id]/_components/SkillEditorView/SkillEditorView.test.tsx
(мок `@/lib/hooks/skills` розширено з 1 до 6 експортів, доданий мок
`@/lib/hooks/evals` і `@/components/context-doc-picker`, тест "shows the
skill's name..." скоупить `within(header)`)

## 2026-08-20 · gotcha
**SPEC-06's твердження "`eval`-неймспейс уже ownerKind-агностичний" — вірне
для *ключів*, але НЕ для *копірайтингу* двох конкретних рядків**
Аудит i18n для Skill Editor (Development Plan Step 11, T16) перевірив кожен
`t("evalsTab.*")`-виклик у промотованому `EvalOwnerTab`
(`client/src/components/eval-owner-tab/EvalOwnerTab.tsx`) проти
`client/messages/en/eval.json`. Усі використані ключі існують і саме
`evalsTab`-неймспейс (не плутати з agent-only `dashboardPage`/
`agentDashboardPage`) дійсно не має НОВИХ ключів, специфічних під owner —
але два вже наявні рядки в цьому самому неймспейсі жорстко кодують слово
"agent" у копірайтингу: `evalsTab.emptyCases` ("...assert this agent's
expected findings...") і `evalsTab.noHistory` ("...run this agent's whole
eval set."). Коли `EvalOwnerTab` рендериться з `ownerKind: "skill"` (нова
Evals-вкладка `/skills/:id`), користувач бачить "this agent's" на сторінці
скіла — косметична, але фактична неточність копірайтингу. НЕ виправлено в
рамках Step 11 (T16 явно скоупив задачу лише на нові ключі під
`skills.json` + перевірку перевикористання `detail.*`-блоку, і launching-
інструкція для цього кроку explicit заборонила чіпати `eval`-неймспейс) —
задокументовано тут для наступної сесії/рев'ю, яка вирішить, чи
параметризувати ці два рядки (`{ownerLabel}`) чи лишити як
задокументований компроміс.
Доказ: client/messages/en/eval.json:88,108 (`evalsTab.emptyCases`,
`evalsTab.noHistory`); викликається з
client/src/components/eval-owner-tab/EvalOwnerTab.tsx:218,286 (той самий
`t()` без параметра власника)

## 2026-08-20 · decision
**Спростовує запис від 2026-08-20 «`/skills/:id` НЕ копіює
`AgentEditorPage.tsx`'s сайдбар — спека прямо цього не вимагає»**
Те рішення спиралось на мовчання спеки, а не на референс-мокап. Живий
UI-фідбек (скриншот референсного мокапу Skill Editor) показав той самий
список+перемикання, що вже має `AgentEditor`. Виправлено: `SkillEditorView`
тепер рендерить лівий сайдбар сусідніх скілів (пошук + «Add Skill» +
`SkillCard`-список, клік перемикає `/skills/{id}?tab={поточний tab}`),
перевикористовуючи `SkillCard`/`SkillDrawer` з `skills/_components/*` так
само, як робив колишній `SkillsListView`. Правило на майбутнє: мовчання
спеки про UI-деталь — це привід уточнити в референс-мокапі/користувача, не
привід трактувати як «не потрібно».
Доказ: client/src/app/skills/[id]/_components/SkillEditorView/SkillEditorView.tsx:96-137
(сайдбар), client/src/app/skills/[id]/_components/SkillEditorView/styles.ts:1-11
(коментар із поясненням розвороту)

## 2026-08-20 · decision
**`/skills` більше не окрема grid-сторінка — редіректить на
`/skills/{перший скіл}`, той самий патерн, що вже є на `/` (root) для
репозиторіїв**
Наступний UI-фідбек після додавання сайдбару: раз `/skills/:id` вже сам є
списком+деталями, окрема проміжна grid-сторінка `/skills` — зайвий клік.
`SkillsListView` (grid + `filterSkills`) видалена; `/skills/page.tsx`
перероблена на тонкий редіректор (`useEffect` → `router.replace` на перший
скіл), що є 1:1 копією вже наявного патерну в `src/app/page.tsx:15-19`
(редірект на перший репозиторій) — не новий винахід. `filterSkills`
демотована назад у `SkillEditorView/helpers.ts` (react-ui-architecture:
«promote on second user» — коли лишився 1 викликач, демоція правильна, не
залишати в «спільному» місці за інерцією).
Доказ: client/src/app/skills/page.tsx:26-30 (редірект-`useEffect`);
client/src/app/skills/[id]/_components/SkillEditorView/helpers.ts:1-11

## 2026-08-20 · dependency
**Той самий редірект застосований до `/agents` (той же патерн, що `/skills`) —
виявив приховану залежність сайдбару від старої grid-сторінки**
`/agents/[id]/page.tsx`'s лівий сайдбар (той, з якого `SkillEditorView`'s
сайдбар і був скопійований) мав кнопку «Add» → «Create from scratch», яка
робила `router.push("/agents")`, покладаючись на те, що `/agents` сама
відрендерить `CreateAgentModal` через свій grid. Це ніде не задокументовано —
знайшлося тільки при переробці `/agents` на тонкий редіректор: якби
`CreateAgentModal` просто видалили разом із `AgentsListView`, кнопка почала б
мовчки нікуди не вести (редірект на першого агента, і все). Правило на
майбутнє: коли якась сторінка A відкриває create/import-флоу сторінки B через
`router.push`, а не напряму рендерить модалку — це прихована залежність, яку
варто підняти на спільний рівень (тут: `CreateAgentModal` піднято з
`agents/_components/AgentsListView/_components/` у
`agents/_components/CreateAgentModal/`, і сайдбар тепер відкриває її напряму
через локальний `useState`, як і зробив `SkillEditorView` з `SkillDrawer`)
ще до видалення сторінки, яку A на це покладалась.
Доказ: client/src/app/agents/[id]/page.tsx:86 (`setCreating(true)` замість
колишнього `router.push("/agents")`); client/src/app/agents/page.tsx:1-64
(редіректор без власного create UI, окрім empty-state)

## 2026-08-20 · gotcha
**Версійність агента (`agent_versions`) вже була повністю зроблена на
бекенді — схема, репозиторій, сервіс, роути, контракт — просто без жодного
клієнтського споживача**
На відміну від «unused tables» з root `CLAUDE.md` (порожні таблиці під
майбутні уроки), тут таблиця НЕ порожня і НЕ невикористана — вона активно
пишеться при кожному конфіг-апдейті агента (`AgentsRepository.update` →
`snapshotVersion`), і `GET /agents/:id/versions` та
`GET /agents/:id/versions/:version` вже існували й працювали. Просто ніхто
ще не додав `useAgentVersions` на клієнті чи вкладку в `AgentEditor`. Перед
тим, як писати серверну частину для «додай X як у Y», спочатку перевір
`server/src/modules/<name>/routes.ts`'s doc-коментар зі списком роутів —
іноді робота вже зроблена на 80%, і бракує тільки UI.
Доказ: server/src/modules/agents/routes.ts:19-32 (doc-коментар зі списком
роутів, versions включно); server/src/modules/agents/repository.ts:148-167
(`snapshotVersion`, викликається з кожного `update`/`insert`)

## 2026-08-20 · gotcha
**Підтверджує запис від 2026-07-31 про dual-copy `vendor/shared` — `AgentVersion`/
`AgentVersionConfig` існували в серверній копії контрактів, але НЕ в
клієнтській**
Той самий клас проблеми: `server/src/vendor/shared/contracts/knowledge.ts`
мав `AgentVersionConfig`/`AgentVersion` (додані разом із серверною
версійністю), `client/src/vendor/shared/contracts/knowledge.ts` — ні.
`useAgentVersions` компілювався б без жодної помилки типів (тип просто
з'явився б як `any`/відсутній), якби я не звірив обидві копії вручну через
`diff` — типова помилка мовчить, доки хтось реально не спробує використати
відсутній тип. Перевіряй обидві копії `vendor/shared/contracts/*` при
будь-якій зміні контракту, а не лише ту, що в пакеті, який редагуєш.
Доказ: client/src/vendor/shared/contracts/knowledge.ts:249-274 (блок додано
цією сесією, портований 1:1 із серверної копії)

## 2026-08-22 · decision
**SPEC-07's edge case ("1 агент → Multi-Agent tab все одно показує один
результат") і Development Plan `multi-agent-review.md`'s T8-хелпер
("dropping rows with a null multi_agent_run_id... out of scope for this
tab") — прямо суперечать одне одному; реалізовано за планом (biding
document), не за спекою**
Спека (`docs/specs/SPEC-07-multi-agent-review.md`, розділ "Edge cases")
каже: воркспейс з <2 enabled агентами все одно дозволяє запустити 1 агента
з Configure run screen, і "'Multi-Agent Review' вкладка показує один
результат" — тобто одноagентний прогін (`multi_agent_run_id: null`, AC-15)
має бути ВИДИМИЙ на цій вкладці. Але план явно каже про T8's `groupRuns`-
хелпер: "dropping rows with a null multi_agent_run_id from the 'grouped'
result (they're single-agent runs, out of scope for this tab)" — реалізація
за цим текстом означає, що після сабміту Configure run screen з РІВНО 1
позначеним агентом (`res.run_group_id === null`,
`ConfigureRunScreen.tsx:64`), `MultiAgentReviewTab` не покаже щойно
створений run взагалі (він відсутній у жодній групі `groupRuns()`
повертає) — таб просто лишиться на попередній найновішій групі або на
порожньому стані, без жодного видимого фідбеку користувачу, що прогін
стартував. Реалізовано буквально за планом (мій обсяг — T8/T9/T10,
план — binding document), не за спекою; лишаю це тут явно для
`architecture-reviewer`/`plan-verifier`, які й вирішать, чи це прийнятний
компромісний обсяг, чи потрібен фікс (напр. показувати одноagентний run
окремо, поза `groupRuns`, коли `run_group_id === null`).
Доказ: client/src/lib/multi-agent-runs.ts:26 (`if (!row.multi_agent_run_id)
continue;`); `.claude/plans/multi-agent-review.md` Constraints, рядок
"dropping rows with a null multi_agent_run_id..."; `docs/specs/SPEC-07-
multi-agent-review.md` розділ "Edge cases", перший пункт

## 2026-08-22 · gotcha
**`GET /pulls/:id/review-groups` (T14, вже закомічено Implementer 2) не має
`schema.response` і повертає кластери з "наполовину" snake_case — вкладений
`finding` серіалізується як сирий Drizzle `FindingRow` (camelCase), а не
через `findingRowToDto`, як УСІ інші findings-шейпи на дроті**
`server/src/modules/reviews/routes.ts`'s роут для `/pulls/:id/review-groups`
реєструє лише `querystring: ReviewGroupsQuery` у `schema` — жодного
`response`, тож `fastify-type-provider-zod` нічого не серіалізує/не звужує.
`service.reviewGroupsForRunIds` повертає `clusters: FindingCluster[]`
(`server/src/modules/reviews/findings-cluster.ts:21-26`), де `file`/
`start_line`/`end_line` — snake_case (визначені так явно в інтерфейсі), але
кожен `ClusteredFinding.finding` — це сирий `FindingRow` (`typeof
t.findings.$inferSelect`, camelCase: `startLine`, `endLine`, `reviewId`,
`trifectaComponents`, ...) і `agentId`/`agentName` — теж camelCase, не
`agent_id`/`agent_name`. Це порушує "wire contracts are snake_case" (root
`CLAUDE.md`), і на відміну від dual-copy-контрактної пастки (запис
2026-07-31) тут проблема не в розсинхроні двох копій — контракту для цієї
відповіді просто НЕ існує в жодній копії `vendor/shared`. Клієнтський хук
(`useReviewGroups`, `client/src/lib/hooks/reviews.ts`) типізований під
СПРАВЖНЮ форму відповіді (camelCase у `finding`), а не під гіпотетичну
виправлену — задокументовано тут явно для `architecture-reviewer`, не
виправлено в рамках Implementer 4 (T14 — це вже закомічена робота іншої
групи, поза обсягом цього завдання).
Доказ: server/src/modules/reviews/routes.ts (роут `/pulls/:id/review-groups`,
`schema: { params: IdParams, querystring: ReviewGroupsQuery }` — без
`response`); server/src/modules/reviews/findings-cluster.ts:15-26
(`ClusteredFinding`/`FindingCluster`); server/src/db/schema/reviews.ts:28-46
(`findings` pgTable, camelCase JS-ключі: `startLine`, `endLine`, `reviewId`);
client/src/lib/hooks/reviews.ts (`ClusteredFindingRow`/`FindingClusterDto`
типізовані під фактичну camelCase-форму)

## 2026-08-22 · decision (supersedes the spec-vs-plan entry above)
**Resolved for the actual user flow the spec's Edge case describes** — a
coordinator fix added `pendingRunIds`/`pendingSingleRunGroup` to
`MultiAgentReviewTab.tsx`: when `ConfigureRunScreen`'s submission comes back
with `run_group_id: null` (exactly 1 agent checked), the tab now builds a
synthetic one-run "group" from the mutation response's own `runs[].run_id`
list and shows it immediately, instead of falling back to the previous
group or the empty state. This satisfies the spec's literal wording
("Configure run screen... дозволяє позначити 1 агента і запустити...
вкладка показує один результат") for the flow it actually describes —
right after that specific submission. It does NOT persist across a page
reload (component-local state resets), and does not retroactively surface
some OLDER, unrelated single-agent run made via the legacy
`RunReviewDropdown` — `groupRuns()` itself still correctly drops
`multi_agent_run_id: null` rows for the general case, since those two
situations are indistinguishable at the data level (no way to tell "was
submitted via the new picker with 1 agent" from "an ordinary single-agent
run from elsewhere"). Flagging that narrower remaining gap as an accepted
scope limit, not reopening this as unresolved.
Доказ: client/src/app/repos/[repoId]/pulls/[number]/_components/
MultiAgentReviewTab/MultiAgentReviewTab.tsx (pendingRunIds/
pendingSingleRunGroup); git log -- .../MultiAgentReviewTab/MultiAgentReviewTab.tsx

## 2026-08-22 · decision (supersedes the wire-contract gotcha above)
**Fixed** — `service.ts`'s `reviewGroupsForRunIds` now maps every cluster's
findings through `findingRowToDto` before returning (`FindingClusterDto`,
`agent_id`/`agent_name` snake_case), and `useReviewGroups`'s client types
(`ClusteredFinding`) were updated to match — reusing `ReviewRecord["findings"][number]`
instead of a hand-typed camelCase shape. The `schema.response`-missing
observation on that route still stands (a separate, pre-existing repo-wide
pattern per `server/INSIGHTS.md`'s 2026-08-19 decision, not something this
spec introduced) but the actual camelCase-leak this entry flagged is
resolved.
Доказ: server/src/modules/reviews/service.ts (FindingClusterDto,
findingRowToDto(f.finding)); client/src/lib/hooks/reviews.ts
(ClusteredFinding: agent_id/agent_name)

## 2026-08-22 · gotcha
**`@devdigest/ui` не має ні `Radio`/`RadioGroup`, ні `disabled`-пропа в
`Toggle`, ні будь-якого zip-примітиву — усі три знадобились для
ExportWizard (SPEC-08 Configure/Install кроків) і довелось писати вручну**
`Grep` на `radio|Radio` по всьому `client/src` — 0 збігів (перевірено цієї
сесії); `Toggle` (`client/src/vendor/ui/primitives/Toggle.tsx:3-11`) приймає
лише `{on, onChange, size}`, без `disabled`. Для AC-15 "Post results as"
(radio-вибір) і AC-18 "Open a PR vs Copy files" довелось написати локальний
`RadioRow` (`div role="radio"` + власна стилізація), колокейтнутий у
`ExportWizard/_components/RadioRow/` (не в `@devdigest/ui`, бо на момент
написання рівно 2 викликача всередині ОДНІЄЇ фічі — react-ui-architecture
"promote on the second user" ще не спрацював). Для AC-16 "Block merge on
findings" (перемикач, що має бути назавжди недоступний) `Toggle` довелось
обгорнути в `<span style={{opacity:.5, pointerEvents:"none"}}>` замість
пропа `disabled`, якого просто немає. Для zip-бібліотеки: `client/package.json`
не має `jszip`/`file-saver`/аналогів (перевірено `Grep`), а додавання нової
залежності означає ручну правку lockfile (заборонено root `CLAUDE.md`) —
`action:'files'`-шлях Install-кроку (AC-20, "Copy files as a zip") тому
завантажує кожен файл ОКРЕМО через Blob+`<a download>`, а не як єдиний
`.zip`-архів; сервер теж ніколи не пакує їх у zip (`ci/service.ts`'s
`exportCi` повертає голий `CiFile[]` для обох `action`-шляхів) — тобто AC-20
буквально "zip archive" наразі не виконано ні на сервері, ні на клієнті,
лише позначено як відомий розрив.
Доказ: client/src/vendor/ui/primitives/Toggle.tsx:3-11 (сигнатура без
`disabled`); client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/_components/ExportWizard/_components/RadioRow/RadioRow.tsx
(локальний примітив); client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/_components/ExportWizard/helpers.ts
(`downloadFile` — Blob+anchor замість справжнього zip)

## 2026-08-22 · decision (supersedes the zip half of the entry above)
**Fixed — AC-20's "zip archive" is now a real zip.** `Radio`/`disabled`-Toggle
gaps above still stand as-is (local `RadioRow`, `pointerEvents:"none"`
wrapper — both fine, not revisited). But the zip half: added `fflate`
(small, dependency-free, browser-native-compression-backed) as a direct
`client` dependency via `pnpm add` (not a hand-edited lockfile — a real
`pnpm add` run, which is the correct way to add a dependency, just requires
`Bash`) and replaced per-file `downloadFile` with `downloadFilesAsZip`
(`zipSync` + `strToU8`), producing one real `.zip` preserving every file's
full relative path. Verified round-trip (zip → unzip reproduces exact
paths/contents) via a script this session.
Доказ: client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/_components/ExportWizard/helpers.ts
(`downloadFilesAsZip`); client/package.json (`fflate` direct dependency)

## 2026-08-22 · gotcha
**Development Plan `export-to-ci.md`'s Group 5 крок стверджував, що
"Multi-Agent Review"/"Agent Performance"/"Memory" вже є сусідніми
nav-лінками в `GLOBAL`-секції — насправді жодна з трьох ще не існує ані як
NAV-запис, ані як реальна сторінка в цьому кодовому дереві**
`client/src/vendor/ui/nav.ts`'s `NAV` мав рівно дві групи (`WORKSPACE`,
`SKILLS LAB`) до цієї сесії — жодної `GLOBAL`-секції, жодного запису з
цими трьома лейблами. `Grep` на `"Agent Performance"`/`"Multi-Agent
Review"` по всьому `client/src` — 0 збігів у коді (лише в
`messages/en/shell.json:25-27`'s `nav.memory`/`nav.multi-agent`/
`nav.agent-performance` — переклади для майбутніх nav-ключів, підготовлені
заздалегідь, без жодного реального NAV-запису чи сторінки, що їх
використовує) і жодної теки `client/src/app/{memory,multi-agent,
agent-performance}` (перевірено `Glob` на `client/src/app/**` — лише
`agents`, `eval-dashboard`, `onboarding`, `repos`, root). Корінь: ці три —
скрини майбутніх уроків курсу (root `README.md`: "course lessons add the
Skills, Memory, Eval, Blast/Brief, multi-agent, ... dashboard screens"),
ще не побудовані в цьому воркдереві на момент виконання SPEC-08. Фікс —
`GLOBAL`-секція створена НАНОВО з єдиним записом (`ci-runs`), а не
дописана до вже наявних сусідів, яких просто немає. `activeKeyFor`
(`client/src/components/app-shell/helpers.ts:38-42`) і `shell.json`'s
`nav.*`-переклади для цих трьох ключів були вже готові заздалегідь — це і
ввело план в оману (виглядало так, ніби вся інфраструктура вже стоїть,
бракує тільки CI-Runs-запису).
Доказ: client/src/vendor/ui/nav.ts:21-51 (NAV до/після цієї сесії);
client/messages/en/shell.json:25-28 (`nav.memory`/`nav.multi-agent`/
`nav.agent-performance`/`nav.ci-runs` — усі 4 перекладені заздалегідь,
лише останній тепер має реальний NAV-запис+сторінку)

## 2026-08-22 · decision
**CI Runs (SPEC-08 T14) "auto-refresh" толкує "refetchInterval on the same
query" буквально — толкер лише перечитує `GET /ci/runs`, НЕ повторно
викликає `POST /ci/refresh` (ingest-цикл) на таймері**
Development Plan мав два формулювання, що частково суперечать: server-side
Group 3's Constraints казали "auto-refresh toggle polls the same
on-demand endpoint" (звучить як повторний виклик `POST /ci/refresh`), а
Group 5's власний Ordered-steps текст казав буквально "implemented as a
client-side `refetchInterval` on the same query" (реальна TanStack Query
опція, яка існує лише на `useQuery`, не на `useMutation`). Обрано друге,
буквальне трактування: `useCiRuns`'s `refetchInterval`-опція
(`client/src/lib/hooks/ci.ts:88-94`) періодично перечитує вже наявні
рядки з БД; кнопка "Refresh" — окрема дія, що реально викликає
`POST /ci/refresh` (`useRefreshCi`). Причина: якби auto-refresh дійсно
тригерив ingest на таймері з КОЖНОЇ відкритої вкладки/користувача,
`POST /ci/refresh`'s AC-34 rate-limit (10/min) вичерпався б набагато
швидше при кількох одночасно відкритих CI Runs сторінках — буквальне
трактування безпечніше і відповідає NFR "cost/rate abuse".
Доказ: client/src/lib/hooks/ci.ts:88-94 (`useCiRuns`'s `refetchInterval`
параметр), client/src/lib/hooks/ci.ts:96-112 (`useRefreshCi`'s doc-коментар
пояснює саме цей розворот), client/src/app/ci-runs/_components/CiRunsView/CiRunsView.tsx:42-45
(виклик `useCiRuns` з `refetchInterval` замість повторного `refreshCi.mutate()`)

## 2026-08-22 · decision (coordinator, accepted gaps — not fixed)
**Two minor, cross-group gaps flagged by Group 5's own report, deliberately
left as-is rather than chased through a multi-file chain**: (1) AC-28's
"PULL REQUEST (`#num`+title)" can only render `#num` — `CiRun` (Group 3's
contract) has no PR-title field, and no title is available anywhere upstream
either: `agent-runner`'s `PrContext`/`CiResultArtifact` never carry PR title
(only `pr_number`), so closing this gap properly means extending 4+ files
across two packages (`agent-runner`'s artifact + `ci_runs` schema + ingest +
this contract) for a cosmetic completeness gap, not a correctness bug — the
PR number still renders and links to the right PR. (2) `statusI18nKey` is
duplicated verbatim between `CiTab/helpers.ts` (Group 4) and
`CiRunsView/helpers.ts` (Group 5) — a promote-on-second-use candidate per
`react-ui-architecture`, left un-promoted since doing so means editing
Group 4's already-committed file for a purely stylistic DRY win. Both are
real, but low-severity and out of proportion to fix mid-implementation;
noted here for a future pass, not silently dropped.
Доказ: client/src/app/ci-runs/_components/CiRunsView/CiRunsView.tsx (PR
number-only render); client/src/app/agents/[id]/_components/AgentEditor/
_components/CiTab/helpers.ts vs client/src/app/ci-runs/_components/
CiRunsView/helpers.ts (duplicated `statusI18nKey`)

## 2026-08-25 · dependency
**Розширення `useAgentsStats` періодом (Agent Performance dashboard) змінило
її повернений тип з голого `Map<string, AgentStats>` на `{ data, isLoading,
isError, refetch }` — зламало ЄДИНОГО іншого викликача поза новою фічею**
`ConfigureRunScreen.tsx` (SPEC-07 T10, Configure run screen) уже викликав
`useAgentsStats(all.map(...))` і одразу індексував результат як `Map`
(`statsMap.get(a.id)`). Новий дашборд потребував `isLoading`/`isError`/
`refetch` з тієї самої функції (щоб не форкати другий агрегатор — план
`agent-performance-dashboard.md` прямо забороняв другий шлях агрегації), а
`Map`, попри те що це об'єкт, не має природного місця для трьох додаткових
булевих/функціональних полів без хаку (`Object.assign` на екземпляр `Map`).
Обрано змінити форму повернення й оновити єдиного існуючого викликача
(`const { data: statsMap } = useAgentsStats(...)`) — не форкати другий хук.
Перед будь-якою зміною форми повернення спільного хука: `grep -rn
"useAgentsStats"` по всьому `client/src` (не лише по фічі з плану) — тут
знайшовся рівно один зовнішній викликач, і план цю залежність не згадував.
Доказ: client/src/lib/hooks/agents.ts:203-226 (нова форма повернення);
client/src/app/repos/[repoId]/pulls/[number]/_components/ConfigureRunScreen/ConfigureRunScreen.tsx:37
(оновлений виклик)
