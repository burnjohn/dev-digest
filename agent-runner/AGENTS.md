# agent-runner/AGENTS.md

Bundled CI runner — `@devdigest/agent-runner`, not part of any workspace. `ncc`-compiled into a
single self-contained `dist/index.js`, embedded as `.devdigest/runner/index.js` in the exported
`devdigest/ci` PR, and executed by the **target repo's own GitHub Actions** — entirely outside this
repo's server, its DI graph, and its Postgres instance. Root conventions in [../AGENTS.md](../AGENTS.md).

## Module Layout

```
agent-runner/
├── src/
│   ├── index.ts        # CLI entry: load manifest → assemble prompt → review → post → exit code
│   └── ...              # helpers (manifest loading, GitHub posting, artifact writing)
├── dist/index.js        # ncc-bundled output — the file actually shipped to target repos
├── package.json          # scripts: typecheck, build (ncc), test
├── tsconfig.json         # mirrors server/tsconfig.json's path aliases
└── vitest.config.ts      # hermetic tests, LLM stubbed
```

## What This Package Does

1. Reads the checked-in `.devdigest/agents/<slug>.yaml` manifest and `.devdigest/skills/*.md` from
   the target repo's working tree (validated against `AgentManifest` before use).
2. Assembles the PR diff + PR body/title from CI context and runs them through the same
   `reviewer-core` pipeline a local studio run uses (`assemblePrompt` / `wrapUntrusted` /
   `groundFindings` / deterministic verdict).
3. Injects `OpenRouterProvider` (built from a CI-injected env var, not the studio's
   `SecretsProvider`) into `reviewPullRequest`.
4. Posts the result to the PR (`github_review` | `pr_comment` | `none`) using a CI-injected GitHub
   token, writes `devdigest-result.json` (`CiResultArtifact`), and exits non-zero iff the
   deterministic gate triggered `REQUEST_CHANGES`.

## Why This Package Intentionally Breaks the `SecretsProvider` Rule

Every other package in this repo funnels secrets through the injected `SecretsProvider`, and
`server/AGENTS.md` states secrets must never be read from `process.env` directly in services.
**That chokepoint is scoped to `server/` — it does not extend here.**

`agent-runner` runs as a CI step in a *different* repository's Actions runner. There is no
`Container`, no `SecretsProvider`, no DI graph to receive an injected secret from — the only
channel CI has for handing this process a credential is an environment variable set by the
workflow (`env:` / `secrets.*` in the generated GHA YAML). Reading `OPENROUTER_API_KEY` and
`GITHUB_TOKEN` directly from `process.env` in `src/index.ts` (or its helpers) is therefore the
**correct and only available mechanism**, not a violation of the server's secrets discipline.

Do not "fix" this by trying to inject a `SecretsProvider` here — there is nothing on the other end
of that abstraction once the bundle is running in someone else's CI. Do not log these values or
let them reach `devdigest-result.json` / any posted comment.

## Consuming `reviewer-core`

`reviewer-core` is consumed exactly like the server does: as **raw TypeScript source** via a
`tsconfig.json` path alias (`@devdigest/reviewer-core` → `../reviewer-core/src/index.ts`), never as
a built artifact — `reviewer-core` emits no JS (see `reviewer-core/AGENTS.md`). `@devdigest/shared`
is resolved the same way, aliased to `../server/src/vendor/shared/index.ts`. `pnpm build` (`ncc`)
inlines both, plus their transitive deps, into `dist/index.js` so the shipped bundle has zero
runtime imports from `node_modules/@devdigest/*`.

Because this package embeds `reviewer-core`'s pipeline directly into a CI artifact that leaves this
repo, it **must preserve every reviewer-core invariant unchanged**:

- The `groundFindings()` gate is mandatory — never skip or make it conditional. A run where
  grounding drops every finding is a valid zero-finding APPROVE result, not an error.
- `wrapUntrusted()` + `INJECTION_GUARD` must wrap the diff and PR body before they reach the
  prompt — reuse `assemblePrompt`, which applies the guard internally; never hand-roll it.
- The posted verdict and exit code must come from the **deterministic** gate computation
  (`countBlockers`/gate against the manifest's `ci_fail_on`), never the model's self-reported
  verdict.

If a future change to `reviewer-core` would require bypassing any of the above just to make the
runner work, that is a signal the change belongs in a spec/plan discussion, not a quiet workaround
here.

## Do Not Touch Without Reading

- `src/index.ts` — CLI entry point; changes affect every future CI run across every target repo
  that has already installed this bundle.
- `tsconfig.json` — path aliases must keep resolving `reviewer-core` and `@devdigest/shared` to
  raw source, not a built artifact.

## Read When

| Task | Read |
|---|---|
| Modifying the review pipeline this package calls into | `reviewer-core/docs/pipeline.md` |
| Changing what gets embedded in the exported PR / workflow generation | `server/src/modules/ci/` (owned by the server `ci` module — **not yet built in this repo**; only the DB schema (`server/src/db/schema/ci.ts`) and shared contracts (`server/src/vendor/shared/contracts/eval-ci.ts`) exist so far) |
| Hit unexpected behavior (ncc bundling, path-alias resolution) | [insights.md](insights.md) |

## Session Protocol

**Start of session:** Read `insights.md` and briefly summarize the most relevant entries for the current task.
**End of session:** Run `/engineering-insights` to capture discoveries. Do not skip after sessions > 30 min with a real problem or decision.

## See also

- [README.md](README.md) — requirements, commands, runtime env vars, exit codes
- [insights.md](insights.md) — accumulated gotchas
- [../AGENTS.md](../AGENTS.md) — root conventions
