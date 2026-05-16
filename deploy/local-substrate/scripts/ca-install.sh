#!/usr/bin/env bash
# Install the Pebble issuance root into every trust store a developer is
# likely to hit on a Debian/Ubuntu workstation:
#
#   1. System trust store        /usr/local/share/ca-certificates/   (sudo)
#   2. Per-user NSS DB (Chrome)   $HOME/.pki/nssdb/                   (no sudo)
#   3. Each Firefox profile NSS   $HOME/.mozilla/firefox/<prof>/      (no sudo)
#   4. Each Firefox-snap profile  $HOME/snap/firefox/common/...       (no sudo)
#
# Without #2 + #3, Chrome / Firefox refuse the local cert chain and you'll
# see "Your connection is not private" on every .test hostname.
#
# Re-run after `scripts/up.sh` if Pebble's issuance root rotates (it does
# on every Pebble restart).
#
# Usage:
#   sudo bash scripts/ca-install.sh   # all four stores
#        bash scripts/ca-install.sh   # only user NSS DBs (no system trust)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$SUBSTRATE_DIR/caddy/runtime/pebble-issuance-root.pem"
NICK="takos-local-substrate-pebble"
DST_SYSTEM="/usr/local/share/ca-certificates/${NICK}.crt"

if [[ ! -f "$SRC" ]]; then
	echo "Source not found: $SRC" >&2
	echo "Run scripts/up.sh first to start Pebble and capture the root." >&2
	exit 1
fi

# When the original user invoked sudo, prefer their HOME so we install
# NSS DBs against their browser profile, not root's.
TARGET_USER="${SUDO_USER:-$USER}"
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)

as_user() {
	if [[ "$TARGET_USER" != "$USER" ]]; then
		sudo -u "$TARGET_USER" -H "$@"
	else
		"$@"
	fi
}

# ----- 1. System trust (root only) ---------------------------------------
if [[ $EUID -eq 0 ]]; then
	cp "$SRC" "$DST_SYSTEM"
	update-ca-certificates >/dev/null
	echo "==> [system] installed to $DST_SYSTEM"
else
	echo "==> [system] skipped (run with sudo to install to /usr/local/share/ca-certificates)"
fi

# ----- 2. certutil availability -----------------------------------------
if ! command -v certutil >/dev/null 2>&1; then
	if [[ $EUID -eq 0 ]]; then
		echo "==> certutil not found — installing libnss3-tools..."
		apt-get update -qq && apt-get install -y -qq libnss3-tools >/dev/null
	else
		echo "WARN  certutil not found — install with: sudo apt-get install libnss3-tools" >&2
		echo "      (skipping browser NSS install)" >&2
		exit 0
	fi
fi

# Helper: add to or replace the cert in a single NSS DB.
nss_install() {
	local db_dir=$1
	local label=$2
	if [[ ! -d "$db_dir" ]]; then
		# Chromium's per-user DB might not exist until first launch.
		as_user mkdir -p "$db_dir"
		as_user certutil -d "sql:$db_dir" -N --empty-password >/dev/null 2>&1 || true
	fi
	# Delete any existing entry under our nickname so re-runs are idempotent
	# (Pebble's root changes every restart).
	as_user certutil -d "sql:$db_dir" -D -n "$NICK" >/dev/null 2>&1 || true
	as_user certutil -d "sql:$db_dir" -A -n "$NICK" -t "TC,," -i "$SRC"
	echo "==> [$label] installed to $db_dir"
}

# ----- 3. Chromium / Chrome shared NSS DB -------------------------------
nss_install "$TARGET_HOME/.pki/nssdb" "chromium"

# ----- 4. Per-profile Firefox NSS DBs (deb install) ---------------------
ff_root="$TARGET_HOME/.mozilla/firefox"
if [[ -d "$ff_root" ]]; then
	found=0
	while IFS= read -r profile; do
		nss_install "$profile" "firefox/$(basename "$profile")"
		found=$((found + 1))
	done < <(find "$ff_root" -maxdepth 2 -type d -name "*.default*" 2>/dev/null)
	[[ "$found" -gt 0 ]] || echo "==> [firefox] no .default* profile under $ff_root"
else
	echo "==> [firefox] $ff_root not found — skipping"
fi

# ----- 5. Firefox-snap profiles (Ubuntu 22.04+ default install) ---------
ff_snap="$TARGET_HOME/snap/firefox/common/.mozilla/firefox"
if [[ -d "$ff_snap" ]]; then
	found=0
	while IFS= read -r profile; do
		nss_install "$profile" "firefox-snap/$(basename "$profile")"
		found=$((found + 1))
	done < <(find "$ff_snap" -maxdepth 2 -type d -name "*.default*" 2>/dev/null)
	[[ "$found" -gt 0 ]] || echo "==> [firefox-snap] no .default* profile under $ff_snap"
fi

echo
echo "==> Done. Re-run after each scripts/up.sh (Pebble rotates the root)."
echo "    Restart any open Chromium / Firefox windows for the change to take effect."
