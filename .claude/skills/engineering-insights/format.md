# Entry Format

## Standard Entry

```
- **YYYY-MM-DD [Category]** — One to three sentences, actionable cold. `path/to/file.ts:line`
```

Rules:

- Date first, always ISO format
- Category in brackets: `[Pattern]`, `[Mistake]`, `[Decision]`, `[Quirk]`
- Sentence starts with the *behavior*, not "I found that" or "We noticed"
- No pronouns (no "we", "I", "you") — future reader has zero context about this session
- Anchor: end with a backtick file reference whenever a specific file applies
- Maximum three sentences; if you need more, the insight is too broad

---

## Stale Entry (superseded)

```
- ~~**YYYY-MM-DD [Category]** — original text. `file:line`~~ (superseded YYYY-MM-DD — new behavior: corrected text. `file:line`)
```

Use strikethrough when the behavior changed but the history is worth keeping. Use plain deletion during monthly prune when the entry is simply no longer relevant.

---

## Promoted Entry (graduated to CLAUDE.md)

```
- → Promoted to CLAUDE.md YYYY-MM-DD
```

Replace the entry body with this single line. The rule now lives in CLAUDE.md; the pointer keeps the history slot.

---

## Good vs Bad Examples

### Mistake

**Good:**

```
- **2026-06-15 [Mistake]** — `db:seed` is not idempotent for `review_runs`; running it twice creates duplicate run records that break the agent detail page. Always check the `review_runs` count before re-seeding. `server/src/db/seed.ts:44`
```

**Bad:**

```
- **2026-06-15 [Mistake]** — Be careful when seeding the database.
```

Why bad: no file, no behavior, no fix — fails Specificity.

---

### Pattern

**Good:**

```
- **2026-06-20 [Pattern]** — Severity filter state lives in the URL search params (`?severity=critical`), not in component state — this keeps the filter bookmarkable and survives full page reloads. `client/src/app/pulls/[id]/_components/FindingsList/useSeverityFilter.ts:12`
```

**Bad:**

```
- **2026-06-20 [Pattern]** — URL state is useful for filters.
```

Why bad: too generic; fails Survival (any Next.js dev knows this pattern).

---

### Decision

**Good:**

```
- **2026-06-22 [Decision]** — Cost per review run is stored on `review_runs`, not derived from `llm_usage` at query time. The join was too expensive at scale and cost is immutable after the run completes. `server/src/db/schema.ts:201`
```

**Bad:**

```
- **2026-06-22 [Decision]** — We decided to denormalize cost.
```

Why bad: no file, no reasoning, no consequence — fails Specificity and Non-obviousness.

---

### Quirk

**Good:**

```
- **2026-06-18 [Quirk]** — `fastify-type-provider-zod` silently strips unknown response fields when the reply schema uses `.strip()` (the default). Use `.passthrough()` when the LLM response shape is not fully known at route definition time. `server/src/modules/reviews/routes.ts:67`
```

**Bad:**

```
- **2026-06-18 [Quirk]** — Fastify has some quirks with Zod schemas.
```

Why bad: names neither the behavior nor the fix — fails all four discovery tests.

---

## insights.md Section Map

| Category | Section heading |
|---|---|
| Pattern | `## Patterns` |
| Mistake | `## Mistakes` |
| Decision | `## Decisions` |
| Quirk | `## Quirks` |
| Unresolved | `## Open Questions` |

Open Questions format (no category tag needed):

```
- **YYYY-MM-DD** — What is the actual retry behavior of `parseWithRepair()` when the LLM returns malformed JSON twice in a row? `reviewer-core/src/llm.ts`
```

Remove an Open Question when it is answered. Convert it to the appropriate category entry.

---

## Footer

The last two lines of every insights.md must be:

```
---
Last updated: YYYY-MM-DD · Entries: N
```

Update both values on every write. `N` is the total count of non-stale, non-promoted entries across all sections.
