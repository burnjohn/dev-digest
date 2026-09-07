#!/bin/bash
# PreToolUse hook for pr-self-review (docs/pr-self-review-plan.md §2, build order
# step 8). Registered on Bash in .claude/settings.json; this script does the
# narrowing itself (matcher there is "Bash", not the command text).
#
# This is a GUARANTEED, deterministic version of pr-self-review's Phase 1 only —
# it cannot run the skill's own LLM-judged Phase 3-6 findings, and doesn't try to.
# The skill (manual or /pr-self-review) is still the richer, advisory review;
# this hook is the fast local backstop that fires on every push whether or not
# anyone remembered to run the skill first.
#
# Exit 0 = allow (stdout shown in the transcript). Exit 2 = block (stderr fed
# back to Claude) — see the hook-development skill / Claude Code docs for the
# PreToolUse contract this follows.
set -uo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty')

# Not a push/PR-open command — nothing for this gate to do.
if [[ "$command" != *"git push"* ]] && [[ "$command" != *"gh pr create"* ]]; then
  exit 0
fi

# The escape hatch pr-self-review's own SKILL.md already documents
# ("Suppression" section) — a silent bypass would be worse than no gate, so
# this still exits via stdout (shown in the transcript), not silently.
if [[ "${PR_SELF_REVIEW:-}" == "0" ]]; then
  echo "pre-push-gate: skipped (PR_SELF_REVIEW=0)"
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0 # can't locate the repo — don't block on that basis

branch=$(git branch --show-current 2>/dev/null)
if [[ -z "$branch" || "$branch" == "main" || "$branch" == "master" ]]; then
  exit 0 # pushing to/from main is a different problem; branch protection covers it
fi

# A no-op push (nothing new relative to the already-pushed upstream) has
# nothing to check.
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  if git diff --quiet '@{u}' 2>/dev/null; then
    exit 0
  fi
fi

touched=$(git diff --name-only main...HEAD 2>/dev/null)
if [[ -z "$touched" ]]; then
  exit 0 # nothing reviewable on this branch yet
fi

failures=""

run_check() {
  local label="$1" dir="$2" cmd="$3"
  local log
  log=$(mktemp)
  (cd "$PROJECT_DIR/$dir" && eval "$cmd") >"$log" 2>&1
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    failures+=$'\n'"--- $label (in $dir) FAILED ---"$'\n'"$(tail -40 "$log")"
  fi
  rm -f "$log"
}

if echo "$touched" | grep -q '^server/'; then
  run_check "pnpm typecheck" "server" "pnpm typecheck"
  run_check "pnpm arch" "server" "pnpm arch"
  run_check "pnpm exec vitest run (excluding *.it.test.ts)" "server" "pnpm exec vitest run --exclude '**/*.it.test.ts'"
fi

if echo "$touched" | grep -q '^client/'; then
  run_check "pnpm typecheck" "client" "pnpm typecheck"
  run_check "pnpm test" "client" "pnpm test"
fi

if echo "$touched" | grep -q '^reviewer-core/'; then
  run_check "npm run typecheck && npm test" "reviewer-core" "npm run typecheck && npm test"
fi

if [[ -n "$failures" ]]; then
  {
    echo "pre-push-gate: BLOCKED — deterministic check(s) failed for this push."
    echo "$failures"
    echo ""
    echo "Fix the failure(s) above, or PR_SELF_REVIEW=0 git push to bypass (loudly, not silently)."
  } >&2
  exit 2
fi

echo "pre-push-gate: deterministic checks passed for $(echo "$touched" | wc -l | tr -d ' ') touched file(s)."
exit 0
