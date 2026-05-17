#!/usr/bin/env bash
# Multi-tenant isolation smoke — the most basic SaaS invariant: user A
# cannot read user B's installation, even with a valid session token.
#
# Walks:
#   1. Mint subject A + subject B via the oauth-mock dance, each with
#      its own session bearer.
#   2. POST an installation as A.
#   3. GET that installation with B's bearer → MUST be 401/403/404
#      (or any non-200 that doesn't expose A's data).
#   4. GET with A's bearer → 200 (sanity).
#
# Without this smoke a tenant-isolation regression in the backend (e.g.
# a missing WHERE clause on subject in handleGetAppInstallation) would
# only surface when one customer reads another's data in production.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CA="$SUBSTRATE_DIR/caddy/runtime/pebble-issuance-root.pem"
BASE="https://cloud.takosumi.test"

mint_session() {
	# 1 oauth dance → echo "<subject> <session_id>"
	local provider=${1:-google}
	local state="tenant_iso_$(date +%s%N)_$$_$RANDOM"
	local loc1
	loc1=$(curl -sk --cacert "$CA" -o /dev/null -w "%{redirect_url}" \
		"$BASE/v1/auth/upstream/authorize?provider=$provider&state=$state")
	local loc2
	loc2=$(curl -sk --cacert "$CA" -o /dev/null -w "%{redirect_url}" "$loc1")
	local code
	code=$(echo "$loc2" | sed -nE 's/.*[?&]code=([^&]*).*/\1/p')
	[[ -n "$code" ]] || { echo "FAIL: mock authorize did not return code" >&2; exit 1; }
	local resp
	resp=$(curl -sk --cacert "$CA" \
		"$BASE/v1/auth/upstream/callback?provider=$provider&code=$code&state=$state")
	echo "$resp" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
print(d.get('subject', ''), d.get('session_id', ''))
"
}

# Note: oauth-mock returns the same google subject every time (mock user
# is deterministic). To get TWO distinct subjects we use google + the
# custom OIDC provider (tls-fail's authorize works fine for issuing
# distinct subjects via subjectClaim derivation).
read -r SUB_A SESS_A <<<"$(mint_session google)"
[[ -n "$SUB_A" && -n "$SESS_A" ]] || { echo "FAIL: subject A creation" >&2; exit 1; }

# Subject B: we use the github provider so the upstream_subject differs
# and yields a distinct takosumi_subject via the subjectSecret HMAC.
read -r SUB_B SESS_B <<<"$(mint_session github)"
[[ -n "$SUB_B" && -n "$SESS_B" ]] || { echo "FAIL: subject B creation" >&2; exit 1; }

if [[ "$SUB_A" == "$SUB_B" ]]; then
	echo "FAIL: subjects A and B collapsed to the same takosumi subject ($SUB_A)" >&2
	exit 1
fi

# 2. A creates an installation. Use install-preview fixture data for takos
#    so we don't need real git resolution.
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

# Cleanup: delete the installation as A on exit so we don't accumulate.
cleanup() {
	curl -sk --cacert "$CA" -X DELETE \
		-H "Authorization: Bearer $SESS_A" \
		"$BASE/v1/installations/$INST_ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 3. A reads its own installation → 200 (sanity)
STATUS_A=$(curl -sk --cacert "$CA" -o /dev/null -w "%{http_code}" \
	-H "Authorization: Bearer $SESS_A" \
	"$BASE/v1/installations/$INST_ID")
if [[ "$STATUS_A" != "200" ]]; then
	echo "FAIL: subject A can't read own installation: $STATUS_A" >&2
	exit 1
fi

# 4. B reads A's installation → MUST NOT be 200
STATUS_B=$(curl -sk --cacert "$CA" -o /dev/null -w "%{http_code}" \
	-H "Authorization: Bearer $SESS_B" \
	"$BASE/v1/installations/$INST_ID")
if [[ "$STATUS_B" == "200" ]]; then
	echo "FAIL: TENANT ISOLATION VIOLATION — subject B read subject A's installation" >&2
	echo "      A=$SUB_A  B=$SUB_B  installation=$INST_ID" >&2
	exit 1
fi

# Accept any non-200 (401, 403, 404, 5xx all communicate 'not yours').
# 200 means data leak. Anything else is at least 'not visible'.
echo "OK tenant isolation enforced — A=$SUB_A own=200 B=$SUB_B cross-read=$STATUS_B"
