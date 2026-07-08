# server/src/vendor/shared/AGENTS.md

Single source of truth for all cross-package types. Consumed via the `@devdigest/shared` tsconfig path alias — not a published npm package.

## Rules

- If a type is needed in two packages → it lives here, nowhere else
- Always re-export new types from `index.ts` (barrel)
- `adapters.ts` contains **interface definitions (ports) only** — implementations live in `server/src/adapters/`
- Do not add runtime dependencies here; this folder has no bundler step

## File-per-domain layout

| File | Contains |
|---|---|
| `contracts/findings.ts` | `Review`, `Finding`, `Severity`, `Verdict`, `FindingKind` |
| `contracts/review-api.ts` | `ReviewRecord`, `FindingRecord`, `ReviewRunResponse` |
| `contracts/trace.ts` | `RunTrace`, `RunEvent`, `PromptAssembly`, `RunLogLine` |
| `contracts/platform.ts` | `Settings`, `Repo`, `PrMeta`, `PrDetail`, `FeatureModelId` |
| `contracts/brief.ts` | `Intent`, `BlastRadius`, `Risks`, `SmartDiff` (L03+) |
| `contracts/knowledge.ts` | `Skill`, `Agent`, `MemoryItem` (L02+) |
| `adapters.ts` | `LLMProvider`, `GitHubClient`, `GitClient`, `Embedder`, `SecretsProvider` |

## See also

- [../../../../AGENTS.md](../../../../AGENTS.md) — root conventions (do-not-touch zone)
