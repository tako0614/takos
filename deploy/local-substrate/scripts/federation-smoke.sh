#!/usr/bin/env bash
# Two-instance yurucommu federation smoke.
#
# Verifies the federation INFRASTRUCTURE is healthy: both instances
# respond on the standard ActivityPub discovery endpoints (nodeinfo,
# webfinger), and inst-a can reach inst-b over the docker network
# (proving cross-instance reachability before federation crypto).
#
# Full Follow → Accept exercise requires creating users on both sides,
# generating HTTP Signature keypairs, signing the Follow activity, and
# polling inst-b's inbox. That's blocked on yurucommu's signup surface
# (currently gated behind admin password auth) and is tracked in
# TODO-SMOKE.md. This smoke locks in the infrastructure layer so the
# next round of federation work doesn't have to debug 'why isn't
# yurucommu-a reachable from yurucommu-b'.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CA="$SUBSTRATE_DIR/caddy/runtime/pebble-issuance-root.pem"

check_endpoint() {
	local host=$1
	local path=$2
	local jq_path=$3
	local body
	body=$(curl -sk --cacert "$CA" "https://${host}${path}")
	local value
	value=$(echo "$body" | python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
cur = data
for part in '$jq_path'.split('.'):
    if isinstance(cur, list): cur = cur[int(part)] if part.isdigit() else cur
    else: cur = cur.get(part)
print(cur or '')
" 2>/dev/null)
	if [[ -z "$value" ]]; then
		echo "FAIL: https://${host}${path} did not yield ${jq_path}: ${body:0:200}" >&2
		return 1
	fi
}

# 1. nodeinfo discovery (the entry point of fediverse federation)
check_endpoint inst-a.takos.test /.well-known/nodeinfo "links.0.href"
check_endpoint inst-b.takos.test /.well-known/nodeinfo "links.0.href"

# 2. webfinger endpoint reachable (returns clean error for unknown user
#    rather than 5xx — proves the route exists and is not crashing)
for h in inst-a.takos.test inst-b.takos.test; do
	code=$(curl -sk --cacert "$CA" -o /dev/null -w "%{http_code}" \
		"https://${h}/.well-known/webfinger?resource=acct:nobody@${h}")
	if [[ "$code" -ge 500 ]]; then
		echo "FAIL: ${h} webfinger returned 5xx ($code)" >&2
		exit 1
	fi
done

# 3. Cross-instance reach via Caddy (both inst-a → inst-b and the
#    reverse path through the local TLS ingress)
CROSS=$(curl -sk --cacert "$CA" -o /dev/null -w "%{http_code}" \
	--resolve inst-b.takos.test:443:127.0.0.1 \
	https://inst-b.takos.test/.well-known/nodeinfo)
if [[ "$CROSS" != "200" ]]; then
	echo "FAIL: inst-b not reachable through Caddy ($CROSS)" >&2
	exit 1
fi

echo "OK federation infrastructure healthy (both instances + cross-instance reach)"
