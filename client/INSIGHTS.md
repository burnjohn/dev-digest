# Insights — client

UI decisions and dead ends. Read before restructuring pages, state, or the data
layer.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it out.

Formats — `Decisions` takes prose; every other section takes a dated bullet:

```markdown
### YYYY-MM-DD — <short title>

**What:** the decision, in one sentence.
**Why:** the constraint that forced it.
**Rejected:** what we tried or considered, and how it failed.
```

```markdown
- **YYYY-MM-DD** — <the claim, specific enough to act on cold>.
  `src/path/to/file.tsx:42`
```

Roughly 5 entries per section. Promote stable entries into `docs/` and delete
them here.

---

## Decisions

_None yet. Add the first one the next time a UI approach is tried and
abandoned — that is exactly what this file is for._

## What Works

_None yet._

## What Doesn't Work

_None yet._

## Codebase Patterns

- **2026-08-01** — Any overlay anchored to a PR-list row must be portalled to
  `document.body` with `position: fixed`, not absolutely positioned inside the
  row. `s.tableCard` sets `overflow: "hidden"` (it is what keeps the first/last
  row inside the card's rounded corners), so an absolute panel is clipped at the
  card edge — invisibly fine for the top rows and broken for every row near the
  bottom, which is the majority. `SeverityCounters` anchors via
  `getBoundingClientRect()`, flips above the trigger when the panel would run
  past `window.innerHeight`, and repositions on `scroll`/`resize` (capture
  phase) rather than closing, so a row scrolling under the cursor does not read
  as a dismissal. Note this makes "outside click" span two disjoint nodes — the
  dismiss handler must check the trigger wrapper **and** the portalled panel.
  There is still no `Popover` primitive; `src/vendor/ui` is off-limits, so
  app-level overlays copy the outside-click shape from
  `src/vendor/ui/kit/Dropdown.tsx:60`.
  `client/src/components/severity-counters/SeverityCounters.tsx:104`
  `client/src/app/repos/[repoId]/pulls/styles.ts:91`

## Tool & Library Notes

_None yet._

## Recurring Errors & Fixes

- **2026-08-01** — `TS7053: … expression of type 'Severity' can't be used to
  index type '{ CRITICAL: number; WARNING: number; SUGGESTION: number; }'.
  Property 'INFO' does not exist` means `Severity` was imported from
  `@devdigest/ui` when it should have come from `@devdigest/shared`. The two are
  different types with the same name: the UI token map carries a fourth `INFO`
  entry (`src/vendor/ui/primitives/tokens.ts:5`) that the Zod enum
  (`contracts/findings.ts:11`) does not define and the API never emits. Import
  the contract type for anything that indexes, tallies, or round-trips a
  severity; the UI type is a superset, so a contract value still passes straight
  into `<SeverityBadge severity={…} />` with no cast. Existing call sites that
  do `f.severity as Severity` are papering over exactly this.
  `client/src/components/severity-counters/SeverityCounters.tsx:9`

- **2026-08-01** — A vitest failure whose two sides look identical —
  `expected '9 119 tok' to be '9 119 tok'` — is a look-alike Unicode space, not
  an environment difference. `formatTokenCount` had a literal THIN SPACE
  (U+2009) typed into `.replace(/,/g, " ")`, invisible in the diff and in the
  test output. Dump code points first —
  `[...s].map((c) => c.charCodeAt(0).toString(16))` — before theorising about
  ICU or jsdom locale data, which is where this was initially misdiagnosed.
  Group digits with `.replace(/\B(?=(\d{3})+(?!\d))/g, " ")` rather than
  `toLocaleString` plus a separator swap, so the separator is a plain U+0020 a
  test can type. Find strays with `rg '\x{2009}' src/`.
  `client/src/lib/format.ts:40`

## Open Questions

_None yet._
