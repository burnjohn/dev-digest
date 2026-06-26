# reviewer-core/CLAUDE.md

Pure review engine — `@devdigest/reviewer-core`. No I/O, no side effects.
Root conventions in [../CLAUDE.md](../CLAUDE.md).

## Hard rules

- **Zero I/O** — no DB calls, no file reads, no `process.env` access. All dependencies are injected.
- **Grounding is mandatory** — never bypass `groundFindings()`. New finding types must either cite a real diff line or be added to the full-file kind whitelist in `grounding.ts`.
- **`INJECTION_GUARD`** — appended automatically by `assemblePrompt()`. Never strip or work around it.

## Public API (`src/index.ts`)

| Export | Purpose |
|---|---|
| `reviewPullRequest(input)` | Entry point — returns `ReviewOutcome` + `ReviewEvent[]` |
| `assemblePrompt(parts)` | Builds messages array, wraps untrusted content in `<untrusted>` blocks |
| `groundFindings(findings, diff)` | Citation gate — returns kept + dropped findings |
| `toReviewPayload(review, diff)` | Convert findings → GitHub review comment payload (CI export) |
| `parseWithRepair(raw, schema)` | Parse LLM JSON output with auto-repair; check `.success` before `.data` |

## Prompt slots (all optional)

`skills` · `memory` · `specs` · `callers` · `repoMap` · `prDescription`

Omitting a slot has zero behavioral effect on existing callers. Add new slots without modifying existing call sites.

## Build

`pnpm build` = `tsc --noEmit` (type-check only). No compiled artifact is produced.
Consumed via tsconfig path alias `@devdigest/reviewer-core` → `../reviewer-core/src`. Changes are live immediately.
Tests: `npm test` (Vitest, hermetic — uses stubbed `LLMProvider`).

## Session Protocol

**Start of session:** Read `insights.md` and briefly summarize the most relevant entries for the current task.
**End of session:** Run `/engineering-insights` to capture discoveries. Do not skip after sessions > 30 min with a real problem or decision.

## See also

- [README.md](README.md) — pipeline diagram, grounding algorithm
- [docs/](docs/) — design decisions
- [specs/](specs/) — engine behavior specs
- [insights.md](insights.md) — accumulated gotchas
- [../CLAUDE.md](../CLAUDE.md) — root conventions
