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
echo "==> Passkey register + authenticate (virtual P-256 authenticator)"
# Generates a real P-256 keypair, registers it as a passkey credential,
# then signs an assertion challenge and asserts the worker accepts it.
# Exercises the full COSE/JWK + ECDSA verification path. Needs python3 +
# cryptography (python3-cryptography on debian/ubuntu).
if python3 "$SCRIPT_DIR/passkey-e2e.py" >/dev/null 2>&1; then
	echo "    PASS [passkey.e2e] register + authenticate verified end-to-end"
	PASS=$((PASS + 1))
else
	echo "    FAIL [passkey.e2e] see scripts/passkey-e2e.py for the failure"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> Kernel deploy (POST /v1/deployments — canonical entry point)"
if bash "$SCRIPT_DIR/cli-smoke.sh" >/dev/null 2>&1; then
	echo "    PASS [kernel.deploy.e2e] manifest applied to kernel, outcome=succeeded"
	PASS=$((PASS + 1))
else
	echo "    FAIL [kernel.deploy.e2e] see scripts/cli-smoke.sh for the failure"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> Phase 3 route-registrar (kernel → Caddy admin sync)"
if bash "$SCRIPT_DIR/route-registrar-smoke.sh" >/dev/null 2>&1; then
	echo "    PASS [registrar.alive] container running + ticking + static routes preserved"
	PASS=$((PASS + 1))
else
	echo "    FAIL [registrar.alive] see scripts/route-registrar-smoke.sh for the failure"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> takos-private manifest yaml/compose lint"
if bash "$SCRIPT_DIR/private-dryrun.sh" >/dev/null 2>&1; then
	echo "    PASS [private.lint] all yaml/compose files parse cleanly"
	PASS=$((PASS + 1))
else
	echo "    FAIL [private.lint] see scripts/private-dryrun.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> MinIO object round-trip (R2-compatible backend for object-store@v1)"
if bash "$SCRIPT_DIR/minio-smoke.sh" >/dev/null 2>&1; then
	echo "    PASS [minio.roundtrip] mb → put → get → sha256 match → cleanup"
	PASS=$((PASS + 1))
else
	echo "    FAIL [minio.roundtrip] see scripts/minio-smoke.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> Bundled apps .takosumi/ sanity (install link reachability)"
if bash "$SCRIPT_DIR/bundled-apps-smoke.sh" >/dev/null 2>&1; then
	echo "    PASS [bundled.apps] all 5 advertised apps have valid .takosumi/app.yml"
	PASS=$((PASS + 1))
else
	echo "    FAIL [bundled.apps] see scripts/bundled-apps-smoke.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> Stripe webhook replay (signed HMAC + idempotency)"
# Signs a checkout.session.completed event with the local fixture webhook
# secret, asserts received=true and duplicate=false on first delivery, then
# replays to assert duplicate=true. Also asserts a wrong-secret POST is
# rejected with 400.
if python3 "$SCRIPT_DIR/stripe-webhook-replay.py" >/dev/null 2>&1; then
	echo "    PASS [stripe.webhook.e2e] verify + replay + reject all behaved"
	PASS=$((PASS + 1))
else
	echo "    FAIL [stripe.webhook.e2e] see scripts/stripe-webhook-replay.py"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
