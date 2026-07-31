# reviewer-core — the review engine (`@devdigest/reviewer-core`)
↑ [Root map](../CLAUDE.md)

Map of this module for AI agents. The pipeline diagram and public API live in the
README (linked below) — this file is the map, not the docs.

## Stack & commands
- Pure logic: **diff → prompt → LLM → grounded findings**. No DB, GitHub, or
  filesystem; the only side effect is an LLM call via an **injected** `LLMProvider`.
- `pnpm test` (vitest, hermetic, stubbed `LLMProvider`) · `pnpm typecheck`.
- **Source-only: the package never emits JS.** `build` is a type-check. Consumers
  (currently `server`) import the TS source via tsconfig path alias
  (`@devdigest/reviewer-core` → `../reviewer-core/src`).

## Map (where things live)
| Path | Purpose |
|------|---------|
| `src/review/run.ts` | orchestrates a run (single-pass by default) + `reduce` |
| `src/review/prompt.ts` | `assemblePrompt`, `wrapUntrusted`, `INJECTION_GUARD` |
| `src/review/grounding.ts` | `groundFindings` — mandatory citation gate vs the diff |
| `src/llm/*` | `LLMProvider`, structured output (Zod→JSON Schema, parse-with-repair) |
| `src/output/*` | response formatting |
| `src/index.ts` | public API surface |

## Conventions (non-default)
- **Grounding is mandatory** and lives here — a finding not citing a real diff line
  is dropped; the score is recomputed from survivors, never trusted from the model.
- **Injection defense = one shared trusted rule** (`INJECTION_GUARD`), not keyword
  scanning of untrusted text.
- Optional prompt slots (`skills`, `memory`, `specs`, `callers`) are added by later
  course lessons; in the starter they're omitted and `assemblePrompt` leaves those
  sections out.

## Do-not-touch
- Don't add DB/GitHub/filesystem side effects — purity is what makes the engine
  mock-testable. New I/O belongs behind an injected port, not inline.
- Contracts (`Review`, `Finding`, `Verdict`) come from `@devdigest/shared` — don't
  redefine them here.

## Read when…
- Read `./README.md` for the pipeline diagram & full public API.
- Read `./docs/README.md` when you need deeper engine design notes.
- Read `./specs/README.md` when changing behavior covered by a spec.
- Read `./INSIGHTS.md` at the START of any task here; append substantial,
  non-duplicate insights at the END (engineering-insights skill).
- Read [`../server/README.md`](../server/README.md#review-context-non-obvious) for
  how the server assembles the inputs it passes in.
