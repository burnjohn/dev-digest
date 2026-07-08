# insights.md — evals

> Append-only. Add new entries at the bottom of the correct section.
> Discovery bar: "Would a fresh agent save ≥10 minutes from reading this?" If not, skip.
> Format: `**YYYY-MM-DD [Category]** — actionable sentence. `file:line``
> See `.claude/skills/engineering-insights/` for full criteria and format rules.

## Patterns
<!-- Reusable approaches that worked in this module. -->
- **2026-07-05 [Pattern]** — CI trigger logic is fully verifiable locally, no push needed: set `CHANGED_FILES` (newline-separated), point `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` at temp files, run `node scripts/ci-detect.mjs`, then assert on the two files' contents. This loop caught a real bug (`.claude/agents/README.md` matched the agent regex → phantom "README" agent + spurious expensive workflow-tier trigger) before it ever reached GitHub. `evals/scripts/ci-detect.mjs:25`

## Mistakes
<!-- Failure modes, antipatterns, wrong assumptions. Prioritize this section. -->
- **2026-07-05 [Mistake]** — assuming `allowedTools` restricts the toolset under `permissionMode: "bypassPermissions"`. It only PRE-APPROVES; bypass auto-approves everything else, so an agent allow-listed to Read/Glob/Grep ran `Bash` and `ReportFindings` on CI — and ReportFindings swallowed report content the LLM judge never saw (silent practice failures). The real gate is `disallowedTools`; run-claude now denies mutating/output-hijacking tools unless explicitly allowed. `evals/src/runtime/run-claude.ts:62`
- **2026-07-05 [Mistake]** — eval cases and the artifact under test can silently diverge: the L06 agent cases demand `RULE:` identifiers (`inward-only-dependencies`, `reviewer-core-zero-io`, …), verbatim evidence, and a `**Gate:**` verdict, but the repo's own architecture-reviewer.md (2026-07-02, 90 lines) never defined any of that — the identical 3 practices failed on BOTH gemini and haiku, which is the fingerprint of an artifact/eval mismatch, not model weakness. `history.jsonl` had zero `agents/` rows, so the tier had never actually run before CI. Check `grep <expected-identifiers> <artifact>` before blaming the model. Fixed by importing the template strict agent (`upstream/Lesson-06-lab-finish`).

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->

## Quirks
<!-- Dependency gotchas, env constraints, non-obvious tool or library behavior. -->
- **2026-07-05 [Quirk]** — `eval:quality` parses SKILL.md frontmatter with `gray-matter`/`js-yaml` (strict YAML), which crashes with an uncaught `YAMLException` — aborting the entire run, not just that skill — when a `description:` field contains an unquoted `: ` (colon-space), e.g. `Use when: (1)`. The Claude Code harness parses the same frontmatter leniently and loads the skill fine, so the bug is invisible until the eval runs. Fix: remove colon-space (use `—`) or quote the whole value. `evals/src/skill-quality.ts:39` *(2026-07-05: guarded — `evaluate()` now catches the parse error and FAILs only that skill; the run no longer aborts.)*
- **2026-07-05 [Quirk]** — On Windows, `pnpm exec vitest ...` spawned from `runVitestOnce`/`countTests` throws `Error: spawn pnpm ENOENT` because `pnpm` is a `.cmd` shim and Node's `spawn`/`execFileSync` don't resolve `PATHEXT` without `shell: true`. Crashes `eval:benchmark`/`eval:repeat` immediately on Windows. Fix: `shell: process.platform === "win32"` on both calls. `evals/src/run-vitest.ts:19,36`
- **2026-07-05 [Quirk]** — Workflow `trace`/`contrast` cases assert `expectFilesRead` via `filesRead.some(f => f.includes(file))`, but on Windows the `Read` tool's `file_path` arrives as an absolute backslash path (`F:\...\pipeline.md`) while every `expectFilesRead` in `cases.ts` is authored POSIX-style (`"reviewer-core/docs/pipeline.md"`) — `.includes()` never matches, so a case can fail even though the model read exactly the right file. Confirmed via trace: `reads:` listed the exact expected file (Windows-style) yet the assertion still read `false`. Fix: normalize backslashes to forward slashes at the single capture point. `evals/src/runtime/run-claude.ts:112`
- **2026-07-05 [Quirk]** — `eval:quality` link checks can pass on Windows yet fail on Linux CI when the git index holds a different-case filename than the link target (first hit: index had `templates/INSIGHTS.md`, SKILL.md linked `templates/insights.md`). Windows resolves case-insensitively; the CI checkout materializes the index's casing. Diagnose with `git ls-files <dir>` vs disk; fix with `git mv` (case-only renames are invisible to `git status` on Windows). `evals/src/skill-quality.ts:50`
- **2026-07-05 [Quirk]** — vitest positional args filter test files by SUBSTRING, not exact path: `vitest run agents/architecture-reviewer` also collects `agents/architecture-reviewer-lite/**` (crashed CI with `agent not found` because the lite variant's agent .md only exists in the lesson template branch). Pin the directory with a trailing slash — `vitest run agents/<name>/`. `.github/workflows/evals.yml`
- **2026-07-07 [Quirk]** — a bare-STRING `systemPrompt` passed to the Agent SDK `query()` gets NO environment block, so a tool-using agent never learns its cwd (a real Claude Code session always injects "working directory: …"). haiku-4.5/mistral then guess an absolute Read prefix (`/root/…`, `/home/user/…`), every read 404s, and the agent quits with "I don't have read access to the repository" — a non-deterministic agents-tier 0/N (the "phantom-path give-up" flake; defaulting to haiku did NOT fix it, it recurred on haiku 2026-07-07). Fix: `run-claude.ts` appends a cwd directive (use repo-relative paths, Glob-locate on a miss, never claim no repo access) whenever tools are present, mirroring the existing no-tools directive. Verified 0/6→6/6 on haiku-4.5. `evals/src/runtime/run-claude.ts:68`

## Open Questions
<!-- Unresolved. Convert to an entry in the appropriate section when answered. -->

---
Last updated: 2026-07-07 · Entries: 9
