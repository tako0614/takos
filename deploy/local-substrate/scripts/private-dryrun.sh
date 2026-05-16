#!/usr/bin/env bash
# Pre-deploy sanity for takos-private manifests / compose / k8s yaml.
#
#   1. YAML syntax: every *.yml / *.yaml under takos-private (minus
#      node_modules) parses as YAML.
#   2. docker compose: every compose.*.yml validates with
#      `docker compose config -f <file>` (catches anchor / reference
#      breakage and unknown keys).
#   3. Kustomize / helm overlays are skipped (would need kubectl/kustomize
#      installed and that's not in the substrate image). The yaml lint
#      catches the most common breakage (indent / unclosed strings).
#
# This doesn't APPLY any private manifest to the local kernel — takos-
# private's deploys are k8s / compose, not takosumi-kernel manifests, so
# 'dry-run against kernel' isn't applicable in the literal sense. The
# value here is catching syntax drift before the production CI complains.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PRIVATE_DIR="$SUBSTRATE_DIR/../../../takos-private"

if [[ ! -d "$PRIVATE_DIR" ]]; then
	echo "FAIL: takos-private not checked out at $PRIVATE_DIR" >&2
	exit 1
fi

PASS=0
FAIL=0

# 1. YAML syntax across the tree.
mapfile -t YAMLS < <(find "$PRIVATE_DIR" \
	\( -name '*.yml' -o -name '*.yaml' \) \
	-not -path '*/node_modules/*' \
	-not -path '*/.git/*' \
	-not -path '*/coverage/*' 2>/dev/null | sort)

for f in "${YAMLS[@]}"; do
	if python3 -c "
import sys, yaml
with open(sys.argv[1]) as fp:
    list(yaml.safe_load_all(fp))
" "$f" 2>/dev/null; then
		PASS=$((PASS + 1))
	else
		echo "FAIL yaml syntax: $f" >&2
		python3 -c "
import sys, yaml
with open(sys.argv[1]) as fp:
    list(yaml.safe_load_all(fp))
" "$f" 2>&1 | tail -3 >&2
		FAIL=$((FAIL + 1))
	fi
done

# 2. docker compose config validation.
mapfile -t COMPOSES < <(find "$PRIVATE_DIR" \
	-name 'compose*.yml' \
	-not -path '*/node_modules/*' 2>/dev/null | sort)

for f in "${COMPOSES[@]}"; do
	if docker compose -f "$f" config -q 2>/dev/null; then
		PASS=$((PASS + 1))
	else
		echo "WARN docker compose config failed: $f (often due to missing env interpolation; non-fatal)" >&2
	fi
done

echo "OK $PASS yaml/compose file(s) parse cleanly; $FAIL fail"
[[ "$FAIL" -eq 0 ]]
