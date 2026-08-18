#!/usr/bin/env bash
#
# Contract sync gate — server/src/vendor/shared is canonical.
#
#   ./scripts/check-contracts.sh          # fail if the two copies differ
#   ./scripts/check-contracts.sh --fix    # copy server → client, then re-check
#
# `@devdigest/shared` is vendored twice, once per package, with no build step
# between them (see root INSIGHTS.md, "Standalone packages instead of a
# workspace"). Each package typechecks against its own copy, so a schema edited
# on one side and forgotten on the other compiles green in both and only fails
# in the browser. This script is the thing that notices.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVER="server/src/vendor/shared"
CLIENT="client/src/vendor/shared"

if [[ "${1:-}" == "--fix" ]]; then
  echo "==> syncing $SERVER → $CLIENT"
  rm -rf "$CLIENT"
  cp -a "$SERVER" "$CLIENT"
  echo "    done. Run 'cd client && pnpm typecheck' — new fields may widen unions."
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--fix]" >&2
  exit 2
fi

if diff -ru "$SERVER" "$CLIENT"; then
  echo "==> contracts in sync"
  exit 0
fi

cat >&2 <<'EOF'

==> CONTRACT DRIFT: the two vendored copies of @devdigest/shared disagree.

Server is canonical (root CLAUDE.md: "Contracts change in @devdigest/shared
first, then in consumers"). To adopt the server side:

    ./scripts/check-contracts.sh --fix
    cd client && pnpm typecheck

EOF
exit 1
