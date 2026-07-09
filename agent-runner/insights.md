# insights.md — agent-runner

> Append-only. Add new entries at the bottom of the correct section.
> Discovery bar: "Would a fresh agent save ≥10 minutes from reading this?" If not, skip.
> Format: `**YYYY-MM-DD [Category]** — actionable sentence. \`file:line\``
> See `.claude/skills/engineering-insights/` for full criteria and format rules.

## Patterns
<!-- Reusable approaches that worked in this module. -->

**2026-07-08 [Pattern]** — `ncc build src/index.ts -o dist` fully inlines both `@devdigest/reviewer-core` (raw TS via tsconfig path alias) and `@devdigest/shared` (also a path alias) plus their transitive deps (`zod`, `openai`) into a single `dist/index.js` with zero top-level `import`/`require` statements — verified with `grep -c "^import\|require(" dist/index.js` returning 0. `node dist/index.js` runs standalone. `agent-runner/package.json:9`

**2026-07-09 [Pattern]** — To pull a single new, isolated package from a long-diverged upstream branch (this course repo's `upstream/lesson-N-lab/*` branches carry the instructor's own independent build of every prior lesson) into a branch with its own independent history for those same lessons, use `git checkout <upstream-ref> -- <path>` instead of `git merge <upstream-ref>`. This copies only that one path's tree from the target commit into the index/working tree — no merge base is computed, so it cannot produce conflict markers, even though a full branch merge would (upstream's parallel history for every other lesson diverges hard from this repo's own). Verify compatibility afterward by running the pulled package's own `pnpm typecheck`/`pnpm test`, not by eyeballing diffs — a clean typecheck is definitive proof the path aliases resolve to compatible exports. `agent-runner/` was integrated this way from `upstream/lesson-7-lab/agent-runner` with zero source changes needed.

## Mistakes
<!-- Failure modes, antipatterns, wrong assumptions. Prioritize this section. -->

**2026-07-08 [Mistake]** — A hand-rolled unified-diff parser (`diff.ts`) that does `raw.split('\n')` without dropping a trailing empty element will over-count the last hunk's new-side line coverage by one. Any diff string terminated by `\n` (which `git diff` / GitHub's `Accept: application/vnd.github.v3.diff` output always is) produces a trailing `''` after `split('\n')`; if the parser's "else = context line" branch doesn't special-case it, that phantom line gets pushed onto `newLineNumbers`, silently widening what the citation-grounding gate considers "in the diff" by one line past the real hunk. Fix: `if (lines[lines.length - 1] === '') lines.pop()` right after the split, before the per-line loop. Caught by a fixture test asserting the exact `newLineNumbers` array, not just hunk counts. `agent-runner/src/diff.ts:19`

**2026-07-08 [Mistake]** — `if (result.error) {...} else { result.artifact.findings_count }` does NOT narrow a discriminated union (`RunCiSuccess | RunCiFailure`) in TypeScript when the discriminant property (`error`) is typed `string` on the failure branch and `undefined` on the success branch (not a shared literal). `tsc` correctly refuses to narrow on truthiness here (a failure could theoretically carry `error: ''`). Discriminate on a property with a real type difference instead — `result.artifact === null` (`CiResultArtifact | null`) narrows cleanly both ways. `agent-runner/src/index.ts:52`

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->

**2026-07-08 [Decision]** — `agent-runner/tsconfig.json` intentionally mirrors `server/tsconfig.json`'s compiler options and path-alias block verbatim (aliasing `@devdigest/reviewer-core` → `../reviewer-core/src/index.ts` and `@devdigest/shared` → `../server/src/vendor/shared/index.ts`), so both consumers resolve the exact same source files. `agent-runner/vitest.config.ts` re-declares the same two aliases (vitest/vite doesn't read `tsconfig.json` paths automatically) — matches the pattern already used in `reviewer-core/vitest.config.ts`. `agent-runner/tsconfig.json:21`

**2026-07-09 [Decision]** — Packages checked out from an upstream lesson branch (see the Pattern entry above) ship their own `CLAUDE.md`/insights conventions, which don't match this repo's established per-package pattern (`CLAUDE.md` = one-line `@AGENTS.md` pointer with content living in `AGENTS.md`; notes live in a flat `insights.md`, never a nested `insights/` folder). Normalize on integration: move the vendored `CLAUDE.md` content into `AGENTS.md`, replace `CLAUDE.md` with `@AGENTS.md`, flatten any nested insights file into `insights.md` using the categories in `.claude/skills/engineering-insights/templates/insights.md`, and fix internal cross-references that pointed at the old paths. Done for `agent-runner/` on 2026-07-09 (was `CLAUDE.md` + `insights/INSIGHTS.md`).

## Quirks
<!-- Dependency gotchas, env constraints, non-obvious tool or library behavior. -->

**2026-07-08 [Quirk]** — `pnpm typecheck` in `agent-runner` fails with `Cannot find module 'zod'` / `'openai'` errors pointing at `reviewer-core/src/llm/*.ts` if `reviewer-core/node_modules` was never installed. Because this repo is NOT a monorepo (no `pnpm-workspace.yaml`, no hoisting across packages), TypeScript's `moduleResolution: "Bundler"` walks up the ancestor directories of the *importing file* — `reviewer-core/src/llm/` → `reviewer-core/` → repo root — and never reaches `agent-runner/node_modules` (a sibling, not an ancestor). Fix: `cd reviewer-core && pnpm install` once (creates gitignored `node_modules`, touches no tracked files) — this is also required for `cd server && pnpm typecheck` to pass cleanly, so it is not agent-runner-specific. `agent-runner/tsconfig.json:20`

**2026-07-08 [Quirk]** — `@vercel/ncc` versions jump from `0.38.4` straight to `0.43.0`/`0.44.x` on npm (no `0.39`–`0.42` releases). A `^0.38.3` semver range resolves to `0.38.4`, not the newer `0.44.x` line — pin explicitly if the newer major-minor is desired. `agent-runner/package.json:15`

## Open Questions
<!-- Unresolved. Convert to an entry in the appropriate section when answered. -->

**2026-07-08 [Open Question]** — `AgentManifest` has no `post_as` field and the generated GHA workflow (`server/src/modules/ci/workflow.ts`) doesn't set a `POST_AS`-equivalent env var, so in production the runner will always fall back to `index.ts`'s default (`'github_review'`) regardless of what the studio's export dialog captured (`CiExportInput.post_as`). Should `post_as` be folded into `AgentManifest` (persisted per-agent, read by the runner) or threaded through the workflow as an explicit env var? Whoever owns the export/workflow-generation track should close this loop — `runCi()` already accepts `postAs` as a first-class parameter, so wiring either fix through only touches `index.ts` plus the manifest/workflow generator. `server/src/vendor/shared/contracts/eval-ci.ts` (`AgentManifest`), `agent-runner/src/index.ts:25`

**2026-07-09 [Open Question]** — `server/src/modules/ci/` (the module this package's own docs point to for "workflow generation" and "manifest writing") does not exist in this repo. Only its two prerequisites do: the DB schema (`server/src/db/schema/ci.ts` — `ci_installations`, `ci_runs`) and the shared Zod contracts (`server/src/vendor/shared/contracts/eval-ci.ts` — `AgentManifest`, `CiExportInput`, `CiExport`, `CiResultArtifact`, etc.), both unregistered/unused by any route. `agent-runner` itself typechecks and tests clean against this repo's `reviewer-core`/`shared` with zero changes (23/23 tests, verified 2026-07-09) — it is the CI-side consumer only. The producer side (compose `.devdigest/agents/<slug>.yaml` + skills bundle from an `Agent` row, generate the GHA workflow YAML, expose `POST /agents/:id/export-ci`, ingest `devdigest-result.json` back into `ci_runs`) has no code yet and no spec/plan doc in `docs/`. Treat as a fresh feature needing its own spec before implementation, not a "finish the wiring" task.

---
Last updated: 2026-07-09 · Entries: 10
