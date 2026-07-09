# insights.md — reviewer-core

> Append-only. Add new entries at the bottom of the correct section.
> Discovery bar: "Would a fresh agent save ≥10 minutes from reading this?" If not, skip.
> Format: `**YYYY-MM-DD [Category]** — actionable sentence. \`file:line\``
> See `.claude/skills/engineering-insights/` for full criteria and format rules.

## Patterns
<!-- Reusable approaches that worked in this module. -->

## Mistakes
<!-- Failure modes, antipatterns, wrong assumptions. Prioritize this section. -->
- **2026-07-09 [Mistake]** — Assuming `reviewer-core`'s only consumer is `server/` is no longer safe: `agent-runner/` (checked out from `upstream/lesson-7-lab/agent-runner`) imports `reviewPullRequest`, `toReviewPayload`, `gateTriggered`, `countBlockers`, and `OpenRouterProvider` from this package's public API exactly like `server/` does (raw TS via the `@devdigest/reviewer-core` tsconfig alias) — but `agent-runner/` is NOT part of the local dev stack (`scripts/dev.sh` never touches it) and has no CI workflow of its own yet, so a green `server` typecheck/test run does NOT prove `agent-runner` still compiles. Run `cd agent-runner && pnpm typecheck && pnpm test` too before changing any exported signature in `src/index.ts`.

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->
- **2025-06-01 [Decision]** — `groundFindings()` drops hallucinated findings and the score is recomputed from surviving findings — the LLM's reported score is discarded entirely. When debugging an unexpected score, check how many findings survived in `ReviewOutcome.grounding`, not the raw LLM output.
- **2025-06-01 [Decision]** — `assemblePrompt()` appends `INJECTION_GUARD` as a system rule telling the model that `<untrusted>` blocks are data, never instructions — there is no keyword denylist. Never strip `INJECTION_GUARD` or add keyword filtering as an "extra layer"; the system rule handles this more robustly across all phrasings.
- **2026-06-30 [Decision]** — The intent block in `assemblePrompt()` is injected into the SYSTEM message (trusted, not `<untrusted>` wrapped) because it is the system's own output from the cheap-model pre-pass — not author-controlled content. It is placed BEFORE `INJECTION_GUARD` so the scope instruction is established before the security rule. `intent` is optional: omitting it has zero effect on existing callers.

## Quirks
<!-- Dependency gotchas, env constraints, non-obvious tool or library behavior. -->
- **2025-06-01 [Quirk]** — `pnpm build` runs `tsc --noEmit` only — no compiled artifact is produced. The server imports `reviewer-core` source directly via the `@devdigest/reviewer-core` tsconfig path alias; changes are live immediately without a rebuild step.
- **2025-06-01 [Quirk]** — When `strategy = 'auto'` and any file exceeds 400 lines, map-reduce is selected with no `run.strategy` event in the stream — the caller sees only multiple `run.progress` events. Check `assembly` in `RunTrace` to confirm which strategy was used; token cost is higher than a single-pass estimate.
- **2025-06-01 [Quirk]** — `parseWithRepair()` returns `{ success: false, error }` on repair failure instead of throwing. Always check `result.success` before accessing `result.data` — a missing check causes a silent `undefined` data bug downstream.
- **2026-06-30 [Quirk]** — In git worktrees, `node_modules` live ONLY in the main repo checkout, not in the worktree. To typecheck worktree files, copy them to the main repo or run `node /path/to/main-repo/reviewer-core/node_modules/typescript/lib/tsc.js --noEmit` with the worktree's tsconfig. Vitest also fails in worktrees for the same reason. `@rollup/rollup-win32-x64-msvc` optional dep missing from npm install on this Windows machine makes vitest unable to run even in the main repo.
- **2026-07-06 [Quirk]** — Fix for the above: `reviewer-core/node_modules` on this machine was installed under Linux/WSL (only `linux-x64` platform binaries present for both `@rollup` and `@esbuild`, incl. nested `node_modules/vite/node_modules/@esbuild`), so running vitest natively on Windows fails twice in sequence — first `Cannot find module @rollup/rollup-win32-x64-msvc`, then (after fixing that) `esbuild ... needs the "@esbuild/win32-x64" package instead`. Workaround: copy `win32-x64` variants of both from `client/node_modules/@rollup/rollup-win32-x64-msvc` and `client/node_modules/@esbuild/win32-x64` (client's install is native Windows) into `reviewer-core/node_modules/@rollup/` and both `reviewer-core/node_modules/@esbuild/` AND `reviewer-core/node_modules/vite/node_modules/@esbuild/`. Also: the pnpm-generated `node_modules/.bin/vitest` shim on this checkout is a broken POSIX shell script (`import: command not found` — not a real executable); invoke `node node_modules/vitest/vitest.mjs run` directly instead of the bin shim.
- **2026-07-06 [Mistake]** — Mid-session, three source edits (`reviewer-core/src/llm/structured.ts`, `reviewer-core/src/review/reduce.ts`, `server/src/vendor/shared/contracts/findings.ts`) were silently reverted to their pre-edit content by an external process (a concurrent parallel session/watcher touching the same repo checkout) between the Edit tool call succeeding and the next verification step — the Read tool's cache reported "file unchanged" even though `grep`/`wc -l` on disk showed the original pre-edit content. Always re-verify file content with a fresh shell command (`grep`/`wc -l`, not the Read tool's cache) immediately before every gate (typecheck, test run) when working in a shared checkout — do not trust "no edit since last read" from the Read tool alone.

## Open Questions
<!-- Unresolved. Convert to an entry in the appropriate section when answered. -->

---
Last updated: 2026-07-09 · Entries: 10
