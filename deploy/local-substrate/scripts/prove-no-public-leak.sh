#!/usr/bin/env bash
# Defense-in-depth assertion that the local-substrate cannot leak to
# public DNS / ACME endpoints. Three checks:
#
#   1. factory: a manifest requesting @takos/aws-route53 is rejected by the
#      kernel because the connector is import-time denied.
#   2. CoreDNS: any letsencrypt.org name returns NXDOMAIN.
#   3. host firewall: the script *recommends* nftables / iptables egress
#      filtering (we don't apply it here, since it requires root and varies
#      per host). Defense at the Docker network layer is left to operator.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SUBSTRATE_DIR"

PASS=0
FAIL=0

assert_factory_denies_public_dns() {
	echo "==> [factory] Posting fail-public-dns manifest to kernel"
	local resp
	resp=$(curl -sk \
		--cacert caddy/runtime/pebble-issuance-root.pem \
		--resolve kernel.takos.test:443:127.0.0.1 \
		-H "Authorization: Bearer ${TAKOSUMI_DEPLOY_TOKEN:-local-substrate-deploy-token}" \
		-H "Content-Type: application/yaml" \
		--data-binary @fixtures/manifest.fail-public-dns.yml \
		-w "\n%{http_code}\n" \
		https://kernel.takos.test/v1/deployments)
	local http_code
	http_code=$(echo "$resp" | tail -1)
	if [[ "$http_code" == "400" ]] || [[ "$http_code" == "404" ]] || \
		echo "$resp" | grep -q "provider_not_registered\|provider_not_configured\|connector_not_found"; then
		echo "    PASS http=$http_code (kernel rejected public-DNS provider)"
		PASS=$((PASS + 1))
	else
		echo "    FAIL http=$http_code (kernel did not reject public-DNS provider)"
		echo "    body: $resp"
		FAIL=$((FAIL + 1))
	fi
}

assert_coredns_nxdomain_letsencrypt() {
	echo "==> [coredns] Querying letsencrypt.org via CoreDNS"
	local rcode
	rcode=$(dig +noall +comments acme-v02.api.letsencrypt.org @127.0.0.1 \
		2>/dev/null | grep -oP "status: \K[A-Z]+" | head -1)
	if [[ "$rcode" == "NXDOMAIN" ]]; then
		echo "    PASS NXDOMAIN (CoreDNS denies letsencrypt.org)"
		PASS=$((PASS + 1))
	else
		echo "    FAIL rcode=$rcode (expected NXDOMAIN)"
		FAIL=$((FAIL + 1))
	fi
}

recommend_egress_filter() {
	cat <<EOF

==> [recommendation] Network egress filter (host nftables)

The Docker network blocks DNS queries that try to leak to public Let's Encrypt,
but a fully isolated runbook should also nft-block egress from kernel/runtime-agent
container subnet to public ACME directories. Example:

   sudo nft add table inet takos-deny
   sudo nft add chain inet takos-deny out '{ type filter hook output priority -10 ; }'
   sudo nft add rule inet takos-deny out ip daddr { 23.85.43.146, 172.65.32.248 } drop comment "Let's Encrypt prod"

This is operator-owned. Re-evaluate addresses periodically.
EOF
}

assert_mocks_not_host_published() {
	# The added mock + emulator services (install-preview-mock, oauth-mock,
	# mailpit web UI, jaeger UI, otel-collector, yurucommu-a/b, minio,
	# and the Miniflare worker mirrors) must
	# stay on the internal docker network. If anyone accidentally adds a
	# `ports:` entry that publishes them to 0.0.0.0, this catches it.
	echo "==> [docker] Verifying new mock/emulator containers do not bind 0.0.0.0"
	local leaked=0
	local services=(
		install-preview-mock
		oauth-mock
		mailpit
		jaeger
		otel-collector
		yurucommu-a
		yurucommu-b
		minio
		takosumi-cloud-worker
		takosumi-kernel-worker
	)
	for svc in "${services[@]}"; do
		local cid
		cid=$(docker ps --filter "name=local-substrate-${svc}-1" --format '{{.ID}}' | head -1)
		if [[ -z "$cid" ]]; then continue; fi
		local public
		public=$(docker port "$cid" 2>/dev/null | grep -E '^.* -> 0\.0\.0\.0:' || true)
		if [[ -n "$public" ]]; then
			echo "    FAIL [docker.no-public-publish.$svc] container is published to host:"
			echo "$public" | sed 's/^/        /'
			leaked=$((leaked + 1))
		fi
	done
	if [[ "$leaked" -eq 0 ]]; then
		echo "    PASS all ${#services[@]} mock/emulator services are internal-only (no 0.0.0.0 bind)"
		PASS=$((PASS + 1))
	else
		FAIL=$((FAIL + 1))
	fi
}

assert_factory_denies_public_dns
assert_coredns_nxdomain_letsencrypt
assert_mocks_not_host_published
recommend_egress_filter

echo
echo "==> ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
