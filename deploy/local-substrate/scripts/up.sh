#!/usr/bin/env bash
# Bring up local-substrate.
#
# Without --profile : Phase 0 ingress only (Pebble + CoreDNS + Caddy).
# With --profile postgres : ingress + Postgres-flavored substrate (kernel + accounts + takos).
# With --profile workers  : ingress + Workers-flavored substrate (kernel-workers + accounts + takos).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SUBSTRATE_DIR"

PROFILE=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--profile)
			PROFILE="$2"
			shift 2
			;;
		--profile=*)
			PROFILE="${1#--profile=}"
			shift
			;;
		*)
			echo "unknown arg: $1" >&2
			exit 1
			;;
	esac
done

case "$PROFILE" in
	""|postgres|workers) ;;
	*)
		echo "--profile must be one of: postgres, workers (got: $PROFILE)" >&2
		exit 1
		;;
esac

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || {
	echo "docker compose plugin is required" >&2; exit 1;
}

mkdir -p caddy/runtime

echo "==> Starting Pebble and CoreDNS"
docker compose -f compose.ingress.yml up -d pebble coredns

echo "==> Waiting for Pebble management API to respond"
for _ in $(seq 1 60); do
	if curl -sk https://127.0.0.1:15000/roots/0 >/dev/null 2>&1; then
		break
	fi
	sleep 1
done

if ! curl -sk https://127.0.0.1:15000/roots/0 >/dev/null 2>&1; then
	echo "Pebble did not become ready within 60s" >&2
	docker compose -f compose.ingress.yml logs pebble | tail -50 >&2
	exit 1
fi

echo "==> Extracting Pebble minica (Caddy will use to verify Pebble's ACME directory)"
docker compose -f compose.ingress.yml cp \
	pebble:/test/certs/pebble.minica.pem \
	caddy/runtime/pebble.minica.pem

echo "==> Capturing Pebble issuance root (host will use to verify certs issued by Pebble)"
curl -sk https://127.0.0.1:15000/roots/0 -o caddy/runtime/pebble-issuance-root.pem

echo "==> Starting Caddy"
docker compose -f compose.ingress.yml up -d caddy

if [[ -n "$PROFILE" ]]; then
	echo "==> Starting substrate stack (profile: $PROFILE)"
	docker compose -f compose.substrate.yml --profile "$PROFILE" up -d

	echo "==> Waiting for substrate services to become healthy"
	for _ in $(seq 1 120); do
		# Check OIDC discovery via Caddy as a proxy for full readiness.
		if curl -sk --cacert caddy/runtime/pebble-issuance-root.pem \
			--resolve accounts.takos.test:443:127.0.0.1 \
			https://accounts.takos.test/.well-known/openid-configuration \
			>/dev/null 2>&1; then
			break
		fi
		sleep 2
	done
fi

cat <<EOF

==> local-substrate is up (profile: ${PROFILE:-none/ingress-only}).

Next steps (one-time per host):
   sudo bash scripts/ca-install.sh         # trust Pebble issuance root
   sudo bash scripts/configure-dns.sh      # split-DNS for *.takos.test

Verify (Phase 0):
   curl https://hello.takos.test/

Verify (profile=postgres):
   curl https://accounts.takos.test/.well-known/openid-configuration
   curl https://kernel.takos.test/health
   curl https://kernel-worker.takos.test/healthz

Verify (profile=workers):
   curl https://accounts.takos.test/.well-known/openid-configuration
   curl https://kernel.takos.test/healthz
   curl https://kernel.takos.test/storage/healthz
EOF
