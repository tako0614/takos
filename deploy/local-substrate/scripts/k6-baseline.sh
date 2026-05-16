#!/usr/bin/env bash
# Wrapper that runs k6-baseline.js against local-substrate VIA Caddy + TLS.
# Mounts the Pebble issuance root as the system CA bundle so k6 trusts the
# local cloud.takosumi.test cert; also resolves the hostname through the
# docker network so we don't need /etc/hosts entries inside the container.
#
# Smoke-mode (default): runs both scenarios for ~20s and exits 0 if all
# thresholds (p95 + error rate) pass.
# Interactive-mode: pass --verbose to see the per-scenario summary.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ARGS=(run --quiet /scripts/k6-baseline.js)
[[ "${1:-}" == "--verbose" ]] && ARGS=(run /scripts/k6-baseline.js)

docker run --rm \
	--network local-substrate_takos-local-internal \
	-v "$SCRIPT_DIR:/scripts:ro" \
	-v "$SUBSTRATE_DIR/caddy/runtime:/ca:ro" \
	--add-host cloud.takosumi.test:host-gateway \
	-e SSL_CERT_FILE=/ca/pebble-issuance-root.pem \
	-e K6_CA_CERT_FILE=/ca/pebble-issuance-root.pem \
	grafana/k6:0.55.0 \
	"${ARGS[@]}"
