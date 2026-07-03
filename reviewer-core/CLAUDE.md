# reviewer-core (@devdigest/reviewer-core) — agent guide

The **pure** review engine: `diff → prompt → LLM → grounded findings`. No DB, FS, or network —
the only side effect is an LLM call through an **injected** `LLMProvider`. That purity is the
contract: keep it side-effect-free so it stays fully mock-testable.

## Where things live
- `src/prompt.ts` — `assemblePrompt()`, `wrapUntrusted()`, `INJECTION_GUARD` (prompt-injection hardening).
- `src/grounding.ts` — `groundFindings()`: mechanical gate dropping any finding that doesn't cite a real diff line; score recomputed from survivors.
- `src/review/run.ts` — `reviewPullRequest` entrypoint; `src/review/reduce.ts` — map-reduce for large diffs.
- `src/llm/openrouter.ts` — OpenAI-compatible provider; `src/llm/structured.ts` — Zod→JSON-schema + parse-with-repair.
- `src/output/to-review.ts` — grounded Review → GitHub review payload.
- Contracts (`Review`, `Finding`, `Verdict`) come from `@devdigest/shared`.

## Conventions
- Emits **no JS**: `build` is `tsc --noEmit`; consumers import the TS source via tsconfig path alias.
- Never add I/O here — if a task needs DB/FS/network, it belongs in `server/`, not here.

## Tests
`npm test` (vitest, LLM stubbed, no DB). Typecheck: `npm run typecheck`.
