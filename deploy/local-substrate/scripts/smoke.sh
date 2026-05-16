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

# POST a JSON body and assert status. Used for endpoints that 400/405 on GET
# but should return 200 when called correctly.
check_post() {
	local label=$1
	local host=$2
	local path=$3
	local body=$4
	local expect_status=$5
	local code
	code=$(curl -sk --cacert "$CA" --resolve "${host}:443:127.0.0.1" \
		-X POST -H "Content-Type: application/json" --data "$body" \
		-o /dev/null -w "%{http_code}" "https://${host}${path}")
	if [[ "$code" == "$expect_status" ]]; then
		echo "    PASS [$label] POST https://${host}${path} -> $code"
		PASS=$((PASS + 1))
	else
		echo "    FAIL [$label] POST https://${host}${path} -> $code (expected $expect_status)"
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
echo "==> Production mirror — takosumi.com / cloud.takosumi.com under .test"
check "prod-mirror.landing.index" "takosumi.test" "/" "200"
check "prod-mirror.landing.favicon" "takosumi.test" "/brand/favicon.svg" "200"
check "prod-mirror.landing.geometric" "takosumi.test" "/brand/geometric.svg" "200"
check "prod-mirror.landing.inkdrop" "takosumi.test" "/brand/inkdrop.svg" "200"
check "prod-mirror.docs.index" "takosumi.test" "/docs/" "200"
check "prod-mirror.cloud.oidc-discovery" "cloud.takosumi.test" "/.well-known/openid-configuration" "200"
check "prod-mirror.cloud.dashboard-index" "cloud.takosumi.test" "/" "200"
check "prod-mirror.cloud.dashboard-signin" "cloud.takosumi.test" "/sign-in" "200"
check "prod-mirror.cloud.dashboard-deeplink" "cloud.takosumi.test" "/apps/abc" "200"

echo
echo "==> Product landings — takos.jp / yurucommu.com under .test"
check "prod-mirror.takos.landing.index" "takos.test" "/" "200"
check "prod-mirror.takos.landing.favicon" "takos.test" "/brand/favicon.svg" "200"
check "prod-mirror.yurucommu.landing.index" "yurucommu.test" "/" "200"

echo
echo "==> Install flow — managed-offering bypass + install-preview mock"
# managed-offering gate is flipped to 'open' for the local test bed, so the
# preview endpoint should return 200 instead of 503 (launch_readiness_not_complete).
check_post "install.preview.takos" "cloud.takosumi.test" "/v1/install/preview" \
	'{"source":{"gitUrl":"https://github.com/tako0614/takos.git","ref":"main"}}' "200"
# yurucommu through the same wizard
check_post "install.preview.yurucommu" "cloud.takosumi.test" "/v1/install/preview" \
	'{"source":{"gitUrl":"https://github.com/tako0614/yurucommu.git","ref":"main"}}' "200"

echo
echo "==> OAuth flow — upstream mock (accounts.google.com / github.com)"
# These walk the full 3-step upstream OAuth dance against oauth-mock and
# assert a session is created. The dedicated script handles the redirect
# chain; here we just gate it as one PASS/FAIL per provider.
for provider in google github; do
	if bash "$SCRIPT_DIR/oauth-e2e.sh" "$provider" >/dev/null 2>&1; then
		echo "    PASS [oauth.e2e.$provider] full authorize → callback dance returned session"
		PASS=$((PASS + 1))
	else
		echo "    FAIL [oauth.e2e.$provider] see scripts/oauth-e2e.sh $provider for the failure"
		FAIL=$((FAIL + 1))
	fi
done

echo
echo "==> ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
