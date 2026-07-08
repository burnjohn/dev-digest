#!/usr/bin/env bash
# Start/stop the LiteLLM translating proxy that lets the eval TOOL tiers (agentTask / workflowTask)
# run on cheap non-Anthropic OpenRouter models. See evals/proxy/litellm.config.yaml for the why.
#
# Usage:
#   scripts/litellm-proxy.sh up      # start, wait until it answers, print the export line
#   scripts/litellm-proxy.sh down    # stop and remove the container
#   scripts/litellm-proxy.sh wait    # block until the running proxy is healthy (CI helper)
#
# The OpenRouter key is taken from $OPENROUTER_API_KEY, or read from ~/.devdigest/secrets.json.

set -euo pipefail

PROXY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../proxy" && pwd)"
COMPOSE=(docker compose -f "$PROXY_DIR/docker-compose.yml")
PORT="${LITELLM_PORT:-4000}"
URL="http://localhost:${PORT}"

load_key() {
  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    local secrets="$HOME/.devdigest/secrets.json"
    if [[ -f "$secrets" ]]; then
      OPENROUTER_API_KEY="$(node -e 'process.stdout.write((require(process.argv[1]).OPENROUTER_API_KEY)||"")' "$secrets" 2>/dev/null || true)"
    fi
  fi
  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    echo "error: OPENROUTER_API_KEY not set and not found in ~/.devdigest/secrets.json" >&2
    exit 1
  fi
  export OPENROUTER_API_KEY
}

wait_healthy() {
  echo "waiting for LiteLLM proxy at ${URL} ..." >&2
  for _ in $(seq 1 60); do
    if curl -fsS "${URL}/health/liveliness" >/dev/null 2>&1; then
      echo "proxy is up: ${URL}" >&2
      return 0
    fi
    sleep 2
  done
  echo "error: proxy did not become healthy at ${URL}" >&2
  "${COMPOSE[@]}" logs --tail 40 >&2 || true
  exit 1
}

case "${1:-up}" in
  up)
    load_key
    "${COMPOSE[@]}" up -d
    wait_healthy
    cat >&2 <<EOF

Proxy ready. To route every eval tier through it:

  export EVAL_BACKEND=openrouter
  export OPENROUTER_BASE_URL=${URL}
  export OPENROUTER_API_KEY=<your key>   # also used by the proxy container
  export EVAL_MODEL=google/gemini-2.5-flash        # cheap model that survives the tool tiers
  export EVAL_JUDGE_MODEL=google/gemini-2.5-flash
  pnpm eval:workflow

Stop it with: scripts/litellm-proxy.sh down
EOF
    ;;
  down)
    # compose interpolates the env block even on `down`, so the var must be present (value unused).
    OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-unused}" "${COMPOSE[@]}" down
    ;;
  wait)
    wait_healthy
    ;;
  *)
    echo "usage: $0 {up|down|wait}" >&2
    exit 2
    ;;
esac
