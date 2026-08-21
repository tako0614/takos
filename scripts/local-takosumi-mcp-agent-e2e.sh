#!/usr/bin/env bash
# Live local-only proof for:
# Git Source -> Capsule apply -> Interface/Binding -> short-lived token ->
# real MCP Streamable HTTP -> same Takos Run toolbox refresh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAKOS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TAKOSUMI_ROOT="${TAKOSUMI_SOURCE_DIR:-$(cd "$TAKOS_ROOT/../takosumi" && pwd)}"
SESSION_FILE="$TAKOSUMI_ROOT/deploy/local-substrate/caddy/runtime/dev-session-id"
CA_FILE="$TAKOSUMI_ROOT/deploy/local-substrate/caddy/runtime/pebble-issuance-root.pem"
SERVICE_WORKER_ENV="$TAKOSUMI_ROOT/deploy/local-substrate/env/takosumi-service-worker.env"

if [[ -z "${TAKOSUMI_E2E_SESSION_ID:-}" ]]; then
	if [[ ! -s "$SESSION_FILE" ]]; then
		echo "No local Takosumi dev session. Run deploy/local-substrate/scripts/up.sh first." >&2
		exit 1
	fi
	TAKOSUMI_E2E_SESSION_ID="$(tr -d '\n' <"$SESSION_FILE")"
fi

if [[ ! -s "$CA_FILE" ]]; then
	echo "Local Takosumi Pebble CA is missing. Run deploy/local-substrate/scripts/up.sh first." >&2
	exit 1
fi

if [[ -z "${TAKOSUMI_E2E_PLATFORM_CLIENT_SECRET:-}" ]]; then
	TAKOSUMI_E2E_PLATFORM_CLIENT_SECRET="$(sed -n 's/^TAKOSUMI_ACCOUNTS_CLIENT_SECRET=//p' "$SERVICE_WORKER_ENV")"
	if [[ -z "$TAKOSUMI_E2E_PLATFORM_CLIENT_SECRET" ]]; then
		echo "Local Takosumi platform OIDC client secret fixture is missing." >&2
		exit 1
	fi
fi

export TAKOSUMI_E2E_SESSION_ID
export TAKOSUMI_E2E_PLATFORM_CLIENT_SECRET
export NODE_EXTRA_CA_CERTS="$CA_FILE"
exec bun "$SCRIPT_DIR/local-takosumi-mcp-agent-e2e.ts"
