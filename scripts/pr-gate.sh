#!/usr/bin/env bash
#
# PR self-review gate — refuses to open a PR that has not been reviewed clean.
#
#   ./scripts/pr-gate.sh --worktree-hash   # print the hash the verdict must carry
#   ./scripts/pr-gate.sh --check           # check the current state, human output
#   ./scripts/pr-gate.sh --hook            # PreToolUse hook mode (reads JSON on stdin)
#
# A verdict is written by the `pr-self-review` skill to
# .claude/pr-review/<sha>.json and is bound to BOTH the commit sha and a hash of
# the working tree. That binding is the point: a PASS earned on one set of
# changes cannot be spent on another.
#
# Hook mode contract (Claude Code PreToolUse):
#   stdin  = { "tool_name": "Bash", "tool_input": { "command": "..." } }
#   exit 0 = allow, exit 2 = block and feed stderr back to the model.
#
# Escape hatch: PR_SELF_REVIEW_SKIP=1. Mandatory by design — a gate with no
# override is one that gets deleted the first time it is wrong at 23:00.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

REVIEW_DIR=".claude/pr-review"

# Commands that mean "this change is going out". `git push` is deliberately
# absent: pushing a WIP branch is not opening a PR, and blocking it makes the
# gate hostile enough to get bypassed.
#
# Anchored to a command position — start of line, or after a separator — with
# optional `VAR=value` prefixes. An unanchored match also fires on commands that
# merely *mention* the string (`echo "gh pr create"`, a heredoc, this comment),
# which is how the first smoke test blocked itself.
GUARDED_RE='(^|[;&|(]|&&|\|\|)[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*gh[[:space:]]+pr[[:space:]]+(create|ready|merge)'

# The escape hatch has to be recognised in the command TEXT, not just in the
# environment: `PR_SELF_REVIEW_SKIP=1 gh pr create` sets the variable for that
# command only, and the hook runs as a separate process that never sees it.
SKIP_RE='PR_SELF_REVIEW_SKIP=(1|true|yes)'

# ---------------------------------------------------------------------------
# worktree hash — the single definition, shared by the skill and this gate.
# Covers HEAD, tracked modifications (staged + unstaged) and the contents of
# untracked files. --exclude-standard means gitignored paths (server/clones/,
# node_modules/, .claude/pr-review/ itself) are already out.
# ---------------------------------------------------------------------------
worktree_hash() {
  {
    git rev-parse HEAD
    git status --porcelain=v1 -uall
    git diff HEAD
    git diff --cached
    git ls-files --others --exclude-standard -z |
      while IFS= read -r -d '' f; do
        printf '%s\n' "$f"
        [ -f "$f" ] && cat -- "$f"
      done
  } 2>/dev/null | sha256sum | cut -d' ' -f1
}

json_field() {
  # json_field <file> <key> — string field, empty if absent. Node is a stack
  # requirement (>=22), so it is safe to depend on and avoids needing jq.
  node -e '
    const fs = require("fs");
    try {
      const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[process.argv[2]];
      if (v !== undefined && v !== null) process.stdout.write(String(v));
    } catch { /* unreadable or malformed -> empty, caller treats as missing */ }
  ' "$1" "$2" 2>/dev/null
}

criticals() {
  # criticals <file> — one "file:line  title" line per CRITICAL finding.
  node -e '
    const fs = require("fs");
    try {
      const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      for (const f of (r.findings || []).filter(f => f.severity === "CRITICAL")) {
        console.log(`  ${f.file}:${f.start_line}  ${f.title}  [${f.source || "?"}]`);
      }
    } catch {}
  ' "$1" 2>/dev/null
}

# ---------------------------------------------------------------------------
# check — writes the reason to stdout, returns 0 (allow) or 1 (deny)
# ---------------------------------------------------------------------------
check() {
  if [ "${PR_SELF_REVIEW_SKIP:-}" = "1" ]; then
    echo "pr-gate: BYPASSED via PR_SELF_REVIEW_SKIP=1 — changes are going out unreviewed."
    return 0
  fi

  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "pr-gate: not a git repository."
    return 1
  fi

  local sha verdict_file want_hash have_hash verdict schema
  sha="$(git rev-parse HEAD 2>/dev/null)"
  if [ -z "$sha" ]; then
    echo "pr-gate: cannot resolve HEAD."
    return 1
  fi

  verdict_file="$REVIEW_DIR/$sha.json"
  if [ ! -f "$verdict_file" ]; then
    echo "pr-gate: no self-review for HEAD ($(git rev-parse --short HEAD))."
    echo "         Run the pr-self-review skill first."
    return 1
  fi

  schema="$(json_field "$verdict_file" schema)"
  if [ "$schema" != "1" ]; then
    echo "pr-gate: $verdict_file is malformed or has an unsupported schema ('${schema:-none}')."
    echo "         Re-run the pr-self-review skill."
    return 1
  fi

  want_hash="$(json_field "$verdict_file" worktree_hash)"
  have_hash="$(worktree_hash)"
  if [ "$want_hash" != "$have_hash" ]; then
    echo "pr-gate: the working tree changed after the last self-review — verdict is stale."
    echo "         Re-run the pr-self-review skill."
    return 1
  fi

  verdict="$(json_field "$verdict_file" verdict)"
  if [ "$verdict" = "PASS" ]; then
    echo "pr-gate: PASS ($(git rev-parse --short HEAD))."
    return 0
  fi

  echo "pr-gate: BLOCKED — self-review found critical findings:"
  criticals "$verdict_file"
  echo "         Fix them and re-run pr-self-review, or override with PR_SELF_REVIEW_SKIP=1."
  return 1
}

# ---------------------------------------------------------------------------
# modes
# ---------------------------------------------------------------------------
case "${1:---check}" in
  --worktree-hash)
    worktree_hash
    ;;

  --check)
    out="$(check)"; rc=$?
    echo "$out"
    exit $rc
    ;;

  --hook)
    # Any failure to parse input must ALLOW: a broken gate that blocks every
    # Bash call is far worse than one that misses a PR.
    cmd="$(node -e '
      let raw = "";
      process.stdin.on("data", c => raw += c);
      process.stdin.on("end", () => {
        try {
          const j = JSON.parse(raw);
          process.stdout.write(String(j?.tool_input?.command ?? ""));
        } catch {}
      });
    ' 2>/dev/null)"

    [ -z "$cmd" ] && exit 0
    printf '%s\n' "$cmd" | grep -Eq "$GUARDED_RE" || exit 0

    # An inline skip prefix counts as a bypass — loudly, never silently.
    if printf '%s\n' "$cmd" | grep -Eq "$SKIP_RE"; then
      echo "pr-gate: BYPASSED via PR_SELF_REVIEW_SKIP — changes are going out unreviewed." >&2
      exit 0
    fi

    out="$(check)"; rc=$?
    if [ $rc -eq 0 ]; then
      [ "${PR_SELF_REVIEW_SKIP:-}" = "1" ] && echo "$out" >&2
      exit 0
    fi
    echo "$out" >&2
    exit 2
    ;;

  -h | --help)
    sed -n '2,20p' "${BASH_SOURCE[0]}"
    ;;

  *)
    echo "usage: $0 [--check | --hook | --worktree-hash]" >&2
    exit 2
    ;;
esac
