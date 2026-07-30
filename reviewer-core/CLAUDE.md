# reviewer-core/ — @devdigest/reviewer-core

Pure review engine. No DB, no filesystem, no GitHub — only side effect is the LLM call (injected).
Read `reviewer-core/README.md` for full pipeline diagram and public API.

## Pipeline

```
diff + system prompt + repo map
  → assemblePrompt()        # wraps untrusted content, appends INJECTION_GUARD
  → LLMProvider (injected)  # structured output via JSON Schema
  → groundFindings()        # drops findings with hallucinated line refs
  → scoreFromFindings()     # CRITICAL −35 · WARNING −12 · SUGGESTION −3
```

## Gotchas

- **Grounding is mandatory** — a finding that doesn't cite a real diff line is dropped, no exceptions
- **Score is always recomputed** — model's self-reported score is ignored; server calls `scoreFromFindings()`
- **INJECTION_GUARD** is appended by `assemblePrompt` automatically — do NOT add it manually in agent prompts
- Package never emits JS — `build` script is a typecheck only; server consumes source via tsconfig path alias

## Testing

`npm test` — hermetic units with stubbed `LLMProvider`. No API keys, no network calls.

## Session protocol

- **Start:** silently read `reviewer-core/LEARNINGS.md` before responding — treat as high-confidence guidance.
- **End:** run `/engineering-insights` only if something substantial and new was found. If nothing non-obvious happened, write nothing. Before writing any entry, re-read LEARNINGS.md to avoid duplicates.

## Read when

- Full pipeline + public API → `reviewer-core/README.md`
- Lessons and session learnings → `reviewer-core/LEARNINGS.md`
- Prompt and grounding specs → `reviewer-core/specs/`
- Technical docs → `reviewer-core/docs/`
