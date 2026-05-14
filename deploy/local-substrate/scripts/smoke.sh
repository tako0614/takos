#!/usr/bin/env bash
# End-to-end smoke that walks Phase 0–3 expectations.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SUBSTRATE_DIR"

CA="caddy/runtime/pebble-issuance-root.pem"
PASS=0
FAIL=0

check() {
	local label=$1
	local host=$2
	local path=$3
	local expect_status=$4
	local code
	code=$(curl -sk --cacert "$CA" --resolve "${host}:443:127.0.0.1" \
		-o /dev/null -w "%{http_code}" "https://${host}${path}")
	if [[ "$code" == "$expect_status" ]]; then
		echo "    PASS [$label] https://${host}${path} -> $code"
		PASS=$((PASS + 1))
	else
		echo "    FAIL [$label] https://${host}${path} -> $code (expected $expect_status)"
		FAIL=$((FAIL + 1))
	fi
}

echo "==> Phase 0 — ingress"
check "phase0.hello" "hello.takos.test" "/" "200"

echo
echo "==> Phase 1 — substrate"
check "phase1.accounts.oidc-discovery" "accounts.takos.test" "/.well-known/openid-configuration" "200"
check "phase1.kernel.health" "kernel.takos.test" "/health" "200"
check "phase1.app.health" "app.takos.test" "/health" "200"

echo
echo "==> ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
