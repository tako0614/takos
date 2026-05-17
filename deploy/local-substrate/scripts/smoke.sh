#!/usr/bin/env bash
# End-to-end smoke that walks Phase 0–3 expectations.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SUBSTRATE_DIR"

CA="caddy/runtime/pebble-issuance-root.pem"
PASS=0
FAIL=0
SMOKE_LOG_DIR="${SMOKE_LOG_DIR:-/tmp/smoke-logs}"
mkdir -p "$SMOKE_LOG_DIR"

# Wrap a script invocation so its full stdout+stderr is captured to
# $SMOKE_LOG_DIR/<label>.log when it fails. CI uploads the dir as a
# build artifact so post-mortem doesn't require manual re-run.
run_script() {
	local label=$1
	local cmd=$2  # space-separated command-line
	local logfile="$SMOKE_LOG_DIR/${label}.log"
	if eval "$cmd" >"$logfile" 2>&1; then
		return 0
	else
		echo "      → log: $logfile (last 5 lines:)"
		tail -n 5 "$logfile" | sed 's/^/        /'
		return 1
	fi
}

# Bundle freshness gate — refuse to run smoke against a stale worker /
# SPA bundle. Without this an editor could edit accounts-service/src/*.ts
# OR dashboard-ui/src/**/*.tsx and get smoke green against the *old*
# bundle, then push and have CI / production fail.
#
# Pattern: if any source file is newer than the build output, automatically
# rebuild via the corresponding compose service. Operators see a clear
# log line, but don't have to remember to rebuild manually.
bundle_freshness_gate() {
	local repo_root
	repo_root=$(cd "$SUBSTRATE_DIR/../../.." && pwd)
	# Worker bundle: takosumi-cloud-accounts-worker.mjs is bundled from
	# takosumi-cloud/packages/accounts-service/src + deploy/cloudflare/src.
	local worker_bundle="$repo_root/takosumi-cloud/deploy/cloudflare/.wrangler/dist/takosumi-cloud-accounts-worker.mjs"
	local worker_sources=(
		"$repo_root/takosumi-cloud/packages/accounts-service/src"
		"$repo_root/takosumi-cloud/deploy/cloudflare/src"
	)
	if [[ -f "$worker_bundle" ]]; then
		local newer
		newer=$(find "${worker_sources[@]}" -type f -newer "$worker_bundle" \
			\( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | head -3)
		if [[ -n "$newer" ]]; then
			echo "==> [bundle-gate] worker source newer than bundle, auto-rebuilding..."
			echo "$newer" | sed 's/^/                   /'
			docker compose -f compose.substrate.yml --profile postgres \
				run --rm takosumi-cloud-worker-build >"$SMOKE_LOG_DIR/bundle-gate-worker.log" 2>&1 || {
				echo "==> [bundle-gate] worker rebuild FAILED; see $SMOKE_LOG_DIR/bundle-gate-worker.log" >&2
				exit 1
			}
			docker compose -f compose.substrate.yml --profile postgres \
				up -d --force-recreate takosumi-cloud-worker >/dev/null 2>&1
			sleep 3
			echo "==> [bundle-gate] worker rebuilt + restarted"
		fi
	fi
	# Takosumi kernel Worker bundle: takosumi/deploy/cloudflare runs the
	# kernel in-process on workerd with D1/R2 bindings.
	local kernel_worker_bundle="$repo_root/takosumi/deploy/cloudflare/.wrangler/dist/takosumi-cloudflare-worker.mjs"
	local kernel_worker_sources=(
		"$repo_root/takosumi/deploy/cloudflare/src"
		"$repo_root/takosumi/packages/kernel/src"
	)
	if [[ -f "$kernel_worker_bundle" ]]; then
		local kernel_newer
		kernel_newer=$(find "${kernel_worker_sources[@]}" -type f -newer "$kernel_worker_bundle" \
			\( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | head -3)
		if [[ -n "$kernel_newer" ]]; then
			echo "==> [bundle-gate] kernel worker source newer than bundle, auto-rebuilding..."
			echo "$kernel_newer" | sed 's/^/                   /'
			docker compose -f compose.substrate.yml --profile postgres \
				run --rm takosumi-kernel-worker-build >"$SMOKE_LOG_DIR/bundle-gate-kernel-worker.log" 2>&1 || {
				echo "==> [bundle-gate] kernel worker rebuild FAILED; see $SMOKE_LOG_DIR/bundle-gate-kernel-worker.log" >&2
				exit 1
			}
			docker compose -f compose.substrate.yml --profile postgres \
				up -d --force-recreate takosumi-kernel-worker >/dev/null 2>&1
			sleep 3
			echo "==> [bundle-gate] kernel worker rebuilt + restarted"
		fi
	fi
	# SPA bundle: .output/public/index.html is the entrypoint vinxi emits.
	local spa_bundle="$repo_root/takosumi-cloud/packages/dashboard-ui/.output/public/index.html"
	local spa_sources="$repo_root/takosumi-cloud/packages/dashboard-ui/src"
	if [[ -f "$spa_bundle" ]]; then
		local newer
		newer=$(find "$spa_sources" -type f -newer "$spa_bundle" \
			\( -name '*.tsx' -o -name '*.ts' -o -name '*.css' \) 2>/dev/null | head -3)
		if [[ -n "$newer" ]]; then
			echo "==> [bundle-gate] SPA source newer than bundle, auto-rebuilding..."
			echo "$newer" | sed 's/^/                   /'
			docker compose -f compose.substrate.yml --profile postgres \
				run --rm takosumi-cloud-dashboard-build >"$SMOKE_LOG_DIR/bundle-gate-spa.log" 2>&1 || {
				echo "==> [bundle-gate] SPA rebuild FAILED; see $SMOKE_LOG_DIR/bundle-gate-spa.log" >&2
				exit 1
			}
			# Caddy bind-mount needs recreate (not restart) to pick up new files
			docker compose -f compose.ingress.yml up -d --force-recreate caddy >/dev/null 2>&1
			sleep 3
			echo "==> [bundle-gate] SPA rebuilt + Caddy recreated"
		fi
	fi
}

bundle_freshness_gate

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

# Status + JSON shape assertion. Walks the GET response through python so
# we catch schema drift (e.g. backend renames installation.id → id_new
# without telling the SPA) earlier than 'HTTP 200 = green' would.
check_json() {
	local label=$1
	local host=$2
	local path=$3
	local jq_path=$4   # python-style: a.b.c or a.b[0].c
	local body status
	body=$(curl -sk --cacert "$CA" --resolve "${host}:443:127.0.0.1" \
		-w "\n%{http_code}" "https://${host}${path}")
	status=$(echo "$body" | tail -n1)
	if [[ "$status" != "200" ]]; then
		echo "    FAIL [$label] https://${host}${path} -> $status (expected 200)"
		FAIL=$((FAIL + 1))
		return
	fi
	local body_only
	body_only=$(echo "$body" | head -n -1)
	if echo "$body_only" | python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
path = '$jq_path'
cur = data
for part in path.split('.'):
    if '[' in part:
        key, idx = part.split('[')
        idx = int(idx.rstrip(']'))
        cur = cur[key][idx] if key else cur[idx]
    else:
        cur = cur[part]
assert cur is not None and cur != '', 'value is falsy'
" 2>/dev/null; then
		echo "    PASS [$label] https://${host}${path} → 200 with $jq_path"
		PASS=$((PASS + 1))
	else
		echo "    FAIL [$label] https://${host}${path} → 200 but $jq_path is missing/empty"
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

echo
echo "==> Docs surfaces — one-hop link check (catches renamed sections breaking nav)"
if run_script "docs.link-check" "bash $SCRIPT_DIR/docs-link-check.sh"; then
	echo "    PASS [docs.link-check] takos + takosumi + accounts + marketing one-hop deep"
	PASS=$((PASS + 1))
else
	FAIL=$((FAIL + 1))
	echo "    FAIL [docs.link-check] see scripts/docs-link-check.sh"
fi

check_json "prod-mirror.cloud.oidc-discovery" "cloud.takosumi.test" "/.well-known/openid-configuration" "authorization_endpoint"
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
	if bash "$SCRIPT_DIR/oauth-e2e.sh" "$provider"  >/dev/null 2>&1; then
		echo "    PASS [oauth.e2e.$provider] full authorize → callback dance returned session"
		PASS=$((PASS + 1))
	else
		echo "    FAIL [oauth.e2e.$provider] see scripts/oauth-e2e.sh $provider for the failure"
		FAIL=$((FAIL + 1))
	fi
done

# Negative path: with upstream /token returning 5xx the worker must
# surface 502 upstream_oauth_failed (NOT crash). Provider 'tls-fail' is a
# custom-OIDC slot wired to oauth-mock's /tls-fail/* endpoints.
if bash "$SCRIPT_DIR/oauth-tls-negative.sh"  >/dev/null 2>&1; then
	echo "    PASS [oauth.tls-negative] worker returns 502 upstream_oauth_failed when /token is 5xx"
	PASS=$((PASS + 1))
else
	echo "    FAIL [oauth.tls-negative] see scripts/oauth-tls-negative.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> OAuth CSRF / replay defenses — code reuse + state mismatch + unknown code"
if run_script "oauth.csrf-replay" "bash $SCRIPT_DIR/oauth-csrf-replay.sh"; then
	echo "    PASS [oauth.csrf-replay] state mismatch, code replay, and unknown code are rejected"
	PASS=$((PASS + 1))
else
	echo "    FAIL [oauth.csrf-replay] see scripts/oauth-csrf-replay.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> Tenant isolation — cross-subject installation read must not leak"
if bash "$SCRIPT_DIR/tenant-isolation.sh"  >/dev/null 2>&1; then
	echo "    PASS [tenant.isolation] subject B cannot read subject A's installation"
	PASS=$((PASS + 1))
else
	echo "    FAIL [tenant.isolation] see scripts/tenant-isolation.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> Passkey register + authenticate (virtual P-256 authenticator)"
# Generates a real P-256 keypair, registers it as a passkey credential,
# then signs an assertion challenge and asserts the worker accepts it.
# Exercises the full COSE/JWK + ECDSA verification path. Needs python3 +
# cryptography (python3-cryptography on debian/ubuntu).
if python3 "$SCRIPT_DIR/passkey-e2e.py"  >/dev/null 2>&1; then
	echo "    PASS [passkey.e2e] register + authenticate verified end-to-end"
	PASS=$((PASS + 1))
else
	echo "    FAIL [passkey.e2e] see scripts/passkey-e2e.py for the failure"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> Kernel deploy (POST /v1/deployments — canonical entry point)"
if bash "$SCRIPT_DIR/cli-smoke.sh"  >/dev/null 2>&1; then
	echo "    PASS [kernel.deploy.e2e] manifest applied to kernel, outcome=succeeded"
	PASS=$((PASS + 1))
else
	echo "    FAIL [kernel.deploy.e2e] see scripts/cli-smoke.sh for the failure"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> yurucommu 2-instance federation infrastructure"
if run_script "federation.infra" "bash $SCRIPT_DIR/federation-smoke.sh"; then
	echo "    PASS [federation.infra] inst-a + inst-b nodeinfo + webfinger + cross-reach"
	PASS=$((PASS + 1))
else
	echo "    FAIL [federation.infra] see scripts/federation-smoke.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> Federation Follow flow — login + Origin + Follow→Accept"
if run_script "federation.follow" "bash $SCRIPT_DIR/federation-follow.sh"; then
	echo "    PASS [federation.follow] strict Follow→Accept completed"
	PASS=$((PASS + 1))
else
	echo "    FAIL [federation.follow] see scripts/federation-follow.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> Worker-first mirrors (accounts worker + kernel worker on workerd + D1/R2/Queue/DO)"
if run_script "workers.cli-smoke" "bash $SCRIPT_DIR/workers-cli-smoke.sh"; then
	echo "    PASS [workers.cli-smoke] workers healthy via workerd + D1/R2/Queue/DO"
	PASS=$((PASS + 1))
else
	echo "    FAIL [workers.cli-smoke] see scripts/workers-cli-smoke.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> Phase 3 route-registrar (kernel → Caddy admin sync)"
if run_script "registrar.alive" "bash $SCRIPT_DIR/route-registrar-smoke.sh"; then
	echo "    PASS [registrar.alive] container running + ticking + static routes preserved"
	PASS=$((PASS + 1))
else
	echo "    FAIL [registrar.alive] see scripts/route-registrar-smoke.sh for the failure"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> takos-private manifest yaml/compose lint"
if run_script "private.lint" "bash $SCRIPT_DIR/private-dryrun.sh"; then
	echo "    PASS [private.lint] all yaml/compose files parse cleanly"
	PASS=$((PASS + 1))
else
	echo "    FAIL [private.lint] see scripts/private-dryrun.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> MinIO object round-trip (R2-compatible backend for object-store@v1)"
if run_script "minio.roundtrip" "bash $SCRIPT_DIR/minio-smoke.sh"; then
	echo "    PASS [minio.roundtrip] mb → put → get → sha256 match → cleanup"
	PASS=$((PASS + 1))
else
	echo "    FAIL [minio.roundtrip] see scripts/minio-smoke.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> Bundled apps .takosumi/ sanity (install link reachability)"
if run_script "bundled.apps" "bash $SCRIPT_DIR/bundled-apps-smoke.sh"; then
	echo "    PASS [bundled.apps] all 5 advertised apps have valid .takosumi/app.yml"
	PASS=$((PASS + 1))
else
	echo "    FAIL [bundled.apps] see scripts/bundled-apps-smoke.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> D1 schema idempotency (worker restart preserves schema)"
if run_script "migration.idempotency" "bash $SCRIPT_DIR/migration-idempotency.sh"; then
	echo "    PASS [migration.idempotency] schema byte-identical across worker recreate"
	PASS=$((PASS + 1))
else
	echo "    FAIL [migration.idempotency] see scripts/migration-idempotency.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> OTel pipeline (otel-collector → jaeger)"
if run_script "otel.pipeline" "bash $SCRIPT_DIR/otel-smoke.sh"; then
	echo "    PASS [otel.pipeline] synthetic OTLP trace landed in Jaeger /api/services"
	PASS=$((PASS + 1))
else
	echo "    FAIL [otel.pipeline] see scripts/otel-smoke.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> k6 load baseline via Caddy + TLS (20 RPS x 20s — regression watch only, NOT SLO)"
if run_script "k6.baseline" "bash $SCRIPT_DIR/k6-baseline.sh"; then
	echo "    PASS [k6.baseline] install/preview + oidc both within p95 + error-rate thresholds"
	PASS=$((PASS + 1))
else
	echo "    FAIL [k6.baseline] see scripts/k6-baseline.sh --verbose"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> mailpit SMTP catcher (ready for backend email when wired)"
if run_script "mailpit" "bash $SCRIPT_DIR/mailpit-smoke.sh"; then
	echo "    PASS [mailpit] inbox API reachable + probe email delivered + indexed"
	PASS=$((PASS + 1))
else
	echo "    FAIL [mailpit] see scripts/mailpit-smoke.sh"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> Stripe webhook replay (signed HMAC + idempotency)"
# Signs a checkout.session.completed event with the local fixture webhook
# secret, asserts received=true and duplicate=false on first delivery, then
# replays to assert duplicate=true. Also asserts a wrong-secret POST is
# rejected with 400.
if run_script "stripe.webhook.e2e" "python3 $SCRIPT_DIR/stripe-webhook-replay.py"; then
	echo "    PASS [stripe.webhook.e2e] verify + replay + reject all behaved"
	PASS=$((PASS + 1))
else
	echo "    FAIL [stripe.webhook.e2e] see scripts/stripe-webhook-replay.py"
	FAIL=$((FAIL + 1))
fi

echo
echo "==> ${PASS} passed, ${FAIL} failed"
if [[ "$FAIL" -gt 0 ]]; then
	echo "==> FAIL logs preserved in $SMOKE_LOG_DIR"
fi
[[ $FAIL -eq 0 ]]
