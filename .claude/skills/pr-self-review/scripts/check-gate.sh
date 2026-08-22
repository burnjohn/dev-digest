#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash). Denies git push / gh pr create / gh pr merge unless a fresh
# pr-self-review PASS is on record for the CURRENT diff. It never runs the review itself — it
# only enforces that one ran and passed. Wire it in .claude/settings.json.
#
# Decision model (exit 2 = deny, stderr shown to the agent; exit 0 = allow):
#   - command isn't a push/PR command ............ allow
#   - PR_SELF_REVIEW_OVERRIDE set ................ allow (logged)
#   - no state file .............................. deny  (run /pr-self-review first)
#   - verdict BLOCKED ............................ deny
#   - diff moved since the review (stale) ........ deny
#   - PASS + hash matches ........................ allow
#   - any internal error ......................... allow (fail-open: never brick the workflow)
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
STATE=".pr-self-review.json"

input="$(cat)"
cmd="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.command)||"")}catch{process.stdout.write("")}})' 2>/dev/null || echo "")"

case "$cmd" in
  *"git push"*|*"gh pr create"*|*"gh pr merge"*) ;;
  *) exit 0 ;;
esac

if [ -n "${PR_SELF_REVIEW_OVERRIDE:-}" ]; then
  echo "pr-self-review: overridden — reason: ${PR_SELF_REVIEW_OVERRIDE}" >&2
  exit 0
fi

if [ ! -f "$STATE" ]; then
  echo "⛔ pr-self-review: no review on record for this branch." >&2
  echo "   Run /pr-self-review before pushing or opening a PR (or set PR_SELF_REVIEW_OVERRIDE=\"reason\")." >&2
  exit 2
fi

verdict="$(node -e 'const fs=require("fs");try{process.stdout.write((JSON.parse(fs.readFileSync(process.argv[1],"utf8")).verdict)||"")}catch{process.stdout.write("ERR")}' "$STATE" 2>/dev/null || echo "ERR")"
saved="$(node -e 'const fs=require("fs");try{process.stdout.write((JSON.parse(fs.readFileSync(process.argv[1],"utf8")).diffHash)||"")}catch{process.stdout.write("ERR")}' "$STATE" 2>/dev/null || echo "ERR")"

# Fail-open on unreadable state — a broken hook must never block all pushes.
[ "$verdict" = "ERR" ] && exit 0
[ "$saved" = "ERR" ] && exit 0

if [ "$verdict" = "BLOCKED" ]; then
  echo "⛔ pr-self-review: last review BLOCKED (critical findings). Fix them and re-run /pr-self-review," >&2
  echo "   or set PR_SELF_REVIEW_OVERRIDE=\"reason\" for a genuine hotfix." >&2
  exit 2
fi

current="$("$DIR/diff-hash.sh" 2>/dev/null || echo "ERR")"
[ "$current" = "ERR" ] && exit 0   # can't compute → fail-open

if [ "$saved" != "$current" ]; then
  echo "⛔ pr-self-review: your changes moved since the last review — that PASS is stale." >&2
  echo "   Re-run /pr-self-review so the gate reflects what you're about to push." >&2
  exit 2
fi

exit 0
