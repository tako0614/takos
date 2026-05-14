#!/usr/bin/env bash
# Tear down both substrate and ingress. Pass -v to also remove volumes.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SUBSTRATE_DIR"

docker compose -f compose.substrate.yml --profile postgres --profile workers down "$@" 2>/dev/null || true
docker compose -f compose.ingress.yml down "$@"
