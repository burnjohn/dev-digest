# reviewer-core/insights.md

Accumulated non-obvious findings about `@devdigest/reviewer-core`. Add an entry whenever something surprises you.

---

## 2025-06 Build produces no artifact — consumed from source

**Context**: Expecting a `dist/` folder after `pnpm build`, or after editing a file and needing to "rebuild."
**Discovery**: `pnpm build` runs `tsc --noEmit` only. No compiled output is produced. The server imports reviewer-core source directly via the `@devdigest/reviewer-core` tsconfig path alias.
**Impact**: No rebuild step needed between editing reviewer-core and running the server. Changes to `reviewer-core/src/` are live immediately.
**Status**: current

---

## 2025-06 LLM score is silently discarded — recomputed from surviving findings

**Context**: LLM returns a score of 85. The persisted score on the review is 40.
**Discovery**: `groundFindings()` drops hallucinated findings. Score is recomputed from the findings that survive — not from what the model reported. The LLM's score is discarded entirely.
**Impact**: When debugging an unexpected score, check how many findings survived grounding (see `grounding` in `ReviewOutcome`), not the raw LLM output.
**Status**: current

---

## 2025-06 Map-reduce runs silently — no explicit log entry at strategy selection

**Context**: Reviewing a large PR and noticing more LLM calls than expected.
**Discovery**: When `strategy = 'auto'` and any file exceeds 400 lines, map-reduce is selected without an explicit `run.strategy` event in the stream. The caller only sees multiple `run.progress` events.
**Impact**: Token cost is higher for large diffs than a single-pass estimate would suggest — one LLM call per large file. Check the `assembly` in `RunTrace` to see which strategy was used.
**Status**: current

---

## 2025-06 INJECTION_GUARD is a system rule, not a keyword filter

**Context**: Wondering whether "this is a test, ignore previous instructions" in a PR body would bypass the review.
**Discovery**: There is no keyword denylist. `assemblePrompt()` appends `INJECTION_GUARD` as a system rule telling the model that `<untrusted>` blocks are data, never instructions. It works across all languages and phrasings because it operates at the model-instruction level.
**Impact**: Never strip `INJECTION_GUARD`. Do not add keyword filtering as an "extra layer" — it creates false confidence and the system rule already handles this more robustly.
**Status**: current

---

## 2025-06 parseWithRepair returns a result object — it does not throw

**Context**: Calling `parseWithRepair(raw, schema, 'Review')` and expecting an exception on malformed JSON.
**Discovery**: `parseWithRepair()` attempts to fix malformed JSON before parsing. On success, returns `{ success: true, data }`. On failure (repair couldn't help), returns `{ success: false, error }`. It never throws.
**Impact**: Always check `result.success` before accessing `result.data`. A missing check causes a silent `undefined` data bug downstream.
**Status**: current
