# reviewer-core/ — @devdigest/reviewer-core

Pure review engine: diff + repo map → prompt → LLM → grounded structured findings.

## Stack

- TypeScript 5.7 (strict), Zod 3.24, OpenAI SDK 4.x
- ZERO side effects — no DB, no GitHub, no filesystem
- Only side effect: LLM call through INJECTED `LLMProvider`
- Never emits JS — consumed as TypeScript source via tsconfig path alias

## Commands

```sh
pnpm test        # vitest (hermetic, stubbed LLMProvider)
pnpm typecheck   # tsc --noEmit (this IS the build)
```

## Where things live

- `src/index.ts` — public API barrel (all exports go through here)
- `src/prompt.ts` — prompt assembly + `wrapUntrusted()` + INJECTION_GUARD
- `src/grounding.ts` — citation gate (drops findings with invalid diff line refs)
- `src/review/run.ts` — orchestration entry point (`reviewPullRequest()`)
- `src/review/reduce.ts` — map-reduce helpers, diff slicing
- `src/llm/structured.ts` — Zod → JSON Schema, parse-with-repair
- `src/llm/openrouter.ts` — OpenRouter provider (shared with server + CI runner)
- `src/output/to-review.ts` — grounded Review → GitHub review payload (CI export)

## Conventions

- Pure functions, injected dependencies — designed for mock testing
- `@devdigest/shared` contracts come from server's vendor copy (tsconfig path)
- Pins its own `zod` in tsconfig paths to avoid dual-instance issues with server
- Score is RECOMPUTED from surviving findings — model's self-reported score is ignored
- Grounding is mandatory and mechanical — no LLM-based verification

## Gotchas

- Prompt has optional slots (skills, memory, specs, callers) — starter passes only diff + system + repo map; missing slots are silently omitted
- `INJECTION_GUARD` is always appended to system prompt — never remove it
- `parseWithRepair` attempts to fix broken JSON from LLM before failing

## Do not touch

- The grounding gate logic in `grounding.ts` — it's the anti-hallucination safety net
- `INJECTION_GUARD` in `prompt.ts` — the prompt-injection defense

## Deep docs (read on demand)

- [INSIGHTS.md](INSIGHTS.md) — what past sessions learned in this package; read before non-trivial work
- [README.md](README.md) — pipeline diagram, public API listing
- [../docs/agent-prompts/](../docs/agent-prompts/) — reviewer prompt design, model selection
- [../TESTING.md](../TESTING.md) — CI workflow for this package
