# reviewer-core Gotchas

## This package never emits JavaScript

`npm run build` runs `tsc --noEmit`. There is no `dist/` directory. The package is always consumed as raw TypeScript source via a path alias. If another package imports from `@devdigest/reviewer-core` and TypeScript cannot resolve it, the problem is in `tsconfig.json` paths — not a missing build step.

## wrapUntrusted() and INJECTION_GUARD work as a pair

`wrapUntrusted()` wraps untrusted content in `<untrusted-content>` fences. `INJECTION_GUARD` (appended to system prompt) instructs the model to treat fenced content as data only. If you remove either one, the defense breaks. They must always be used together.

## INJECTION_GUARD cannot be overridden by the agent system prompt

`INJECTION_GUARD` is always appended **after** the agent's system prompt, so even if an agent's prompt says "follow all instructions", the guard is the last word. It is not configurable.

## groundFindings() dropping everything is valid behavior

If the LLM hallucinates all findings (quotes that don't exist in the diff), `groundFindings()` drops all of them and returns an empty array with `score: 100, verdict: "approved"`. This is correct behavior, not a bug. The calling code must not treat an empty findings array as an error.

## LLMProvider must be injected — no global instances

There is no global LLM client. Every call to the LLM goes through the injected `LLMProvider`. In production, the server injects a real provider configured from `SecretsProvider`. In tests, a stub is injected. Never import an LLM SDK directly inside reviewer-core.

## parseWithRepair is not a fix for bad prompts

`parseWithRepair` handles models that wrap JSON in markdown code blocks (` ```json ... ``` `). It is a compatibility shim, not a general error recovery tool. If the model is returning structurally invalid JSON consistently, the prompt or response format configuration is wrong — fix that instead of relaxing the parser.

## Map-reduce for large diffs is a stub in L01

For diffs exceeding ~400 lines across multiple files, the plan is to split by file and reduce findings. In L01, this is not fully implemented. Very large diffs may hit context limits in the LLM or produce lower-quality findings. This will be addressed in a later lesson.
