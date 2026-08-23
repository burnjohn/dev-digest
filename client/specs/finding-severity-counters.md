# Finding severity counters — специфікація і план реалізації

Лічильники findings за severity ("3 CRITICAL · 5 WARNING · 2 SUGGESTION") у
кожному review-прогоні на сторінці PR, з клікабельним ексклюзивним фільтром:
клік на рівень показує лише findings цього рівня. Client-only фіча — жодних
серверних/контрактних змін не потрібно ([client/AGENTS.md](../AGENTS.md) —
владні специ цього пакета живуть тут, а не в кореневому `specs/`, бо це не
торкається `server`).

## Контекст: що вже є

Findings у застосунку прив'язані до КОНКРЕТНОГО review-прогону, а не до PR
загалом — спільного "всі findings по PR" списку немає:

```
FindingsTab
  └─ ReviewRunAccordion (один на кожен агент/re-run)
       ├─ VerdictBanner   (verdict + totals: findingsCount, blockers, score)
       └─ FindingsPanel   (toolbar: hide-low-confidence toggle; список FindingCard)
```

- [FindingsPanel.tsx](../src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx)
  вже має один toolbar-фільтр — `hideLow` (boolean toggle) — і функцію
  `visibleFindings(findings, hideLow)` у
  [helpers.ts](../src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/helpers.ts),
  яка фільтрує + сортує за `SEVERITY_ORDER`. Це рівно той механізм, який
  severity-фільтр розширює — нової архітектури не треба.
- `Severity` (`@devdigest/shared`, `contracts/findings.ts`) — рівно 3
  значення: `'CRITICAL' | 'WARNING' | 'SUGGESTION'`. (В design-system
  токенах `SEV`/`CAT` є ще й `INFO`, але це мертвий/зарезервований запис —
  реальний тип `FindingRecord.severity` його не допускає, тож рахувати
  нема чого.)
- `SeverityBadge` (`@devdigest/ui`, `primitives/Badge.tsx`) вже РІВНО те,
  що треба візуально: `<SeverityBadge severity="CRITICAL" count={3} />`
  рендерить іконку + "CRITICAL" (uppercase через CSS) + число — саме
  формат "3 CRITICAL" з запиту. Уже показано (без click-логіки) у
  `components/showcase/Showcase.tsx:92`, живому UI ніде не використовується.
  **Нового візуального компонента не потрібно** — обгортаємо `SeverityBadge`
  в `<button>`, а не переписуємо його.
- `VerdictBanner` вже показує `findingsCount = findings.length` (сирий
  масив, БЕЗ урахування `hideLow`) — той самий принцип ("лічильники — від
  сирих даних, не від відфільтрованих") застосуємо і до severity-лічильників,
  щоб сума трьох чипів завжди дорівнювала `findingsCount` у банері зверху.

## Узгоджені рішення

- **Скоуп**: лічильники живуть УСЕРЕДИНІ кожного `FindingsPanel` (один
  набір на review-прогін), не агрегат на всю сторінку PR.
- **Клік — ексклюзивний тогл**: клік на CRITICAL → показані лише CRITICAL;
  повторний клік на активний чип (або клік на інший) → або скидає, або
  перемикає; одночасно активний лише один рівень або "всі".
- **Лічильник враховує ВСІ findings**, включно з accept/dismiss —
  узгоджено з тим, як вже рахує `VerdictBanner.findingsCount`.

## Дизайн-рішення, які я зафіксував сам (без окремого питання) — за прецедентом у коді

- **Числа на чипах не залежать від `hideLow`** — так само, як
  `findingsCount` у `VerdictBanner` вже не залежить від нього сьогодні.
  Якщо порахувати чипи від уже відфільтрованого (hideLow-урізаного) масиву,
  сума трьох чисел розійшлася б із банером зверху — плутанина.
- **`hideLow` і severity-фільтр компонуються (AND)**, а не взаємовиключні:
  `visibleFindings` спочатку ріже low-confidence (якщо `hideLow` on), потім
  ріже за severity (якщо фільтр обрано). Це той самий патерн, що вже є —
  просто ще один послідовний `.filter()`.
- **Чип рендериться лише коли count > 0.** Приклад із запиту ("3 CRITICAL ·
  5 WARNING · 2 SUGGESTION") — це вже "скільки є", нуль-чипи лише додають
  шум.
- **`focusIdx` (клавіатурна навігація j/k) треба клампати при зміні
  фільтра.** Зараз `focusIdx` не скидається, коли `shown` меншає через
  `hideLow` — це вже існуюча дрібна вада, яка з новим фільтром
  спрацьовуватиме частіше (люди клікатимуть по severity-чипах активніше,
  ніж по одному hideLow-тогглу). Раз я все одно чіпаю цей файл — додаю
  `useEffect`, що скидає `focusIdx` на 0 при зміні `hideLow` АБО
  `severityFilter`.

## План реалізації (client-only)

### 1. `FindingsPanel/helpers.ts`
- Нова функція `countBySeverity(findings: FindingRecord[]): Record<Severity, number>`
  — рахує від СИРОГО масиву (той самий, що йде в `VerdictBanner`), не від
  `shown`.
- `visibleFindings(findings, hideLow, severityFilter)` — додати третій
  параметр `severityFilter: Severity | null`; після існуючого
  `hideLow`-фільтра додати `if (severityFilter) shown = shown.filter((f) => f.severity === severityFilter)`.
  Сортування — без змін.

### 2. `FindingsPanel/FindingsPanel.tsx`
- Новий стан: `const [severityFilter, setSeverityFilter] = React.useState<Severity | null>(null)`.
- `const counts = React.useMemo(() => countBySeverity(findings), [findings])`.
- `shown` тепер `visibleFindings(findings, hideLow, severityFilter)`.
- Клік-хендлер: `const toggleSeverity = (sev: Severity) => setSeverityFilter((cur) => (cur === sev ? null : sev))`.
- `useEffect(() => setFocusIdx(0), [hideLow, severityFilter])` — фікс
  клампу з розділу вище.
- У `s.toolbar` (зараз лише `toggleGroup` праворуч через `marginLeft:
  auto`) — зліва додати ряд чипів, по одному на кожен `Severity` у
  `SEVERITY_ORDER`-порядку де `counts[sev] > 0`:
  ```tsx
  <button
    type="button"
    onClick={() => toggleSeverity(sev)}
    style={s.severityChip(severityFilter === sev, severityFilter !== null)}
  >
    <SeverityBadge severity={sev} count={counts[sev]} />
  </button>
  ```
  `severityFilter !== null && severityFilter !== sev` → приглушити
  (`opacity: 0.45`) неактивні чипи, коли один обрано; активний — тонка
  рамка/box-shadow кольору `SEV[sev].c` навколо кнопки (сам `SeverityBadge`
  рамки не має — додає обгортка-кнопка, без правок спільного примітиву).

### 3. `FindingsPanel/styles.ts`
- `severityChip: (active: boolean, someActive: boolean): CSSProperties` —
  `background: "none", border: "none", padding: 0, borderRadius: 6, cursor: "pointer"`,
  плюс `opacity` і `boxShadow`/`outline` за станом вище.
- `chipsGroup: { display: "flex", gap: 6 }` — обгортка ряду чипів у
  toolbar (щоб не ламати `flexWrap` існуючого `s.toolbar`).

### 4. i18n
Не потрібен — `SeverityBadge`'s лейбли (`SEV[sev].label`, "Critical" →
"CRITICAL" через CSS `text-transform`) вже хардкоджені в
`@devdigest/ui`-примітиві й використовуються так само в `FindingCard`
(`compact` варіант) без перекладу.

### 5. Тести
`FindingsPanel.test.tsx` вже існує ([перевірити перед
редагуванням](../src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.test.tsx))
— додати кейси:
- рендер N findings різних severity → відповідна кількість чипів з
  правильними числами.
- клік по чипу → у списку лишаються тільки findings цього severity.
- повторний клік по активному чипу → список повертається до повного
  (з урахуванням `hideLow`, якщо він увімкнений).
- `hideLow` + активний severity-фільтр разом → перетин, не заміна.
- findings з `accepted_at`/`dismissed_at` все одно рахуються в чипах.

## Поза скоупом
- Лічильники на рівні всього PR (сума по всіх review-прогонах) — окрема
  фіча, потребує або нової агрегації на клієнті (звести `ReviewRecord[]` в
  один список), або нового серверного ендпойнта; свідомо не робимо зараз
  (рішення вище).
- Колонка FINDINGS у списку Pull Requests (є на макеті скріншотів, яким ти
  ділився) — `server/src/modules/pulls/routes.ts` явно каже "per-severity
  breakdown intentionally not surfaced on the list"; це вже окреме
  рішення, не чіпаємо.
