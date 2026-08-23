# Insights (root)

Project-wide gotchas and decisions worth knowing before touching more than
one package. Package-specific insights live in each package's own
`Insights.md` (linked from that package's `AGENTS.md`). Section structure
and recording rules: see the `engineering-insights` skill
(`.claude/skills/engineering-insights/SKILL.md`).

## What Works

_None yet._

## What Doesn't Work

_None yet._

## Codebase Patterns

- **`@devdigest/shared` is vendored TWICE, independently, and NOT kept in
  sync automatically.** `server/src/vendor/shared/` and
  `client/src/vendor/shared/` are two separate copies of the same contracts
  (no symlink, no build step, no codegen linking them) — editing a Zod
  schema in one (e.g. `contracts/trace.ts`, `contracts/platform.ts`) does
  NOT change the other. Adding/changing a field used by both server routes
  and client components requires editing both copies by hand, or `client`'s
  `tsc --noEmit` fails with "Property does not exist" / "missing in type"
  against the OTHER copy's shape, even though the server-side change alone
  typechecks cleanly. Always grep both `server/src/vendor/shared/contracts/`
  and `client/src/vendor/shared/contracts/` when touching a shared contract.

## Tool & Library Notes

_None yet._

## Recurring Errors & Fixes

- **Fresh clone won't boot without installing `reviewer-core`'s own deps.**
  `server` imports `reviewer-core`'s TypeScript source directly via a
  tsconfig path alias (never a built package) — if `reviewer-core/node_modules`
  is missing, the API crashes at boot with `ERR_MODULE_NOT_FOUND`.
  `scripts/dev.sh` now installs it automatically; if you bypass the script,
  run `npm ci` inside `reviewer-core/` yourself. Fixed in `66727c8`, `19287e7`.
- **DB migrations are not applied automatically on server boot.** Run
  `pnpm db:migrate` inside `server/` after pulling schema changes.

## Session Notes

_None yet._

## Open Questions

_None yet._
