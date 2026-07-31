# client — Insights
↑ [CLAUDE.md](./CLAUDE.md)

Append-only log of non-obvious decisions and gotchas for the web app. Newest
first. One entry per learning.

## Format
```
## YYYY-MM-DD — <short title>
**Problem:** …  **Decision:** …  **Why:** …
```

## 2026-07-31 — Hover popover that lazy-loads: mount content only while open
**Problem:** A hover popover on every PR-list row must show finding details, but fetching all rows' findings upfront is wasteful. **Decision:** `HoverCard` (pulls/_components/HoverCard) renders its content **only while `open`**; the list popover content (`ListFindingsPreview`) calls `usePrReviews(prId)` and thus fires the request only when the card mounts (on hover). **Why:** No `enabled` flag or hook changes needed — mount-gating is the trigger. TanStack caches by `["reviews", prId]`, so re-hover is instant. There is no Popover/Tooltip/HoverCard primitive in `@devdigest/ui`, so this small component fills the gap.

## 2026-07-31 — PR-detail findings are grouped per run; PR-wide filters live in FindingsTab
**Problem:** A PR-wide severity filter/tally has no single findings list to hook into — findings render per review run (`FindingsTab` → `ReviewRunAccordion` → `FindingsPanel`, one panel per run). **Decision:** Lift the aggregate (counts from `reviews.flatMap(r => r.findings)`) and the active-filter state to `FindingsTab`, thread `severityFilter` down into every `FindingsPanel`, and hide accordions with zero matches. **Why:** Matches how the detail page already fans findings across runs; computing counts from the already-fetched reviews keeps them consistent with what's rendered and needs zero extra requests.

## 2026-07-31 — next-intl keys need a dev restart + hard refresh to appear
**Problem:** A newly-added message key rendered as its raw path (e.g. `runs.trace.stat.cost`) even though the JSON was correct. **Decision:** After editing `messages/en/*.json`, restart the web dev server and hard-refresh. **Why:** `src/i18n/request.ts` reads messages via fs and they're hydrated into `NextIntlClientProvider` at page load; client-side navigation reuses the stale hydrated set, so a missing key falls back to the dotted path until a fresh server render.

## 2026-07-31 — Shared contracts have no sync script; mirror server→client
**Problem:** Client didn't see a contract field added on the server. **Decision:** Every `@devdigest/shared` change edited in `server/src/vendor/shared/contracts/*` must be hand-copied to `client/src/vendor/shared/contracts/*`. **Why:** No vendor-sync script exists; the vendored client copy is what the app validates against, so a one-sided edit drops the field with no error.
