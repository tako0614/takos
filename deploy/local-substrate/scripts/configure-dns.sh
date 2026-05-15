#!/usr/bin/env bash
# Configure systemd-resolved to send *.takos.test queries to CoreDNS on
# 127.0.0.1:53. Linux native (systemd-resolved) only.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
	echo "Must run as root (sudo bash scripts/configure-dns.sh)" >&2
	exit 1
fi

if ! command -v systemctl >/dev/null; then
	echo "systemctl not found; this script targets systemd-resolved." >&2
	exit 1
fi

CONF=/etc/systemd/resolved.conf.d/takos-local-substrate.conf
mkdir -p "$(dirname "$CONF")"
cat > "$CONF" <<'EOF'
# Managed by takos/deploy/local-substrate/scripts/configure-dns.sh
[Resolve]
DNS=127.0.0.1
Domains=~takos.test ~takosumi.test
EOF

systemctl restart systemd-resolved
echo "==> systemd-resolved configured for *.takos.test → 127.0.0.1"
echo "    Remove $CONF and restart systemd-resolved to revert."
