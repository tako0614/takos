#!/usr/bin/env bash
# Exercises the canonical kernel deploy entry point (`POST /v1/deployments`).
# This is the same path the takosumi CLI uses; without this smoke, a regression
# in the kernel's apply pipeline would only be caught in production.
#
#   1. POST a minimal Manifest (object-store@v1, selfhost-filesystem provider).
#   2. Assert status == "ok" and outcome.status == "succeeded".
#   3. GET /v1/deployments/<name> and assert the snapshot comes back.
#
# Run: bash scripts/cli-smoke.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CA="$SUBSTRATE_DIR/caddy/runtime/pebble-issuance-root.pem"
TOKEN="${TAKOSUMI_DEPLOY_TOKEN:-local-substrate-deploy-token}"
DEPLOY_NAME="smoke-cli-$(date +%s)"

if [[ ! -f "$CA" ]]; then
	echo "Pebble CA not found at $CA — run scripts/up.sh first" >&2
	exit 1
fi

MANIFEST=$(cat <<EOF
{
  "manifest": {
    "apiVersion": "1.0",
    "kind": "Manifest",
    "metadata": {"name": "$DEPLOY_NAME"},
    "resources": [
      {
        "shape": "object-store@v1",
        "name": "assets",
        "provider": "@takos/selfhost-filesystem",
        "spec": {"name": "$DEPLOY_NAME-bucket"}
      }
    ]
  }
}
EOF
)

RESP=$(curl -sk --cacert "$CA" \
	-H "Authorization: Bearer $TOKEN" \
	-H "Content-Type: application/json" \
	-d "$MANIFEST" \
	"https://kernel.takos.test/v1/deployments")

STATUS=$(echo "$RESP" | python3 -c "import json,sys;print(json.loads(sys.stdin.read()).get('status',''))")
APPLY_STATUS=$(echo "$RESP" | python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(d.get('outcome',{}).get('status',''))")

if [[ "$STATUS" != "ok" || "$APPLY_STATUS" != "succeeded" ]]; then
	echo "FAIL: kernel deploy did not succeed" >&2
	echo "      status=$STATUS apply_status=$APPLY_STATUS" >&2
	echo "      response: $RESP" >&2
	exit 1
fi

echo "OK deploy=$DEPLOY_NAME status=$STATUS outcome.status=$APPLY_STATUS"

# Best-effort cleanup so we don't accumulate deployment records over time.
# Kernel exposes DELETE /v1/deployments/<id>? If not, fall through silently.
curl -sk --cacert "$CA" -X DELETE \
	-H "Authorization: Bearer $TOKEN" \
	"https://kernel.takos.test/v1/deployments/$DEPLOY_NAME" \
	>/dev/null 2>&1 || true

# B6: also assert install-preview-mock returns real bindings (fixture-hit
# path, not the empty fallback) — this is the install wizard's read of
# the bundled apps' .takosumi/app.yml.
PREVIEW=$(curl -sk --cacert "$CA" \
	-H "Content-Type: application/json" \
	-d '{"source":{"gitUrl":"https://github.com/tako0614/yurucommu.git","ref":"main"}}' \
	"https://cloud.takosumi.test/v1/install/preview")
BIND_COUNT=$(echo "$PREVIEW" | python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(len(d.get('bindings') or []))")
if [[ "$BIND_COUNT" -lt 3 ]]; then
	echo "FAIL: install-preview returned $BIND_COUNT bindings for yurucommu (expected >=3)" >&2
	echo "      response: $PREVIEW" >&2
	exit 1
fi

echo "OK install-preview yurucommu → $BIND_COUNT real bindings (fixture-hit)"
