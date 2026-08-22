# Gate — checks, severity, state, escape hatch

The logic that turns findings into a PASS/BLOCKED verdict. Read with [SKILL.md](SKILL.md)
(procedure) and [routing.md](routing.md) (scope + skill map).

## 1. Deterministic gates (run before any LLM pass)

Cheapest, highest-signal, no tokens. Run **per package that has changed files**, in this
order; the first non-zero exit → **BLOCKED**, skip the rest.

| Order | Gate | Command (per package) | Condition |
|-------|------|------------------------|-----------|
| 1 | Typecheck | `npm run typecheck` | always (every package defines it) |
| 2 | Lint | `npm run lint` | **only if** the package defines a `lint` script |
| 3 | Arch graph | `npm run depcruise` (in `server/`) | **only if** `server/.dependency-cruiser.cjs` exists |
| 4 | Tests | `npm run test` | always |

Notes grounded in this repo (verify before relying on them — scripts change):
- No package currently defines a `lint` script → step 2 is skipped today. If one is added, it
  runs automatically.
- `depcruise` is **not yet wired** (`server/.dependency-cruiser.cjs` absent). The
  `onion-architecture` skill ships the config + scripts; once added, this gate enforces the
  inward-only dependency rule for free and a new `error`-level edge becomes a hard fail.
- `reviewer-core` test script passes with no tests (`--passWithNoTests`); that is not a failure.

## 2. Severity scale (normalize every skill onto this)

| Level | Means | Effect |
|-------|-------|--------|
| **CRITICAL** | Bug, broken contract, or architecture violation | **Blocks** (after verification) |
| **HIGH** | Perf / scaling / maintainability risk | Warn |
| **MEDIUM** | DX / style | Warn |

Map the source skills' own scales:
- `react-best-practices` CRITICAL → CRITICAL; HIGH → HIGH; MEDIUM → MEDIUM.
- `security` HIGH-confidence finding → CRITICAL; MEDIUM-confidence → HIGH; LOW → drop (it tells
  you not to report LOW).
- `onion-architecture` / dependency-cruiser `error` rule → CRITICAL; `warn` rule → HIGH.

## 3. Closed CRITICAL catalog (only these block)

The gate is predictable on purpose: a finding blocks **only** if it matches this list.
Anything else is at most HIGH, no matter how a skill labels it.

**Backend**
- Onion dependency-rule violation flagged `error` (e.g. I/O in `reviewer-core`; a service
  importing a concrete adapter; a route reaching into `src/adapters/`).
- `@devdigest/shared` contract drift between the client and server vendored copies
  ([routing.md](routing.md) §4).
- Unvalidated external input crossing a trust boundary (security HIGH-confidence: route body
  /query used without a Zod parse; injection; auth check missing/fail-open).

**UI**
- Derive-don't-store violation (storing state that should be derived).
- Impure component / side effect during render.
- Hook rules violation (conditional/looped hook call, wrong dependency array causing stale or
  infinite loops).

**Both**
- A type error or failing test surfaced by §1 (already blocks deterministically).
- Secret / credential committed in the diff.

## 4. Adversarial verification (no false-positive blocks)

Before any CRITICAL blocks, run **one skeptic pass**: "Try to refute this finding. Is the
input really attacker-controlled / is this really on a changed line / does this really violate
the rule? Default to refuted if uncertain." A CRITICAL that survives → blocks. One that is
refuted → **downgraded to HIGH and reported as downgraded** (never dropped silently). One bad
block trains the team to bypass the gate, so this step is mandatory.

## 5. Suppression (acknowledged findings)

A finding is dropped if the **same line** carries:

```ts
// pr-self-review-ignore: <reason>
```

The reason is required and is echoed in the report ("3 findings suppressed"), so suppressions
stay visible and auditable rather than silent.

## 6. State file + escape hatch

### State — `.pr-self-review.json` (repo root, git-ignored)
Written at the end of every run; read by the `PreToolUse` hook.

```jsonc
{
  "verdict": "PASS",                 // or "BLOCKED"
  "diffHash": "<scripts/diff-hash.sh output>",
  "base": "origin/main",
  "headSha": "<git rev-parse HEAD>",
  "criticalCount": 0,
  "highCount": 2,
  "suppressedCount": 1,
  "ranAt": "<ISO-8601>",
  "findings": [ { "file": "", "line": 0, "severity": "", "skill": "", "issue": "", "fix": "" } ]
}
```

The hook recomputes the diff hash with the **same script** and compares: a missing file, a
`BLOCKED` verdict, or a hash mismatch (the diff moved since the review) all deny the push.

### Escape hatch (documented, audited)
Every blocking gate needs a way out or it gets deleted:
- `PR_SELF_REVIEW_OVERRIDE="why"` — the hook allows the command and logs the reason to stderr.
- `git push --no-verify` — bypasses git's own hooks (the Claude `PreToolUse` hook still runs;
  use the env var for that path).

Use sparingly — for genuine hotfixes — and put the reason in the PR description.
