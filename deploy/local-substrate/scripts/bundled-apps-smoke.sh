#!/usr/bin/env bash
# Sanity-check that every app the Takos landing page advertises as
# 'auto-installs with a new space' actually has a `.takosumi/app.yml`
# in its repository. Without this, the install button would 404 against
# takosumi-git's preview API at runtime.
#
# Apps checked: takos-docs, takos-slide, takos-excel, takos-computer, yurucommu.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ECOSYSTEM="$SUBSTRATE_DIR/../../.."

declare -a APPS=(
	"takos-apps/takos-docs"
	"takos-apps/takos-slide"
	"takos-apps/takos-excel"
	"takos-apps/takos-computer"
	"yurucommu"
)

PASS=0
FAIL=0
for rel in "${APPS[@]}"; do
	app_yml="$ECOSYSTEM/$rel/.takosumi/app.yml"
	manifest_yml="$ECOSYSTEM/$rel/.takosumi/manifest.yml"
	if [[ ! -f "$app_yml" ]]; then
		echo "FAIL $rel: missing .takosumi/app.yml" >&2
		FAIL=$((FAIL + 1))
		continue
	fi
	if ! python3 -c "
import sys, yaml
with open(sys.argv[1]) as fp:
    list(yaml.safe_load_all(fp))
" "$app_yml" 2>/dev/null; then
		echo "FAIL $rel: app.yml is not valid yaml" >&2
		FAIL=$((FAIL + 1))
		continue
	fi
	# manifest.yml is optional but if present must parse.
	if [[ -f "$manifest_yml" ]]; then
		if ! python3 -c "
import sys, yaml
with open(sys.argv[1]) as fp:
    list(yaml.safe_load_all(fp))
" "$manifest_yml" 2>/dev/null; then
			echo "FAIL $rel: manifest.yml is not valid yaml" >&2
			FAIL=$((FAIL + 1))
			continue
		fi
	fi
	PASS=$((PASS + 1))
done

echo "OK $PASS bundled app(s) have valid .takosumi/; $FAIL fail"
[[ "$FAIL" -eq 0 ]]
