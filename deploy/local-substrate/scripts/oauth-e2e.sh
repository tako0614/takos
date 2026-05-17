#!/usr/bin/env bash
# Walks the full upstream OAuth flow end-to-end against the local oauth-mock:
#
#   1. Worker /v1/auth/upstream/authorize  -> 302 to oauth-mock /authorize
#   2. Mock /authorize                     -> 302 to /sign-in/callback with code
#   3. Worker /v1/auth/upstream/callback   -> 200 with {subject, session_id, ...}
#
# Run as: bash scripts/oauth-e2e.sh [google|github]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CA="$SUBSTRATE_DIR/caddy/runtime/pebble-issuance-root.pem"
PROVIDER="${1:-google}"
STATE="oauth_e2e_$(date +%s%N)_$$"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

if [[ ! -f "$CA" ]]; then
	echo "Pebble CA not found at $CA — run scripts/up.sh first" >&2
	exit 1
fi

# 1. /v1/auth/upstream/authorize → 302 to mock /authorize
LOC1=$(curl -sk --cacert "$CA" -o /dev/null -w "%{redirect_url}" \
	-c "$COOKIE_JAR" -b "$COOKIE_JAR" \
	"https://cloud.takosumi.test/v1/auth/upstream/authorize?provider=${PROVIDER}&state=${STATE}")
[[ -n "$LOC1" ]] || { echo "FAIL: worker /authorize returned no redirect" >&2; exit 1; }

# 2. Follow mock /authorize → 302 to /sign-in/callback with code
LOC2=$(curl -sk --cacert "$CA" -o /dev/null -w "%{redirect_url}" \
	-c "$COOKIE_JAR" -b "$COOKIE_JAR" "$LOC1")
CODE=$(echo "$LOC2" | sed -nE 's/.*[?&]code=([^&]*).*/\1/p')
[[ -n "$CODE" ]] || { echo "FAIL: mock /authorize did not return a code (got: $LOC2)" >&2; exit 1; }

# 3. /v1/auth/upstream/callback with code+state+provider → 200 with session
RESP=$(curl -sk --cacert "$CA" \
	-c "$COOKIE_JAR" -b "$COOKIE_JAR" \
	"https://cloud.takosumi.test/v1/auth/upstream/callback?provider=${PROVIDER}&code=${CODE}&state=${STATE}")
SUBJECT=$(echo "$RESP" | python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(d.get('subject') or '')")
SESSION_ID=$(echo "$RESP" | python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(d.get('session_id') or '')")
if [[ -z "$SUBJECT" || -z "$SESSION_ID" ]]; then
	echo "FAIL: callback did not return subject/session_id (got: $RESP)" >&2
	exit 1
fi

echo "OK [$PROVIDER] subject=$SUBJECT session_id=${SESSION_ID:0:24}..."
