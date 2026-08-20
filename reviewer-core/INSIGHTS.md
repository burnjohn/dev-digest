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
- `2026-08-09` — For cross-vendor OpenRouter structured reviews, inline local JSON Schema references and remove provider-unsupported numeric bounds before sending, then keep the original Zod parse as the authority; this made Claude Sonnet 4.6 accept the production Review schema without weakening application validation → live paid 57k-token request on 2026-08-09 completed in 30784ms with valid Review JSON after native schema had failed on minimum/maximum; reviewer-core/src/llm/structured.ts:18
- `2026-08-09` — GPT-5.6 Luna is a promising low-cost mapper candidate, but must still be benchmarked rather than trusted from coding scores alone: two independent replays completed the exact 55k-token structured review in about 8 s and surfaced dependency-rule and fixture-import defects that later PR commits fixed. → paid OpenRouter replays of fork PR #11; fixes 3b8b757 and f93b216, 2026-08-09

## What Doesn't Work

- `2026-08-02` — The OpenAI SDK's `timeout` option does NOT bound a request: `fetchWithTimeout` clears the abort timer in `.finally()` on the fetch promise, which resolves on response HEADERS, so reading the body is untimed. OpenRouter returns 200 headers immediately and holds the connection while the upstream generates, so a slow generation hangs forever — verified live: a 2000ms client timeout resolved after 22007ms with a full response, while `create(req, { signal: AbortSignal.timeout(2000) })` aborted at 2003ms → `node_modules/openai/core.js:386`
- `2026-08-02` — No openai SDK error class assigns `.name` — every one reports 'Error' and they differ only by `constructor.name`. Matching `err.name === 'APIUserAbortError'` therefore never fires, which silently broke abort detection: an abort landing BEFORE the response headers is wrapped by the SDK, while one landing during the body read stays a raw `AbortError` — only the second shape was recognised → `reviewer-core/node_modules/openai/error.js:72`
- `2026-08-09` — Do not assume a low reasoning effort makes DeepSeek V4 Flash 0731 latency-bounded for large structured reviews: it still exceeded 120 s on the exact 55k-token General Reviewer payload, so a hard output/reasoning budget plus model fallback is required. → paid OpenRouter replay of fork PR #11 with deepseek/deepseek-v4-flash-0731, 2026-08-09

## Codebase Patterns

- `2026-08-09` — Token-bounded diff planning must handle boundaries below hunks: a single minified changed line otherwise throws, while a large hunkless/binary block bypasses the budget; UTF-8-safe line fragmentation and hunkless block splitting keep every emitted chunk within maxPromptTokens → reviewer-core/test/chunks.test.ts (minified-line and hunkless-patch cases)
- `2026-08-09` — The Onion dependency gate treats new type-only imports from reviewer-core to @devdigest/shared as real vendor edges; new core modules must reuse type aliases exposed by an existing boundary module or define a local structural union, never add the edge to the known-violations baseline → server/test/architecture-gate.test.ts (type-only fixture and exact production inventory), verified by pnpm architecture after reviewer-core/src/review/{adjudicate,chunks,model-policy}.ts were made inward-only
- `2026-08-09` — Concurrent mapper workers must return isolated per-chunk results and aggregate them only after all workers settle in original diff order; when one chunk exhausts fallbacks, an internal AbortController composed with the caller signal must abort sibling paid requests before the original chunk error is rethrown. → reviewer-core/test/run.test.ts (bounded concurrency, sibling abort, cancellation tests); live OpenRouter validation 2026-08-09: 4 chunks + fallback + adjudication in 14.8s
- `2026-08-20` — Finding.kind is model-emitted output, so any grounding exemption keyed on it is a hallucination/injection bypass — exemptions must be caller-scoped flags on the gate, defaulted closed; defaulting allowFullFileKinds:false broke nothing because no prompt instructs full-file kinds and HookScanResult is contract-only → reviewer-core/src/grounding.ts GroundingOptions, seed-prompts audit 2026-08-20

## Tool & Library Notes

- `2026-08-09` — A reasoning-capable OpenRouter model can spend an uncapped structured-review completion entirely on reasoning and never emit the required JSON before the wall-clock timeout; always give review calls an explicit output/reasoning budget. General Reviewer on PR #11 reproduced six consecutive 90000ms timeouts, while an identical 1024-token diagnostic returned finish_reason=length with 57646 prompt tokens, 1024 completion tokens, all 1024 marked reasoning, and null content in 28508ms → reviewer-core/src/review/run.ts:198-205; reviewer-core/src/llm/openrouter.ts:138-148 ×2 (2026-08-09)
- `2026-08-09` — OpenRouter's Anthropic Claude Haiku 4.5 structured-output endpoints reject JSON Schema integer minimum/maximum keywords, so it cannot be a transparent fallback for the current Review schema unless the schema is provider-normalized first → live paid request on 2026-08-09 returned HTTP 400 from Anthropic, Amazon Bedrock, and Azure: output_config.format.schema integer properties maximum/minimum are not supported; reviewer-core/src/llm/structured.ts:18
- `2026-08-09` — OpenRouter's Google Gemini 2.5 Flash Lite structured-output endpoints reject the current Review JSON Schema because a nested evidence component reference is undefined, so advertised structured_outputs support is not sufficient for fallback compatibility; preflight the exact production schema → live paid request on 2026-08-09 returned HTTP 400 from Google and Google AI Studio: reference to undefined schema at properties.findings.items.properties.evidence.anyOf.0.items.properties.component; reviewer-core/src/llm/structured.ts:18
- `2026-08-20` — vitest@2.1.9 per-test timeout cannot interrupt a SYNCHRONOUS hot loop — the timer needs the event loop, so a test hitting an unbounded sync loop hangs the whole run (kill required) instead of failing at its { timeout }; observe RED for such a bug as a run-level hang, and keep the explicit timeout only as the post-fix guard → server/test/grounding.test.ts 'astronomically large range' regression for src/grounding.ts rangeIntersects, RED run had to be TaskStop'ed on 2026-08-20
- `2026-08-20` — instanceof against a class imported from the same openai module instance survives minification where constructor?.name string-compares die (the package ships via @vercel/ncc bundle); simulate minification in a test with Object.defineProperty(Class, 'name', ...) → reviewer-core/src/llm/openrouter.ts isAbort, reviewer-core/test/openrouter.test.ts, 2026-08-20

## Recurring Errors & Fixes

- `2026-08-09` — Mapper finding IDs are chunk-local, not globally unique: constraining adjudicator output with a single Map keyed only by id silently re-anchors an earlier candidate when two chunks both emit finding-1; match id plus exact file/start/end and use id-only fallback only when unique → reviewer-core/test/run.test.ts (preserves exact anchors when mapper candidates reuse the same local id)

## Session Notes

## Open Questions
