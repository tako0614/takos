#!/usr/bin/env bash
# Multi-tenant isolation smoke — the most basic SaaS invariant: user A
# cannot read user B's installation, even with a valid session token.
#
# Walks:
#   1. Mint subject A + subject B via the oauth-mock dance, each with
#      its own session bearer.
#   2. POST an installation as A.
#   3. GET that installation with B's bearer → MUST be non-200.
#   4. GET with A's bearer → 200 (sanity).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CA="$SUBSTRATE_DIR/caddy/runtime/pebble-issuance-root.pem"
BASE="https://cloud.takosumi.test"

mint_session() {
	local provider=${1:-google}
	local state="tenant_iso_$(date +%s%N)_$$_$RANDOM"
	local jar
	jar="$(mktemp)"
	local loc1
	loc1=$(curl -sk --cacert "$CA" -o /dev/null -w "%{redirect_url}" \
		-c "$jar" -b "$jar" \
		"$BASE/v1/auth/upstream/authorize?provider=$provider&state=$state")
	local loc2
	loc2=$(curl -sk --cacert "$CA" -o /dev/null -w "%{redirect_url}" \
		-c "$jar" -b "$jar" "$loc1")
	local code
	code=$(echo "$loc2" | sed -nE 's/.*[?&]code=([^&]*).*/\1/p')
	[[ -n "$code" ]] || {
		rm -f "$jar"
		echo "FAIL: mock authorize did not return code" >&2
		exit 1
	}
	local resp
	resp=$(curl -sk --cacert "$CA" \
		-c "$jar" -b "$jar" \
		"$BASE/v1/auth/upstream/callback?provider=$provider&code=$code&state=$state")
	rm -f "$jar"
	echo "$resp" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
print(d.get('subject', ''), d.get('session_id', ''))
"
}

read -r SUB_A SESS_A <<<"$(mint_session google)"
[[ -n "$SUB_A" && -n "$SESS_A" ]] || { echo "FAIL: subject A creation" >&2; exit 1; }

read -r SUB_B SESS_B <<<"$(mint_session github)"
[[ -n "$SUB_B" && -n "$SESS_B" ]] || { echo "FAIL: subject B creation" >&2; exit 1; }

if [[ "$SUB_A" == "$SUB_B" ]]; then
	echo "FAIL: subjects A and B collapsed to the same takosumi subject ($SUB_A) — oauth-mock subjectSecret HMAC is producing collisions" >&2
	exit 1
fi

PREVIEW=$(curl -sk --cacert "$CA" -X POST \
	-H "Content-Type: application/json" \
	-d '{"source":{"gitUrl":"https://github.com/tako0614/takos.git","ref":"main"}}' \
	"$BASE/v1/install/preview")
APP_ID=$(echo "$PREVIEW" | python3 -c "import json,sys;print(json.loads(sys.stdin.read()).get('appId',''))")
COMMIT=$(echo "$PREVIEW" | python3 -c "import json,sys;print(json.loads(sys.stdin.read()).get('source',{}).get('commit',''))")
DIGEST=$(echo "$PREVIEW" | python3 -c "import json,sys;print(json.loads(sys.stdin.read()).get('source',{}).get('appManifestDigest',''))")

INSTALL_PAYLOAD=$(cat <<JSON
{
  "accountId": "acct_iso_${SUB_A:0:8}",
  "spaceId": "space_iso_${SUB_A:0:8}",
  "appId": "$APP_ID",
  "source": {
    "gitUrl": "https://github.com/tako0614/takos.git",
    "ref": "main",
    "commit": "$COMMIT",
    "appManifestDigest": "$DIGEST"
  },
  "mode": "shared-cell",
  "createdBySubject": "$SUB_A"
}
JSON
)
CREATE_RESP=$(curl -sk --cacert "$CA" -X POST \
	-H "Authorization: Bearer $SESS_A" \
	-H "Content-Type: application/json" \
	-d "$INSTALL_PAYLOAD" \
	"$BASE/v1/installations")
INST_ID=$(echo "$CREATE_RESP" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
print((d.get('installation') or {}).get('id', ''))
")
if [[ -z "$INST_ID" ]]; then
	echo "FAIL: subject A could not create installation: $CREATE_RESP" >&2
	exit 1
fi

cleanup() {
	curl -sk --cacert "$CA" -X DELETE \
		-H "Authorization: Bearer $SESS_A" \
		"$BASE/v1/installations/$INST_ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

STATUS_A=$(curl -sk --cacert "$CA" -o /dev/null -w "%{http_code}" \
	-H "Authorization: Bearer $SESS_A" \
	"$BASE/v1/installations/$INST_ID")
if [[ "$STATUS_A" != "200" ]]; then
	echo "FAIL: subject A can't read own installation: $STATUS_A" >&2
	exit 1
fi

STATUS_B=$(curl -sk --cacert "$CA" -o /dev/null -w "%{http_code}" \
	-H "Authorization: Bearer $SESS_B" \
	"$BASE/v1/installations/$INST_ID")

if [[ "$STATUS_B" == "200" ]]; then
	echo "FAIL: TENANT ISOLATION VIOLATION — subject B read subject A's installation" >&2
	echo "      A=$SUB_A  B=$SUB_B  installation=$INST_ID" >&2
	exit 1
fi

echo "OK tenant isolation enforced — A=$SUB_A own=200 B=$SUB_B cross-read=$STATUS_B"
