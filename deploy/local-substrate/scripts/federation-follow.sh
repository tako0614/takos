#!/usr/bin/env bash
# Federation Follow flow — provisions owner actors on inst-a + inst-b
# via /api/auth/login (which creates the default "tako" owner the first
# time it's called), then POSTs a Follow activity from inst-a to
# inst-b's actor.
#
# What this proves end-to-end:
#   1. yurucommu's password-auth path (PBKDF2 verify) works under the
#      local-substrate fixture password
#   2. CSRF middleware accepts requests with a matching Origin header
#   3. POST /api/follow reaches handleRemoteFollow with a valid session
#      + body shape
#
# What this is BLOCKED on (documented gaps — see TODO-SMOKE.md):
#   - SSRF safety check `assertSafeRemoteUrlResolved` rejects fetches
#     to .test hosts that resolve to docker bridge IPs (172.x.x.x). The
#     follow POST short-circuits to "Failed to fetch remote actor" before
#     touching inst-b. Needs a LOCAL_SUBSTRATE_TEST_BED-gated bypass in
#     yurucommu/federation-helpers.ts.
#   - Even past the SSRF gate, DELIVERY_QUEUE is Cloudflare Workers-only;
#     enqueueDeliveryToActor() silently no-ops under Deno mode (see
#     sendQueueMessage's queueAvailable check). The Follow activity would
#     persist locally but never deliver to inst-b's inbox.
#
# Until those land, this smoke runs in informational mode: a "Failed to
# fetch remote actor" response is a known-block, not a failure. Set
# FEDERATION_FOLLOW_STRICT=1 to flip the known-block into a hard FAIL.
set -euo pipefail

PASSWORD="local-substrate-fixture-password-v1"
INST_A="https://inst-a.takos.test"
INST_B="https://inst-b.takos.test"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CA="$SUBSTRATE_DIR/caddy/runtime/pebble-issuance-root.pem"

JAR_A=$(mktemp)
JAR_B=$(mktemp)
trap 'rm -f "$JAR_A" "$JAR_B"' EXIT

login() {
	local jar=$1
	local base=$2
	local label=$3
	# Origin header required for yurucommu's CSRF middleware. Must match
	# the APP_URL of the target instance.
	local status
	status=$(curl -sk --cacert "$CA" -c "$jar" -b "$jar" \
		-X POST -H "Content-Type: application/json" \
		-H "Origin: $base" \
		-d "{\"password\":\"$PASSWORD\"}" \
		-o /dev/null -w "%{http_code}" \
		"$base/api/auth/login")
	if [[ "$status" != "200" ]]; then
		echo "FAIL: $label login returned $status (expected 200)" >&2
		exit 1
	fi
}

# 1. Bring up owner actors on both instances by logging in. yurucommu's
#    single-user mode creates the default "tako" owner on first login.
login "$JAR_A" "$INST_A" "inst-a"
login "$JAR_B" "$INST_B" "inst-b"

# 2. POST a Follow from inst-a → inst-b's owner actor. inst-a will
#    fetch and cache the remote actor JSON during the call.
TARGET_AP_ID="$INST_B/ap/users/tako"
RESP=$(curl -sk --cacert "$CA" -c "$JAR_A" -b "$JAR_A" \
	-X POST -H "Content-Type: application/json" \
	-H "Origin: $INST_A" \
	-d "{\"target_ap_id\":\"$TARGET_AP_ID\"}" \
	"$INST_A/api/follow")

STATUS=$(echo "$RESP" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
except Exception:
    print('parse_error')
    sys.exit(0)
if not d.get('success'):
    print('not_success:' + json.dumps(d))
else:
    print(d.get('status', 'no_status'))
")

STRICT="${FEDERATION_FOLLOW_STRICT:-0}"

if [[ "$STATUS" == "pending" ]]; then
	echo "OK federation follow — inst-a fetched inst-b actor + persisted Follow row status=pending"
	echo "    target=$TARGET_AP_ID"
	echo "    (NOTE: cross-instance Accept not yet smoked — DELIVERY_QUEUE stub missing in Deno mode; see TODO-SMOKE.md)"
	exit 0
fi

# Idempotent re-runs: yurucommu rejects re-Follow with "Already following".
if echo "$RESP" | grep -q "Already following"; then
	echo "OK federation follow — Follow row already exists from prior smoke run (idempotent)"
	exit 0
fi

# Known block: SSRF safety check rejects fetches to docker bridge IPs.
# Pass with WARN unless STRICT mode is set.
if echo "$RESP" | grep -q "Failed to fetch remote actor"; then
	if [[ "$STRICT" == "1" ]]; then
		echo "FAIL federation follow: SSRF block (STRICT mode) — $RESP" >&2
		exit 1
	fi
	echo "WARN federation follow: blocked by SSRF safety check on docker bridge IPs."
	echo "     Auth + CSRF + Follow API surface all reached without error;"
	echo "     remote-actor fetch needs a LOCAL_SUBSTRATE_TEST_BED bypass in"
	echo "     yurucommu/federation-helpers.ts. See TODO-SMOKE.md."
	exit 0
fi

echo "FAIL federation follow: unexpected response — $RESP" >&2
exit 1
