#!/usr/bin/env bash
#
# DevDigest hermetic e2e — run the browser flows against a fully isolated,
# freshly-seeded stack on ALTERNATE ports, so it never touches your dev DB and
# can run alongside a dev stack that's already up.
#
#   ./scripts/e2e.sh
#   E2E_PG_PORT=5440 E2E_API_PORT=3201 E2E_WEB_PORT=3200 ./scripts/e2e.sh
#
# Mirrors what .github/workflows/e2e-web.yml does, but with an ephemeral
# Postgres (no persistent volume → empty every run, so the seeded demo repo
# acme/payments-api is the ONLY repo and the home redirect lands on it).
#
# Exits with the e2e run's status. On success, failure, or Ctrl-C it tears down
# the API/web child processes AND removes the isolated Postgres container.
#
# NOTE: this is a LOCAL convenience. CI brings up its own stack and calls the
# pure runner (`cd e2e && npm test`) directly — this script is not used in CI.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- config (all overridable; defaults dodge the dev stack on 5432/3000/3001) ---
PG_CONTAINER="${E2E_PG_CONTAINER:-devdigest-e2e-postgres}"
PG_PORT="${E2E_PG_PORT:-5433}"
PG_IMAGE="${E2E_PG_IMAGE:-pgvector/pgvector:pg16}"
PG_DB="${E2E_PG_DB:-devdigest}"
PG_USER="${E2E_PG_USER:-devdigest}"
PG_PASS="${E2E_PG_PASS:-devdigest}"
API_PORT="${E2E_API_PORT:-3101}"
WEB_PORT="${E2E_WEB_PORT:-3100}"

# Exported BEFORE any tsx/next spawn. dotenv (used by migrate/seed/config) does
# not override already-set env, so these win over server/.env's :5432 / :3001
# without touching the file. WEB_PORT must be exported too: the API derives its
# CORS allow-origin (config.webOrigin) from it. 127.0.0.1 (not localhost) avoids
# an IPv6 ::1 vs published-IPv4 mismatch against the container.
export DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}"
export API_PORT WEB_PORT
export NEXT_PUBLIC_API_BASE="http://localhost:${API_PORT}"
export E2E_BASE_URL="http://localhost:${WEB_PORT}"
# Isolated Next build dir (client/next.config.mjs reads NEXT_DIST_DIR): without
# it, this stack compiles ITS NEXT_PUBLIC_API_BASE into the shared client/.next
# and silently poisons a concurrently running dev server on :3000.
export NEXT_DIST_DIR=".next-e2e"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# --- prerequisites -----------------------------------------------------------
command -v docker >/dev/null || { echo "docker not found"; exit 1; }
command -v pnpm   >/dev/null || { echo "pnpm not found (npm i -g pnpm)"; exit 1; }
command -v agent-browser >/dev/null || \
  warn "agent-browser not found — install once: npm i -g agent-browser && agent-browser install"

# --- teardown trap (installed before we start anything) ----------------------
SERVER_PID=""
WEB_PID=""
# Recursively kill a process and all its descendants. `pnpm exec tsx` / `next dev`
# spawn the real listener as a GRANDCHILD, so a plain `kill $PID` + `pkill -P`
# leaves it orphaned (port stays bound). Walk the tree leaves-first instead.
kill_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  local kid
  for kid in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$kid"; done
  kill "$pid" 2>/dev/null || true
}
cleanup() {
  local code=$?
  log "tearing down hermetic e2e stack"
  kill_tree "$WEB_PID"
  kill_tree "$SERVER_PID"
  # Backstop: reap whatever still holds the ISOLATED ports (never the dev stack's
  # 3000/3001 — only the alt ports this script started).
  for port in "$WEB_PORT" "$API_PORT"; do
    local pids
    pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  # The isolated build dir has this run's NEXT_PUBLIC_API_BASE compiled in; a
  # later run may use different ports, so don't let a stale compile linger.
  rm -rf "$ROOT/client/.next-e2e"
  # Next rewrites next-env.d.ts's routes.d.ts reference to the ACTIVE distDir,
  # so an e2e run dirties the committed file with ".next-e2e/types". Restore
  # the default so e2e never leaves a git-visible change behind. perl, not
  # sed -i: BSD and GNU sed disagree on -i's argument and the GNU failure
  # would be swallowed silently.
  perl -pi -e 's|\./\.next-e2e/types/routes\.d\.ts|./.next/types/routes.d.ts|' \
    "$ROOT/client/next-env.d.ts" 2>/dev/null || true
  exit "$code"
}
trap cleanup EXIT INT TERM

# --- fresh isolated Postgres (ephemeral: --rm, no named volume) --------------
log "starting isolated Postgres '$PG_CONTAINER' on :$PG_PORT (ephemeral)"
docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
docker run -d --rm --name "$PG_CONTAINER" \
  -e POSTGRES_USER="$PG_USER" \
  -e POSTGRES_PASSWORD="$PG_PASS" \
  -e POSTGRES_DB="$PG_DB" \
  -p "${PG_PORT}:5432" \
  --health-cmd="pg_isready -U $PG_USER -d $PG_DB" \
  --health-interval=5s --health-timeout=5s --health-retries=10 \
  "$PG_IMAGE" >/dev/null

log "waiting for Postgres to be healthy"
status="starting"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$PG_CONTAINER" 2>/dev/null || echo "starting")"
  [ "$status" = "healthy" ] && break
  sleep 1
done
[ "$status" = "healthy" ] || { echo "isolated Postgres did not become healthy in time"; exit 1; }
log "Postgres healthy"

# --- install deps (only if missing) ------------------------------------------
install_if_needed() {
  if [ ! -d "$1/node_modules" ]; then
    log "installing deps in $1"
    (cd "$1" && pnpm install)
  fi
}
install_if_needed server
install_if_needed client
# reviewer-core's RAW source is imported by the API at runtime (tsconfig alias);
# without its deps the API crashes at boot with ERR_MODULE_NOT_FOUND. It uses npm.
[ -d reviewer-core/node_modules ] || { log "installing deps in reviewer-core"; (cd reviewer-core && npm ci); }

# --- migrate + seed the ISOLATED db ------------------------------------------
# Hard guard: never let migrate/seed run against anything but the isolated port.
case "$DATABASE_URL" in
  *":${PG_PORT}/"*) : ;;
  *) echo "refusing: DATABASE_URL is not on :$PG_PORT ($DATABASE_URL)"; exit 1 ;;
esac
log "applying migrations (isolated db)"
(cd server && pnpm db:migrate)
log "seeding demo data (isolated db)"
(cd server && pnpm db:seed)

# --- API on :$API_PORT -------------------------------------------------------
# tsx directly (not `pnpm start`, which needs a build; not `tsx watch`, to avoid
# a mid-suite watcher restart).
log "starting API on :$API_PORT"
(cd server && pnpm exec tsx src/server.ts) &
SERVER_PID=$!
log "waiting for API /health"
api_up=0
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:${API_PORT}/health" >/dev/null 2>&1 && { api_up=1; break; }
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "API process exited before becoming healthy"; exit 1; }
  sleep 1
done
[ "$api_up" -eq 1 ] || { echo "API never became healthy on :$API_PORT"; exit 1; }
log "API healthy"

# --- web on :$WEB_PORT (next dev → reads NEXT_PUBLIC_API_BASE from env) -------
log "starting web on :$WEB_PORT"
(cd client && pnpm exec next dev -p "$WEB_PORT") &
WEB_PID=$!
log "waiting for web :$WEB_PORT"
web_up=0
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:${WEB_PORT}" >/dev/null 2>&1 && { web_up=1; break; }
  kill -0 "$WEB_PID" 2>/dev/null || { echo "web process exited before becoming reachable"; exit 1; }
  sleep 1
done
[ "$web_up" -eq 1 ] || { echo "web never became reachable on :$WEB_PORT"; exit 1; }
log "web up"

# --- run the flows; propagate the exit code through the trap -----------------
log "running e2e flows against $E2E_BASE_URL"
set +e
(cd e2e && npm test)
E2E_CODE=$?
set -e
exit "$E2E_CODE"
