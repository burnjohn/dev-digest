# Review Pipeline

The engine's single entry point is `reviewPullRequest()` in
[`../src/review/run.ts`](../src/review/run.ts). Read this before changing any step of the
pipeline — assembly, mode selection, map-reduce, or grounding.

## Shape

```
reviewPullRequest(input: ReviewInput) → ReviewOutcome
```

`ReviewInput` carries a diff, an injected `LLMProvider`, and every resolved prompt slot (skills,
memory, specs, callers, repoMap, prDescription, intent — all optional, see
[`../src/prompt.ts`](../src/prompt.ts)). The engine performs **no I/O** beyond calling the injected
LLM — no DB, GitHub, filesystem, or memory retrieval. Those stay in the caller: the server
persists + streams SSE; the CI runner posts a GitHub review + writes an artifact.

## Pipeline steps

1. **Mode selection** — `selectMode()` picks `single-pass` vs `map-reduce`:
   - `strategy: 'single-pass'` or `'map-reduce'` forces that mode explicitly.
   - `strategy: 'auto'` (default) uses map-reduce only when the diff is **both** large
     (`totalLines > mapThresholdLines`, default `400`) **and** multi-file. A large single-file diff
     still runs single-pass.
2. **Prompt assembly** — `assemblePrompt()` builds the message array for each chunk. Single-pass
   assembles once over the whole diff; map-reduce assembles once per file
   (`sliceDiff()` extracts that file's hunks).
3. **Per-chunk LLM call** — `llm.completeStructured<Review>()` with the `Review` Zod schema;
   `maxRetries` (default `2`) governs `parseWithRepair`'s reprompt budget on malformed JSON.
4. **Reduce** — `reduceReviews()` merges per-chunk partial reviews (map-reduce) or passes the
   single result through (single-pass) into one `Review`.
5. **Grounding (mandatory, shared, not duplicated per mode)** — `groundFindings()` runs exactly
   once, after reduce, regardless of mode. See
   [`grounding-algorithm.md`](grounding-algorithm.md) for the citation-gate details — never
   bypass this step or duplicate it per-chunk.
6. **Score recomputation** — the returned `review.score` is `scoreFromFindings(ground.kept)`, i.e.
   derived from the **grounded, surviving** findings only. The LLM's self-reported score is
   discarded, per the grounding invariant.

## Why grounding runs after reduce, not per-chunk

Grounding needs the final finding set to compute a score that agrees with what the caller
persists and displays. Running it per-chunk in map-reduce would grade partial, not-yet-merged
findings and could disagree with the final `Review` — so it stays a single post-reduce step
regardless of how many chunks ran.

## Events

`onEvent` fires `ReviewEvent`s (`info` / `tool` / `result`) at each step — the server relays these
over SSE (`GET /runs/:id/events`, see
[`../../server/docs/api-contracts.md`](../../server/docs/api-contracts.md)); the CI runner logs
them. Adding a new step should emit an event so both consumers stay informed without polling.

## Cancellation

`checkCancelled()` is called before each per-chunk LLM call (the expensive step) — supply a
function that throws to abort mid-run. The engine stays agnostic to the caller's cancellation
error type (the server throws its own `RunCancelledError`; the engine never imports it).

## Extending the pipeline

- New prompt slots go on `ReviewInput` and `PromptParts` ([`../src/prompt.ts`](../src/prompt.ts))
  as **optional** fields — omitting a slot must have zero effect on existing callers.
- New finding kinds that don't cite a diff line must be added to grounding's full-file whitelist
  (see [`grounding-algorithm.md`](grounding-algorithm.md)) — there is no other bypass.
- Never add I/O (DB, fs, network beyond the injected `LLMProvider`) inside `run.ts` or any file it
  calls — that breaks the "pure engine" contract both consumers (server, CI runner) rely on.
