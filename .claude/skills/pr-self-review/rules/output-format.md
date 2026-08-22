# Output Format

## Final report structure

Always output in this exact format. No free text outside this structure.

---

```
## 🔍 PR Self-Review Report

⚠️  Large PR detected: 52 files, 1240 lines changed.     ← only if threshold exceeded
Consider splitting into smaller PRs for more accurate review.

### Files analyzed
- UI Frontend: N files
- Backend/Domain: N files
- Tests: N files

### Findings

| Severity | File:Line | Issue | Fix | Skill |
|---|---|---|---|---|
| 🔴 CRITICAL | client/src/app/pulls/page.tsx:47 | Business logic in JSX — price calc in render | Extract to useCheckout hook | react-best-practices |
| 🔴 CRITICAL | server/src/modules/reviews/reviewController.ts:112 | Direct DB query in controller | Move to repository layer | onion-architecture |
| 🟡 HIGH | client/src/components/FindingsPanel.tsx:0 | Component changed but no test file updated | Update FindingsPanel.test.tsx | pr-self-review |
| 🔵 MEDIUM | server/src/modules/reviews/reviewService.ts:34 | Missing zod validation at boundary | Add z.parse() on input | zod |

### Ignored lines
- client/src/lib/legacy.ts:88 — intentional any cast until migration complete

---

🚫 BLOCKER — 2 CRITICAL issues must be fixed before push
```

**Or if no critical issues:**

```
---

✅ PASS — no critical issues found

### 📝 Suggested PR Description

## What changed
Adds severity filter chip buttons to FindingsPanel with activeSeverity state.

## Modules affected
- client/ — FindingsPanel: filter UI, constants, helpers
- server/ — no changes

## How to test
- [ ] Open a PR detail page, click a severity chip, verify only matching findings are shown

## Screenshots
<!-- Add screenshot or GIF of UI changes if applicable -->
```

---

## Rules for filling the table

- **Severity** — emoji + label: `🔴 CRITICAL`, `🟡 HIGH`, `🔵 MEDIUM`
- **File:Line** — relative path from repo root + `:line`. Use `0` if line unknown (e.g. contract sync)
- **Issue** — one sentence, max 10 words, factual. No "you should", no "consider"
- **Fix** — one sentence, max 10 words, actionable. Start with a verb
- **Skill** — exact skill folder name (e.g. `react-best-practices`, `onion-architecture`)

## Sorting

Sort findings by severity descending: CRITICAL first, then HIGH, then MEDIUM.
Within the same severity, sort by file path alphabetically.

## Empty state

If diff has zero files after filtering:

```
## 🔍 PR Self-Review Report

No changed files to review (all filtered as noise or no diff found).

✅ PASS
```

## Verdict line

Always the last line of the report. One of:

- `🚫 BLOCKER — N CRITICAL issue(s) must be fixed before push`
- `✅ PASS — no critical issues found`
