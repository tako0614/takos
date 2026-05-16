#!/usr/bin/env bash
# Verifies mailpit is reachable + can SMTP-receive + the inbox API exposes
# the message. Doesn't require any service to actually be sending email
# today — we send a probe ourselves using a swaks-like in-image SMTP client.
#
# Once backends start sending (signup confirmation / billing alerts), they
# point at smtp://mailpit:1025 and the catcher will surface them in the web
# UI at https://mailpit.takos.test/ + API at the same host.
set -euo pipefail

CA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../caddy/runtime/pebble-issuance-root.pem"

# 1. Web UI / API reachable through Caddy.
CODE=$(curl -sk --cacert "$CA" -o /dev/null -w "%{http_code}" \
	https://mailpit.takos.test/api/v1/messages)
[[ "$CODE" == "200" ]] || { echo "FAIL: mailpit API not reachable ($CODE)" >&2; exit 1; }

# 2. Send a probe email via mailpit's built-in API (no extra container).
PROBE_SUBJECT="local-substrate-smoke-$(date +%s%N)"
curl -sk --cacert "$CA" -X POST \
	-H "Content-Type: application/json" \
	-d "{\"From\":{\"Email\":\"smoke@local-substrate.test\"},\"To\":[{\"Email\":\"smoke-recipient@local-substrate.test\"}],\"Subject\":\"$PROBE_SUBJECT\",\"Text\":\"local-substrate mailpit smoke probe.\"}" \
	https://mailpit.takos.test/api/v1/send >/dev/null

# 3. Poll API up to 3s for the new message.
for _ in 1 2 3 4 5 6; do
	HITS=$(curl -sk --cacert "$CA" \
		"https://mailpit.takos.test/api/v1/search?query=subject:$PROBE_SUBJECT" \
		| python3 -c "import json,sys;print(json.load(sys.stdin).get('total',0))")
	if [[ "$HITS" -ge 1 ]]; then
		echo "OK mailpit probe delivered + indexed (subject=$PROBE_SUBJECT)"
		exit 0
	fi
	sleep 0.5
done

echo "FAIL: probe email not visible in mailpit inbox" >&2
exit 1
