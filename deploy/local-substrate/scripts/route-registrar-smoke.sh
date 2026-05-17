#!/usr/bin/env bash
# Verifies the Phase-3 route-registrar wiring is intact:
#
#   1. The route-registrar container is running.
#   2. Its tick loop is producing 'synced N dynamic' log lines (proves both
#      the kernel API call and the Caddy admin PATCH are succeeding).
#   3. Caddy admin srv0/routes is reachable and returns the expected count
#      of static routes (proves the partition strategy isn't accidentally
#      dropping Caddyfile-owned routes).
#
# Note: this does NOT exercise an actual <id>.app.takos.test route, because
# the dynamic route count is normally 0 until a manifest with desired.routes
# is applied (today that requires a web-service@v1 deploy that spawns a real
# container). Adding that round-trip is on the P3+ TODO; this smoke is the
# 'pipeline alive' guard.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. Container running
state=$(docker inspect -f '{{.State.Status}}' local-substrate-route-registrar-1 2>/dev/null || echo "missing")
if [[ "$state" != "running" ]]; then
	echo "FAIL: route-registrar container is not running (state=$state)" >&2
	exit 1
fi

# 2. Recent tick log
if ! docker logs --since 30s local-substrate-route-registrar-1 2>&1 \
		| grep -q "synced .* dynamic route"; then
	echo "FAIL: no 'synced N dynamic' log line in the last 30s" >&2
	docker logs --tail 5 local-substrate-route-registrar-1 >&2
	exit 1
fi

# 3. Caddy admin reachable + static routes preserved.
# Static routes are owned by the Caddyfile; the registrar must never drop
# them. We count routes with at least one host whose suffix is NOT
# '.app.takos.test' as static.
# The Caddy admin API is intentionally NOT exposed to the host (δ23) — exec
# into the caddy container to talk to it via the docker network instead.
STATIC_COUNT=$(docker exec local-substrate-caddy-1 \
	wget -qO- http://localhost:2019/config/apps/http/servers/srv0/routes 2>/dev/null \
	| python3 -c '
import json, sys
routes = json.load(sys.stdin) or []
def hosts(r): return sum((m.get("host") or [] for m in (r.get("match") or [])), [])
static = [r for r in routes if not any(h.endswith(".app.takos.test") and h != "app.takos.test" for h in hosts(r))]
print(len(static))
')
if [[ -z "$STATIC_COUNT" || "$STATIC_COUNT" -lt 6 ]]; then
	echo "FAIL: Caddy admin returned $STATIC_COUNT static routes (expected ≥6)" >&2
	exit 1
fi

echo "OK route-registrar running + ticking; ${STATIC_COUNT} static route(s) preserved"
