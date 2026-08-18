# Insights — reviewer-core

Engine decisions and dead ends. Read before changing prompt assembly, structured
output, or grounding — the constraints here are deliberate.

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
  `src/path/to/file.ts:42`
```

Roughly 5 entries per section. Promote stable entries into `docs/` and delete
them here.

---

## Decisions

### 2026-07-31 — Mechanical grounding gate, not a trusted model

**What:** every finding must cite a real line in the diff or it is dropped, and
the verdict score is recomputed from the surviving findings.
**Why:** the model reliably invents plausible line references, and a citation
check is verifiable where a self-reported confidence is not.
**Rejected:** trusting the model's own locations and score. Findings pointed at
lines that were not in the diff, and the score did not move when they were
removed.

## What Works

_None yet._

## What Doesn't Work

_None yet._

## Codebase Patterns

- **2026-08-18** — The Intent Layer's post-grounding scope check
  (`applyScopeDemotion`) reuses the same "mechanical gate, not a trusted
  model" philosophy as `groundFindings` (see the 2026-07-31 Decision above),
  but there is no citation to check for `out_of_scope` — it is free text from
  the classifier (a path, a directory, or a short area description), not a
  glob. The match is a plain case-insensitive substring test in either
  direction. `confidence`/`signals_used` follow the same rule from the other
  side: the classification model's structured-output schema returns ONLY
  `intent`/`in_scope`/`out_of_scope` — never `confidence`, never
  `signals_used` — and the calling service (`server/src/modules/reviews/
  intent-classifier.ts`) always sets both itself, from which signals were
  actually available. `src/grounding.ts` (`applyScopeDemotion`,
  `isOutOfDeclaredScope`)

## Tool & Library Notes

_None yet._

## Recurring Errors & Fixes

_None yet._

## Open Questions

_None yet._
