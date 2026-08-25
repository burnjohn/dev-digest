# Сценарій демо-відео — L08 ДЗ

Показати: repository marketplace, catalog UI, встановлення `sdd-engineering@1.0.0`
в чужий проєкт, перевірений workflow, update до 1.1.0 і повернення через
stable channel — точно за критеріями `L08/10-domashnie-zavdannya.md`.

## Стан на момент запису (вже готово, не показувати як "процес")

- `dev-digest-ai-marketplace` — 4 плагіни видобуто, `1.0.0` теги вже
  запушені: `engineering-paved-path--v1.0.0`, `research-tools--v1.0.0`,
  `architecture-review--v1.0.0`, `sdd-engineering--v1.0.0`.
- GitHub Pages каталог живий: https://viptech.github.io/dev-digest-ai-marketplace/
- `plugin-install-target` — чистий тестовий репозиторій, без жодного `.claude/`.
- `docs/COST-BASELINE.md` заповнений (Фаза 5).

## Підготовка (не на записі)

```sh
cd "/Users/viptech/dev/ai agent/plugin-install-target"
git status --short          # має бути чисто
ls .claude 2>&1              # має сказати "No such file or directory"
```

Відкрити в браузері заздалегідь: https://viptech.github.io/dev-digest-ai-marketplace/
(щоб не чекати першого завантаження на записі).

## Частина A — Repository marketplace + catalog UI (~2 хв)

1. Показати репозиторій на GitHub: `github.com/viptech/dev-digest-ai-marketplace`
   — дерево `plugins/`, `.claude-plugin/marketplace.json`, вкладку **Tags**
   з чотирма `*--v1.0.0` тегами.
2. Перейти на живий каталог (вже відкрита вкладка) — показати:
   - Головну сторінку з 4 картками плагінів, версією та badge сумісності.
   - Пошук (`#/search`) — ввести ключове слово (напр. "onion") → знайти
     `onion-architecture` skill.
   - Сторінку одного плагіна (`#/plugin/sdd-engineering`) — dependency-graph
     (3 залежності), install-команда з кнопкою copy.
   - `#/whats-new` — агрегований feed CHANGELOG усіх 4 плагінів.

## Частина B — Встановлення в чужий проєкт (~3 хв, lab Крок 10)

Working directory: `plugin-install-target`.

```sh
claude plugin marketplace add viptech/dev-digest-ai-marketplace --scope project
claude plugin install sdd-engineering@dev-digest-ai-marketplace --scope project
```

1. Показати, що інсталер сам резолвнув залежності (`engineering-paved-path`,
   `research-tools`, `architecture-review`) — не потрібно було вказувати їх
   вручну.
2. `claude plugin list --json` — показати відсутність
   `dependency-unsatisfied`/`range-conflict`/`no-matching-tag`.
3. Почати нову сесію Claude Code в `plugin-install-target` (або
   `/reload-plugins`), попросити коротку фічу (напр. "add a dark-mode toggle
   to a settings screen" — той самий фікстурний сценарій, що й в evals):
   - `spec-creator` доступний і створює spec у `docs/specs/**`.
   - `implementation-planner` читає spec, будує план у `.claude/plans/**`.
   - `run-plan` диспетчить `implementer`.
   - Review gate викликає `plan-verifier` + `architecture-review:architecture-reviewer`.
4. Показати активний plugin name + version:
   ```sh
   claude plugin list --json
   ```
   Знайти запис `"name": "sdd-engineering"` → показати його `"version": "1.0.0"`
   і що всі три залежності (`engineering-paved-path`, `research-tools`,
   `architecture-review`) також у списку, без `dependency-unsatisfied`.
   Додатково (опційно, глибше): `claude plugin details sdd-engineering` —
   показує component inventory (які саме agents/skills завантажені з цієї
   версії).
5. Запустити `workflow-retro` **вручну**, показати, що він не спрацьовує
   сам по собі без явного запиту.
6. Зробити один коміт у `plugin-install-target` з результатом (spec/plan
   файли) — це і є доказ для ДЗ-критерію "посилання на pull request або
   commit" (тут — commit, без реального GitHub PR).

## Частина C — Update до 1.1.0 (~2 хв, lab Крок 11)

Working directory: `dev-digest-ai-marketplace` (спочатку) → `plugin-install-target`.

1. (Заздалегідь підготовлено або показати живцем) — новий поведінковий
   гейт у `spec-creator`: не завершує spec, доки кожна вимога не має
   AC-N. Тег `sdd-engineering--v1.1.0` уже запушено.
2. У `plugin-install-target`:
   ```sh
   claude plugin marketplace update dev-digest-ai-marketplace
   claude plugin update sdd-engineering@dev-digest-ai-marketplace --scope project
   ```
3. Нова сесія / `/reload-plugins` → `claude plugin list --json`, знайти
   `"name": "sdd-engineering"` → тепер `"version": "1.1.0"` (той самий
   доказ, що й у Частині B, пункт 4 — до/після порівняння).
4. Показати, що спроба завершити spec без AC-N тепер блокується (новий
   eval теж зелений — можна показати `evals/` прогін у `dev-digest-ai-marketplace`).

## Частина D — Rollback rehearsal (~2 хв, lab Крок 11)

Working directory: `dev-digest-ai-marketplace` для скрипта, `plugin-install-target`
для перевірки результату.

```sh
cd "/Users/viptech/dev/ai agent/dev-digest-ai-marketplace"
./scripts/rollback.sh sdd-engineering sdd-engineering--v1.0.0 --scope project
# показати dry-run вивід команд, потім повторити з --execute
./scripts/rollback.sh sdd-engineering sdd-engineering--v1.0.0 --scope project --execute
```

1. Показати друкований (а потім реально виконаний) ланцюжок:
   `marketplace remove` → `marketplace add ...@sdd-engineering--v1.0.0`
   → `plugin install`.
2. У `plugin-install-target`: нова сесія → `claude plugin list --json` →
   `"name": "sdd-engineering"` знову `"version": "1.0.0"`; spec без AC-N
   знову проходить (стара поведінка).
3. Smoke-перевірка: короткий spec→plan прогін ще раз — усе працює.
4. (Опційно, поза кадром) повернути `latest` назад:
   ```sh
   claude plugin marketplace remove dev-digest-ai-marketplace
   claude plugin marketplace add viptech/dev-digest-ai-marketplace --scope project
   claude plugin update sdd-engineering@dev-digest-ai-marketplace --scope project
   ```

## Нотатки

- Тримати dark-mode-toggle запит коротким і однаковим у частинах B і D —
  легше порівняти "до" і "після" на записі.
- `docs/COST-BASELINE.md` можна показати окремо, поза основним потоком —
  просто відкрити файл і прогорнути таблиці before/after.
- Якщо `claude plugin marketplace add` видає попередження про вже наявний
  запис з тим самим `name` — спершу `remove`, ніколи `add` поруч (відомий
  баг anthropics/claude-code#44042, обидва скрипти це враховують).
