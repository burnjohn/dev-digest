# Insights — reviewer-core/

Non-obvious findings accumulated by past sessions in this scope. Read before non-trivial work
here. Every entry should be actionable cold: a session that reads it without any other context
should know what to do or avoid.

Append with the `engineering-insights` skill (`/engineering-insights`), never by hand — the skill
dates entries, keeps the section order, and refuses duplicates. Existing entries are append-only:
correct them with a dated note below, never by rewriting.

Entry format: `` - `YYYY-MM-DD` — finding → evidence ``

## What Works

- `2026-08-02` — To actually bound an LLM call, pass a request-level signal — `client.chat.completions.create(req, { signal: AbortSignal.timeout(ms) })`. It is registered via `signal.addEventListener('abort', ...)` and never cleared, so it fires during the body read too. Note the SDK treats a caller signal as a USER abort and skips its own retries, so retry has to be ours → `reviewer-core/src/llm/openrouter.ts:54`

## What Doesn't Work

- `2026-08-02` — The OpenAI SDK's `timeout` option does NOT bound a request: `fetchWithTimeout` clears the abort timer in `.finally()` on the fetch promise, which resolves on response HEADERS, so reading the body is untimed. OpenRouter returns 200 headers immediately and holds the connection while the upstream generates, so a slow generation hangs forever — verified live: a 2000ms client timeout resolved after 22007ms with a full response, while `create(req, { signal: AbortSignal.timeout(2000) })` aborted at 2003ms → `node_modules/openai/core.js:386`
- `2026-08-02` — No openai SDK error class assigns `.name` — every one reports 'Error' and they differ only by `constructor.name`. Matching `err.name === 'APIUserAbortError'` therefore never fires, which silently broke abort detection: an abort landing BEFORE the response headers is wrapped by the SDK, while one landing during the body read stays a raw `AbortError` — only the second shape was recognised → `reviewer-core/node_modules/openai/error.js:72`

## Codebase Patterns

- `2026-08-09` — Token-bounded diff planning must handle boundaries below hunks: a single minified changed line otherwise throws, while a large hunkless/binary block bypasses the budget; UTF-8-safe line fragmentation and hunkless block splitting keep every emitted chunk within maxPromptTokens → reviewer-core/test/chunks.test.ts (minified-line and hunkless-patch cases)
- `2026-08-09` — The Onion dependency gate treats new type-only imports from reviewer-core to @devdigest/shared as real vendor edges; new core modules must reuse type aliases exposed by an existing boundary module or define a local structural union, never add the edge to the known-violations baseline → server/test/architecture-gate.test.ts (type-only fixture and exact production inventory), verified by pnpm architecture after reviewer-core/src/review/{adjudicate,chunks,model-policy}.ts were made inward-only
- `2026-08-09` — Concurrent mapper workers must return isolated per-chunk results and aggregate them only after all workers settle in original diff order; when one chunk exhausts fallbacks, an internal AbortController composed with the caller signal must abort sibling paid requests before the original chunk error is rethrown. → reviewer-core/test/run.test.ts (bounded concurrency, sibling abort, cancellation tests); live OpenRouter validation 2026-08-09: 4 chunks + fallback + adjudication in 14.8s

## Tool & Library Notes

## Recurring Errors & Fixes

- `2026-08-09` — Mapper finding IDs are chunk-local, not globally unique: constraining adjudicator output with a single Map keyed only by id silently re-anchors an earlier candidate when two chunks both emit finding-1; match id plus exact file/start/end and use id-only fallback only when unique → reviewer-core/test/run.test.ts (preserves exact anchors when mapper candidates reuse the same local id)

## Session Notes

## Open Questions
