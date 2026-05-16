#!/usr/bin/env bash
# Workers-profile smoke for the cloud worker (D1 + workerd code path).
#
# Honest framing: 'workers profile' historically meant 'both the cloud
# worker AND the takosumi kernel run on workerd/D1'. The cloud worker
# ALWAYS runs on workerd (postgres profile or not), so the postgres
# profile already exercises the D1 / workerd code path for accounts-
# service via 17+ smoke checks (cloud.*, oauth.*, install.preview.*,
# passkey.*, stripe.webhook.*, etc.).
#
# The takosumi-kernel itself running on workerd is a separate
# undertaking that requires lazy-init at the module boundary plus a D1
# adapter (currently the kernel imports `npm:pg` at boot and uses a SQL
# migration runner that targets Postgres). That work belongs upstream
# in @takos/takosumi-kernel and is tracked in TODO-SMOKE.md.
#
# What this script verifies: the cloud-worker side of the workers
# profile is healthy. Asserts:
#   1. /healthz returns the workerd-local edge sentinel (proves the
#      worker is running on workerd, not a Deno fallback).
#   2. /v1/install/preview answers (proves env wiring + D1 init still
#      complete from a workers-only stack viewpoint).
#   3. /.well-known/openid-configuration has the right shape.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CA="$SUBSTRATE_DIR/caddy/runtime/pebble-issuance-root.pem"

# 1. workerd-edge sentinel
HEALTH=$(curl -sk --cacert "$CA" https://cloud.takosumi.test/healthz)
echo "$HEALTH" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
assert d.get('provider') == 'cloudflare', f'expected provider=cloudflare, got {d!r}'
assert d.get('persistence') == 'd1', f'expected persistence=d1, got {d!r}'
" || { echo "FAIL: /healthz did not look workerd-local: $HEALTH" >&2; exit 1; }

# 2. install preview (D1 + handler init still working from this stack)
PREVIEW=$(curl -sk --cacert "$CA" -X POST \
	-H "Content-Type: application/json" \
	-d '{"source":{"gitUrl":"https://github.com/tako0614/yurucommu.git","ref":"main"}}' \
	https://cloud.takosumi.test/v1/install/preview)
APP_ID=$(echo "$PREVIEW" | python3 -c "import json,sys;print(json.loads(sys.stdin.read()).get('appId',''))")
[[ -n "$APP_ID" ]] || { echo "FAIL: /v1/install/preview did not return appId: $PREVIEW" >&2; exit 1; }

# 3. OIDC discovery shape
DISC=$(curl -sk --cacert "$CA" https://cloud.takosumi.test/.well-known/openid-configuration)
ISSUER=$(echo "$DISC" | python3 -c "import json,sys;print(json.loads(sys.stdin.read()).get('issuer',''))")
[[ -n "$ISSUER" ]] || { echo "FAIL: /.well-known/openid-configuration missing issuer" >&2; exit 1; }

echo "OK cloud worker (workers / D1 / workerd code path) healthy: appId=$APP_ID issuer=$ISSUER"
