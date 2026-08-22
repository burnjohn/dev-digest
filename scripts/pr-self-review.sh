#!/usr/bin/env bash
#
# PR Self Review — runs before push or PR open to catch critical issues early.
#
#   bash scripts/pr-self-review.sh          # compare current branch vs main
#   bash scripts/pr-self-review.sh --staged # review only staged changes
#   bash scripts/pr-self-review.sh --help
#
# Exits 0 (PASSED) or 1 (BLOCKED — critical findings found).
# Saves last report to .pr-review-last-report.yaml (gitignored).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REPORT_FILE="$ROOT/.pr-review-last-report.yaml"
USE_STAGED=0

for arg in "$@"; do
  case "$arg" in
    --staged) USE_STAGED=1 ;;
    -h|--help)
      sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

# --- check claude CLI is available -------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  warn "claude CLI not found — skipping PR self review"
  warn "Install: npm i -g @anthropic-ai/claude-code"
  exit 0
fi

# --- collect diff -------------------------------------------------------------
if [ "$USE_STAGED" -eq 1 ]; then
  log "collecting staged diff..."
  DIFF="$(git diff --staged)"
else
  log "collecting diff vs main..."
  DIFF="$(git diff main...HEAD 2>/dev/null || git diff --staged)"
fi

if [ -z "$DIFF" ]; then
  ok "No changes detected — nothing to review"
  exit 0
fi

CHANGED_LINES="$(echo "$DIFF" | grep -c '^[+-]' || true)"
if [ "$CHANGED_LINES" -lt 5 ]; then
  ok "Diff too small ($CHANGED_LINES lines) — skipping review"
  exit 0
fi

log "diff has ~$CHANGED_LINES changed lines — running PR self review..."

# --- build prompt ------------------------------------------------------------
SKILL_PATH="$ROOT/.claude/skills/pr-self-review"

PROMPT="$(cat <<EOF
You are running the pr-self-review skill. Follow the steps in SKILL.md exactly.

Reference files:
$(cat "$SKILL_PATH/SKILL.md")

---
$(cat "$SKILL_PATH/file-routing.md")

---
$(cat "$SKILL_PATH/finding-model.md")

---
$(cat "$SKILL_PATH/output-format.md")

---
Here is the git diff to review:

\`\`\`diff
$DIFF
\`\`\`

Analyze the diff and produce the YAML report followed by a short human-readable summary.
EOF
)"

# --- run claude --------------------------------------------------------------
log "running Claude analysis..."
RESULT="$(echo "$PROMPT" | claude -p --model claude-sonnet-4-6 2>/dev/null)"

# --- save report artifact ----------------------------------------------------
echo "$RESULT" > "$REPORT_FILE"
log "report saved to .pr-review-last-report.yaml"

# --- parse result ------------------------------------------------------------
echo ""
echo "$RESULT"
echo ""

if echo "$RESULT" | grep -q "status: BLOCKED"; then
  fail "PR Self Review BLOCKED — critical findings detected"
  fail "Fix the issues above before pushing. See full report: .pr-review-last-report.yaml"
  exit 1
else
  ok "PR Self Review PASSED"
  exit 0
fi
