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
#   4. inst-a delivers Follow to inst-b, inst-b emits Accept, and inst-a
#      observes the accepted following relation through the API.
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

json_contains_ap_id() {
	local key=$1
	local expected=$2
	local body=$3
	JSON_BODY="$body" python3 - "$key" "$expected" <<'PY'
import json
import os
import sys

key = sys.argv[1]
expected = sys.argv[2]
try:
    data = json.loads(os.environ.get("JSON_BODY", ""))
except Exception:
    sys.exit(1)
for item in data.get(key, []):
    if isinstance(item, dict) and item.get("ap_id") == expected:
        sys.exit(0)
sys.exit(1)
PY
}

poll_relation() {
	local jar=$1
	local base=$2
	local path=$3
	local key=$4
	local expected=$5
	local label=$6
	local body
	for _ in $(seq 1 30); do
		body=$(curl -sk --cacert "$CA" -b "$jar" "$base$path")
		if json_contains_ap_id "$key" "$expected" "$body"; then
			return 0
		fi
		sleep 1
	done
	echo "FAIL federation follow: $label did not contain $expected after queue drain" >&2
	echo "last response: $body" >&2
	exit 1
}

TARGET_AP_ID="$INST_B/ap/users/tako"

relation_contains() {
	local jar=$1
	local base=$2
	local path=$3
	local key=$4
	local expected=$5
	local body
	body=$(curl -sk --cacert "$CA" -b "$jar" "$base$path")
	json_contains_ap_id "$key" "$expected" "$body"
}

post_follow() {
	curl -sk --cacert "$CA" -c "$JAR_A" -b "$JAR_A" \
		-X POST -H "Content-Type: application/json" \
		-H "Origin: $INST_A" \
		-d "{\"target_ap_id\":\"$TARGET_AP_ID\"}" \
		"$INST_A/api/follow"
}

follow_status() {
	python3 -c "
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
"
}

delete_follow() {
	curl -sk --cacert "$CA" -c "$JAR_A" -b "$JAR_A" \
		-X DELETE -H "Content-Type: application/json" \
		-H "Origin: $INST_A" \
		-d "{\"target_ap_id\":\"$TARGET_AP_ID\"}" \
		"$INST_A/api/follow"
}

# 2. POST a Follow from inst-a → inst-b's owner actor. inst-a will
#    fetch and cache the remote actor JSON during the call.
RESP=$(post_follow)
STATUS=$(echo "$RESP" | follow_status)

if [[ "$STATUS" == "pending" ]]; then
	echo "OK federation follow — inst-a fetched inst-b actor + persisted Follow row status=pending"
	echo "    target=$TARGET_AP_ID"
else
	# Idempotent re-runs: yurucommu rejects re-Follow with "Already following".
	if echo "$RESP" | grep -q "Already following"; then
		if relation_contains "$JAR_B" "$INST_B" "/api/actors/tako/followers" "followers" "$INST_A/ap/users/tako" &&
			relation_contains "$JAR_A" "$INST_A" "/api/actors/tako/following" "following" "$TARGET_AP_ID"; then
			echo "OK federation follow — accepted relation already exists from prior smoke run"
		else
			echo "WARN federation follow — stale non-accepted relation exists; deleting and retrying"
			DELETE_RESP=$(delete_follow)
			if ! echo "$DELETE_RESP" | grep -q '"success":true'; then
				echo "FAIL federation follow: could not delete stale relation — $DELETE_RESP" >&2
				exit 1
			fi
			RESP=$(post_follow)
			STATUS=$(echo "$RESP" | follow_status)
			if [[ "$STATUS" != "pending" ]]; then
				echo "FAIL federation follow: retry did not create pending Follow — $RESP" >&2
				exit 1
			fi
			echo "OK federation follow — stale relation reset; new Follow row status=pending"
		fi
	else
		echo "FAIL federation follow: unexpected response — $RESP" >&2
		exit 1
	fi
fi

poll_relation "$JAR_B" "$INST_B" "/api/actors/tako/followers" "followers" "$INST_A/ap/users/tako" "inst-b followers"
poll_relation "$JAR_A" "$INST_A" "/api/actors/tako/following" "following" "$TARGET_AP_ID" "inst-a following"

echo "OK federation follow — Follow→Accept completed across inst-a.takos.test and inst-b.takos.test"
