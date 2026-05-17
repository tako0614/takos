#!/usr/bin/env bash
# Negative-path test for upstream OAuth: verify the cloud worker surfaces
# upstream 5xx (what a TLS handshake failure would look like in production)
# as 502 upstream_oauth_failed rather than crashing or hanging.
#
# Mechanism: the worker is permanently configured with a third upstream
# provider 'tls-fail' (custom-OIDC slot) whose /token + /userinfo always
# return 503. Walk the standard 3-step OAuth dance using that provider,
# assert the worker returns 502 with error=upstream_oauth_failed.
#
# Without this test the workerd TLS workaround (HTTP-instead-of-HTTPS for
# /token + /userinfo, documented in compose.substrate.yml) could mask a
# real production bug where the worker crashes on upstream TLS errors
# rather than returning a clean 502 to the user.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CA="$SUBSTRATE_DIR/caddy/runtime/pebble-issuance-root.pem"

STATE="oauth_tls_neg_$(date +%s%N)_$$"
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

# 1. /v1/auth/upstream/authorize?provider=tls-fail → 302 to mock /tls-fail/authorize
#    (use a cookie jar so the worker's state-binding cookie sticks for step 3).
LOC1=$(curl -sk --cacert "$CA" -c "$JAR" -b "$JAR" -o /dev/null -w "%{redirect_url}" \
	"https://cloud.takosumi.test/v1/auth/upstream/authorize?provider=tls-fail&state=$STATE")
[[ -n "$LOC1" ]] || { echo "FAIL: worker /authorize did not 302 for tls-fail provider" >&2; exit 1; }

# 2. Follow mock /tls-fail/authorize → 302 with code (this part still works)
LOC2=$(curl -sk --cacert "$CA" -c "$JAR" -b "$JAR" -o /dev/null -w "%{redirect_url}" "$LOC1")
CODE=$(echo "$LOC2" | sed -nE 's/.*[?&]code=([^&]*).*/\1/p')
[[ -n "$CODE" ]] || { echo "FAIL: tls-fail authorize did not return a code" >&2; exit 1; }

# 3. Worker /callback hits /tls-fail/token → 503 → worker should return 502
#    upstream_oauth_failed. State cookie matches because we reused the jar.
RESP=$(curl -sk --cacert "$CA" -c "$JAR" -b "$JAR" -w "\n%{http_code}" \
	"https://cloud.takosumi.test/v1/auth/upstream/callback?provider=tls-fail&code=$CODE&state=$STATE")
STATUS=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | head -n -1)

if [[ "$STATUS" != "502" ]]; then
	echo "FAIL: expected 502 from worker callback when upstream /token returns 503, got $STATUS" >&2
	echo "      body: $BODY" >&2
	exit 1
fi
if ! echo "$BODY" | grep -q "upstream_oauth_failed"; then
	echo "FAIL: 502 response did not contain 'upstream_oauth_failed'" >&2
	echo "      body: $BODY" >&2
	exit 1
fi

echo "OK worker surfaces upstream 5xx as 502 upstream_oauth_failed (no crash, no hang)"
