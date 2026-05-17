#!/usr/bin/env bash
# OAuth CSRF + replay defenses.
#
# The happy path is covered by oauth-e2e.sh. This script exercises the
# negative cases — the things a CSRF-or-MITM-style attack would exploit:
#
#   1. Replay of a (code, state) pair after it's already been redeemed.
#      Worker MUST refuse: single-use codes.
#   2. State mismatch — callback URL carries the right code but a
#      DIFFERENT state than the one that authorized it. Worker MUST
#      refuse: cookie/state binding.
#   3. Wholly unknown code. Worker MUST refuse: not a downgrade to 200.
#
# All three must be non-2xx. 200 would mean session minted under attacker
# control, which is the bug we exist to catch.
set -euo pipefail

PROVIDER="${PROVIDER:-google}"
BASE="https://cloud.takosumi.test"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CA="$SUBSTRATE_DIR/caddy/runtime/pebble-issuance-root.pem"

WORK=$(mktemp -d)
trap 'rm -rf "${WORK}"' EXIT

if [[ ! -f "$CA" ]]; then
	echo "Pebble CA not found at $CA — run scripts/up.sh first" >&2
	exit 1
fi

# Helper: complete a fresh authorize+code dance under a dedicated cookie jar
# (so the worker's state-binding cookie is preserved), and echo
# "<state> <code> <jar-path>". Caller uses the jar to drive the matching
# /callback request.
new_code() {
	local state="csrf_$(date +%s%N)_$$_$RANDOM"
	local jar="${WORK}/jar.$RANDOM"
	: >"${jar}"
	local loc1
	loc1=$(curl -s --cacert "$CA" -c "${jar}" -b "${jar}" -o /dev/null -w "%{redirect_url}" \
		"${BASE}/v1/auth/upstream/authorize?provider=${PROVIDER}&state=${state}")
	local loc2
	loc2=$(curl -s --cacert "$CA" -c "${jar}" -b "${jar}" -o /dev/null -w "%{redirect_url}" "${loc1}")
	local code
	code=$(echo "${loc2}" | sed -nE 's/.*[?&]code=([^&]*).*/\1/p')
	[[ -n "${code}" ]] || { echo "FAIL: new_code did not yield a code" >&2; exit 1; }
	echo "${state} ${code} ${jar}"
}

assert_non_2xx() {
	local label="$1"
	local status="$2"
	if [[ "${status}" =~ ^2 ]]; then
		echo "FAIL: ${label} returned ${status} (expected non-2xx — CSRF/replay defense breached)" >&2
		exit 1
	fi
}

# 1. Replay of a redeemed code under its OWN jar (so state cookie matches).
read -r STATE1 CODE1 JAR1 <<<"$(new_code)"
FIRST=$(curl -s --cacert "$CA" -c "${JAR1}" -b "${JAR1}" -o /dev/null -w "%{http_code}" \
	"${BASE}/v1/auth/upstream/callback?provider=${PROVIDER}&code=${CODE1}&state=${STATE1}")
if [[ "${FIRST}" != "200" ]]; then
	echo "FAIL: initial callback exchange returned ${FIRST}, expected 200 (test prereq)" >&2
	exit 1
fi
REPLAY=$(curl -s --cacert "$CA" -c "${JAR1}" -b "${JAR1}" -o /dev/null -w "%{http_code}" \
	"${BASE}/v1/auth/upstream/callback?provider=${PROVIDER}&code=${CODE1}&state=${STATE1}")
assert_non_2xx "code replay (same state, same jar)" "${REPLAY}"

# 2. State mismatch — authorize with STATE, then callback with WRONG_STATE
#    on the same jar (so the worker sees a state cookie that doesn't match
#    the query parameter).
read -r _ CODE2 JAR2 <<<"$(new_code)"
WRONG_STATE="csrf_attacker_$(date +%s%N)_$RANDOM"
MISMATCH=$(curl -s --cacert "$CA" -c "${JAR2}" -b "${JAR2}" -o /dev/null -w "%{http_code}" \
	"${BASE}/v1/auth/upstream/callback?provider=${PROVIDER}&code=${CODE2}&state=${WRONG_STATE}")
assert_non_2xx "state mismatch (state cookie vs query)" "${MISMATCH}"

# 3. Unknown code under a fresh valid state cookie. This must reach the
#    provider-code validation path, not merely fail the state-cookie guard.
read -r UNKNOWN_STATE _ UNKNOWN_JAR <<<"$(new_code)"
UNKNOWN_CODE="not_a_real_code_$(date +%s%N)"
UNKNOWN=$(curl -s --cacert "$CA" -c "${UNKNOWN_JAR}" -b "${UNKNOWN_JAR}" -o /dev/null -w "%{http_code}" \
	"${BASE}/v1/auth/upstream/callback?provider=${PROVIDER}&code=${UNKNOWN_CODE}&state=${UNKNOWN_STATE}")
assert_non_2xx "unknown code (valid state cookie)" "${UNKNOWN}"

echo "OK csrf-replay: redeemed-code-replay=${REPLAY}, state-mismatch=${MISMATCH}, unknown-code=${UNKNOWN} (all non-2xx)"
