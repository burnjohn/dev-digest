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

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
