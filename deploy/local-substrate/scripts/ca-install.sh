#!/usr/bin/env bash
# Install Pebble issuance root into the host trust store (Debian/Ubuntu).
# Pebble regenerates this root on every restart, so re-run after up.sh
# brings Pebble back up if you've torn down the stack.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
	echo "Must run as root (sudo bash scripts/ca-install.sh)" >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$SUBSTRATE_DIR/caddy/runtime/pebble-issuance-root.pem"
DST="/usr/local/share/ca-certificates/takos-local-substrate-pebble.crt"

if [[ ! -f "$SRC" ]]; then
	echo "Source not found: $SRC" >&2
	echo "Run scripts/up.sh first to start Pebble and capture the root." >&2
	exit 1
fi

cp "$SRC" "$DST"
update-ca-certificates

echo "==> Installed Pebble issuance root to $DST"
echo "    If Pebble is restarted, the issuance root regenerates."
echo "    Re-run scripts/up.sh then sudo scripts/ca-install.sh to refresh."
