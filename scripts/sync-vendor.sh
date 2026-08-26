#!/usr/bin/env bash
#
# Sync the vendored @devdigest/shared contracts from the canonical copy.
#
#   ./scripts/sync-vendor.sh          # copy server → client
#   ./scripts/sync-vendor.sh --check  # exit 1 if they differ (CI)
#
# WHY A COPY AT ALL: these are five standalone packages, not a workspace — the
# client's build root is `client/`, so it cannot reach across into `server/src`.
# It therefore vendors its own copy, and this script keeps the two byte-identical.
#
# DO NOT strip the `./contracts/*.js` extensions from the client copy to make
# webpack happy: this script overwrites that tree wholesale and `--check` diffs
# it byte-for-byte, so the edit would be reverted and CI parity would break.
# `experimental.extensionAlias` in client/next.config.mjs is what teaches Next's
# webpack the `.js` → `.ts` mapping; runtime VALUE imports of the barrel work.
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
