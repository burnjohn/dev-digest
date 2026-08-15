#!/usr/bin/env bash
#
# Sync the vendored @devdigest/shared contracts from the canonical copy.
#
#   ./scripts/sync-vendor.sh          # copy server → client
#   ./scripts/sync-vendor.sh --check  # exit 1 if they differ (CI)
#
# WHY A COPY AT ALL: the client cannot import the server's tree directly —
# importing a runtime VALUE pulls `vendor/shared/index.ts` into the webpack
# bundle, whose `./contracts/*.js` re-exports Next's webpack can't resolve
# (see the note in client/src/lib/feature-models.ts). So the client vendors
# its own copy, and this script keeps the two byte-identical.
#
# `server/src/vendor/shared` is the ONE canonical copy — edit contracts there,
# then run this script. Never hand-edit client/src/vendor/shared.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SRC="server/src/vendor/shared"
DST="client/src/vendor/shared"

if [[ "${1:-}" == "--check" ]]; then
  if diff -r "$SRC" "$DST" >/dev/null 2>&1; then
    echo "✓ vendored contracts are in sync"
    exit 0
  fi
  echo "✗ vendored contracts have drifted:"
  diff -r "$SRC" "$DST" || true
  echo
  echo "Fix with: ./scripts/sync-vendor.sh   (server is canonical)"
  exit 1
fi

rm -rf "$DST"
cp -r "$SRC" "$DST"
echo "✓ synced $SRC → $DST"
