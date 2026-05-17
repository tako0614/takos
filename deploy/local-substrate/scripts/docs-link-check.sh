#!/usr/bin/env bash
# Surface-level link check for the docs sites served via Caddy.
#
# Walks the 4 docs surfaces the substrate ships (takos / takosumi /
# accounts / takos-marketing) one-hop deep and fails if any internal
# link returns 4xx/5xx — typical breakage when a docs section is
# renamed without updating its siblings' nav.
#
# Scope is intentionally narrow:
#   - Only same-origin <a href> follows (no external link probing).
#   - Single hop deep (--level 1) so the run stays under ~5s.
#   - Image / script / stylesheet requests skipped (--reject-regex).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CA="$SUBSTRATE_DIR/caddy/runtime/pebble-issuance-root.pem"

if ! command -v wget >/dev/null 2>&1; then
	echo "SKIP docs-link-check: wget not installed"
	exit 0
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

ROOTS=(
	"https://takosumi.test/docs/"
	"https://takos.takos.test/docs/"
	"https://accounts.takos.test/"
	"https://takos.takos.test/"
)

errors=0
for root in "${ROOTS[@]}"; do
	host=$(echo "$root" | sed -E 's#^https?://([^/]+)/.*#\1#')
	wget --quiet --recursive --level=1 --no-clobber \
		--no-host-directories --directory-prefix="$WORK/$host" \
		--ca-certificate="$CA" \
		--reject-regex='\.(png|jpg|jpeg|svg|css|js|ico|woff2?)(\?.*)?$' \
		--domains "$host" \
		--spider --no-verbose --tries=2 --timeout=10 \
		"$root" 2>"$WORK/$host.log" || true

	# wget --spider prints "broken link" lines on 4xx/5xx; grep for them.
	if grep -qE 'broken link|response.*4[0-9]{2}|response.*5[0-9]{2}' "$WORK/$host.log"; then
		echo "FAIL docs-link-check: broken links found under $root" >&2
		grep -E 'broken link|HTTP request|^--|response' "$WORK/$host.log" | head -20 >&2
		errors=$((errors + 1))
	fi
done

if [[ "$errors" -gt 0 ]]; then
	echo "FAIL docs-link-check: $errors origin(s) had broken links" >&2
	exit 1
fi

echo "OK docs-link-check: ${#ROOTS[@]} docs surfaces — no broken links one hop deep"
