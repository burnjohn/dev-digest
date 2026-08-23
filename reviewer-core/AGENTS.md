# CLAUDE.md — reviewer-core (`@devdigest/reviewer-core`)

Pure review engine: diff + repo map → prompt → LLM → grounded, structured
findings. No DB/GitHub/FS access — the only side effect is an injected
`LLMProvider`, which is what keeps it hermetically testable. Consumed today
only by `server`, imported as raw TypeScript source via a tsconfig path
alias. Full picture: [README.md](README.md).

## Docs map

- [README.md](README.md) — module layout, testing approach
- [docs/](docs/) — prompt design / grounding algorithm deep-dives
- [specs/](specs/) — prompt/output contracts, grounding and scoring rules
- [Insights.md](Insights.md) — gotchas and decisions learned while building this package
- Root docs also apply: [../README.md](../README.md), [../TESTING.md](../TESTING.md), [../docs/agent-prompts/](../docs/agent-prompts/) (canonical reviewer system prompts)

## Commands

```bash
npm ci              # NOT pnpm — see Conventions
npm run typecheck
npm test            # vitest, hermetic — stubbed LLMProvider, no keys/network
```

## Conventions & gotchas

- Package manager is **npm**, deliberately, not pnpm — this package is
  consumed by `server` as raw source via a tsconfig path alias, and `npm`
  keeps its install story independent and simple. Don't add a pnpm lockfile
  here.
- Never built to JS — `build`/`typecheck` are both just `tsc --noEmit`.
  There is no `dist/` to ship; consumers import `src/` directly.
- Stay pure: no DB, GitHub, or filesystem calls in this package. The only
  side effect is the injected `LLMProvider` — new functionality should take
  its dependencies as parameters, not reach out to global state.
- Every finding must survive the grounding gate (`grounding.ts`) before
  being trusted — it drops findings whose cited line doesn't exist in the
  diff. `reduce.ts` recomputes the score deterministically; never trust the
  model's self-reported score.
- If `server` fails to boot with `ERR_MODULE_NOT_FOUND`, it's almost always
  this package's `node_modules` missing — see
  [../server/Insights.md](../server/Insights.md).
- Before starting work here, read [Insights.md](Insights.md) and treat it as
  high-confidence guidance. At session end, if something non-obvious was
  learned, append it (read the file first to avoid duplicating an existing
  entry) — see the `engineering-insights` skill.
