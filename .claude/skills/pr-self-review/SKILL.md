---
name: pr-self-review
description: "Local pre-PR gate for DevDigest. Run before opening or updating a pull request — i.e. before `git push`, `gh pr create`, or `gh pr merge` — or on demand via /pr-self-review. Computes the diff against origin/main, runs cheap deterministic gates (typecheck, tests, and — when configured — lint and dependency-cruiser), then routes the changed files through the project's architecture/quality skills per file bucket (UI vs backend), adversarially verifies every CRITICAL, and BLOCKS the push when any verified CRITICAL remains. Use whenever the user is about to push/open/merge a PR or asks to self-review local changes."
user-invocable: true
version: "1.0.0"
---

# PR Self-Review — local pre-PR gate

Catch problems **before** a pull request exists. This skill is the orchestrator: it does not
contain review knowledge itself — it computes the diff, runs cheap automated checks, then
delegates each changed file to the project's existing architecture/quality skills and turns
their findings into a **merge gate**.

- **What blocks:** one or more *verified* CRITICAL findings (see [gate.md](gate.md)).
- **What never blocks:** HIGH / MEDIUM (reported as warnings), pre-existing code on untouched
  lines, test files (style only), generated/vendor code.

Companion files: **[routing.md](routing.md)** (diff scope + file→skill map), **[gate.md](gate.md)**
(deterministic checks, CRITICAL catalog, state file, escape hatch, suppression).

## When this runs

1. **Automatically** — a `PreToolUse` hook (`scripts/check-gate.sh`, wired in
   `.claude/settings.json`) intercepts `git push` / `gh pr create` / `gh pr merge` and denies
   the command unless a fresh PASS is on record. The hook does **not** run the review; it only
   enforces that one ran and passed for the *current* diff.
2. **Manually** — `/pr-self-review`, or when the user asks to "self-review" / "check my
   changes before the PR". This is the path that actually performs the review and writes the
   state file the hook reads.

## Procedure

Run these in order. Stop early on a hard failure — don't spend tokens reviewing architecture
on a tree that doesn't typecheck.

### 1. Scope the diff
Follow [routing.md](routing.md):
- `BASE = git merge-base origin/main HEAD`.
- Collect **all open changes vs main**: committed-not-merged + staged + unstaged + untracked.
- Reduce to **added/modified lines only**. Drop `*/vendor/shared/**`, `db/migrations/**`,
  lockfiles, `node_modules`, and pure docs (`*.md` with no code).
- If there are no reviewable changes → write a `PASS` state and stop.

### 2. Deterministic gates (cheap, fail-fast)
Per [gate.md](gate.md) §1. For each package that has changed files, run the scripts that
exist (`typecheck`, `test`; plus `lint` and `depcruise` **only if** the package defines them):
- Any non-zero exit → **BLOCKED** immediately. Record which gate failed; skip the LLM passes.
- These are the cheapest, highest-signal checks — they run first by design.

### 3. Route + review (LLM passes, fanned out)
Per [routing.md](routing.md), split changed files into buckets and spawn **one analyzer
subagent per bucket in parallel** (Agent tool). Give each subagent only its file slice + the
skills for that bucket, and require structured findings (`{file, line, severity, skill,
issue, fix}`) — no prose. Reuse the project's existing analyzers where they fit
(`react-architecture-analyzer` for UI, `code-reviewer` for the security/contract pass).

- **UI bucket** → `frontend-architecture`, `react-best-practices`, `next-best-practices`,
  `vercel-react-best-practices`; `react-testing-library` for test files.
- **Backend bucket** → `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`,
  `postgresql-table-design`, `nodejs-best-practices`.
- **Both** → `typescript-expert`, `zod`, `security`, plus the `@devdigest/shared` contract-drift
  check.
- Feed each subagent the touched package's `INSIGHTS.md` as extra review criteria.

For small diffs (≤ ~3 files, single bucket) skip the fan-out and review inline — the subagent
overhead isn't worth it.

### 4. Normalize, verify, gate
Per [gate.md](gate.md) §2–§5:
- Collapse findings to the shared severity scale; drop anything matching a
  `// pr-self-review-ignore:` suppression on the same line.
- **Adversarially verify every CRITICAL** before it can block (one skeptic pass, "try to
  refute this"). A CRITICAL that can't be confirmed is downgraded to HIGH, not dropped
  silently — say so in the report.
- Gate: `verifiedCritical ≥ 1` → **BLOCKED**, else **PASS**.

### 5. Record + report
- Write `.pr-self-review.json` (verdict, `diffHash` from `scripts/diff-hash.sh`, base, head
  sha, counts, findings). This is what the hook reads — the `diffHash` must come from the same
  script the hook uses, so a later edit invalidates the PASS.
- Print a summary grouped by severity, ending with `✅ PASS` or `⛔ BLOCKED — N critical`.
- On BLOCKED, list each critical with file:line and the fix, and remind that
  `PR_SELF_REVIEW_OVERRIDE="reason"` (or `git push --no-verify`) is the documented escape hatch.

## Output contract

The single source of truth is `.pr-self-review.json` at the repo root (git-ignored, per-dev,
local state). The human-readable summary is for the chat; the JSON is for the hook.
