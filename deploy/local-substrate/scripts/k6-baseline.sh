#!/usr/bin/env bash
# Wrapper that runs the k6-baseline.js scenario against the local-substrate
# from inside the docker network (no TLS / cert friction).
#
# Smoke-mode (default): runs the 2 scenarios for ~20s and exits 0 if both
# thresholds (p95 + error rate) pass. Run as `bash scripts/k6-baseline.sh`.
#
# Interactive-mode: pass --verbose to see the per-scenario summary.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ARGS=(run --quiet /scripts/k6-baseline.js)
[[ "${1:-}" == "--verbose" ]] && ARGS=(run /scripts/k6-baseline.js)

docker run --rm \
	--network local-substrate_takos-local-internal \
	-v "$SCRIPT_DIR:/scripts:ro" \
	grafana/k6:0.55.0 \
	"${ARGS[@]}"
