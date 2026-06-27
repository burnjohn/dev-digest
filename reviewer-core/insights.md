# insights.md — reviewer-core

> Append-only. Add new entries at the bottom of the correct section.
> Discovery bar: "Would a fresh agent save ≥10 minutes from reading this?" If not, skip.
> Format: `**YYYY-MM-DD [Category]** — actionable sentence. \`file:line\``
> See `.claude/skills/engineering-insights/` for full criteria and format rules.

## Patterns
<!-- Reusable approaches that worked in this module. -->

## Mistakes
<!-- Failure modes, antipatterns, wrong assumptions. Prioritize this section. -->

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->
- **2025-06-01 [Decision]** — `groundFindings()` drops hallucinated findings and the score is recomputed from surviving findings — the LLM's reported score is discarded entirely. When debugging an unexpected score, check how many findings survived in `ReviewOutcome.grounding`, not the raw LLM output.
- **2025-06-01 [Decision]** — `assemblePrompt()` appends `INJECTION_GUARD` as a system rule telling the model that `<untrusted>` blocks are data, never instructions — there is no keyword denylist. Never strip `INJECTION_GUARD` or add keyword filtering as an "extra layer"; the system rule handles this more robustly across all phrasings.

## Quirks
<!-- Dependency gotchas, env constraints, non-obvious tool or library behavior. -->
- **2025-06-01 [Quirk]** — `pnpm build` runs `tsc --noEmit` only — no compiled artifact is produced. The server imports `reviewer-core` source directly via the `@devdigest/reviewer-core` tsconfig path alias; changes are live immediately without a rebuild step.
- **2025-06-01 [Quirk]** — When `strategy = 'auto'` and any file exceeds 400 lines, map-reduce is selected with no `run.strategy` event in the stream — the caller sees only multiple `run.progress` events. Check `assembly` in `RunTrace` to confirm which strategy was used; token cost is higher than a single-pass estimate.
- **2025-06-01 [Quirk]** — `parseWithRepair()` returns `{ success: false, error }` on repair failure instead of throwing. Always check `result.success` before accessing `result.data` — a missing check causes a silent `undefined` data bug downstream.

## Open Questions
<!-- Unresolved. Convert to an entry in the appropriate section when answered. -->

---
Last updated: 2026-06-27 · Entries: 5
