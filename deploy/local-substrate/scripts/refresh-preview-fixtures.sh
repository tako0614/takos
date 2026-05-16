#!/usr/bin/env bash
# Regenerate install-preview-mock/fixtures/*.json from the real
# `.takosumi/app.yml` of each bundled app's local checkout.
#
# The mock looks up these fixtures by git URL at request time, so the
# install wizard sees real bindings / grants / app id / commit instead of
# the sha256-derived fake values. Re-run this when an app's .takosumi/
# manifest changes, OR when the bundled-apps set changes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ECOSYSTEM="$SUBSTRATE_DIR/../../.."
FIXTURE_DIR="$SUBSTRATE_DIR/install-preview-mock/fixtures"

# Map: git URL (basename) -> local checkout path
declare -A REPOS=(
	["takos"]="$ECOSYSTEM/takos"
	["yurucommu"]="$ECOSYSTEM/yurucommu"
	["takos-docs"]="$ECOSYSTEM/takos-apps/takos-docs"
	["takos-slide"]="$ECOSYSTEM/takos-apps/takos-slide"
	["takos-excel"]="$ECOSYSTEM/takos-apps/takos-excel"
	["takos-computer"]="$ECOSYSTEM/takos-apps/takos-computer"
)

mkdir -p "$FIXTURE_DIR"

for name in "${!REPOS[@]}"; do
	repo="${REPOS[$name]}"
	app_yml="$repo/.takosumi/app.yml"
	if [[ ! -f "$app_yml" ]]; then
		echo "skip $name: $app_yml not found"
		continue
	fi
	# Use git rev-parse for the actual commit; fall back to "HEAD" string
	# if not a git repo (sub-checkouts of detached worktrees).
	commit=$(git -C "$repo" rev-parse HEAD 2>/dev/null || echo "0000000000000000000000000000000000000000")
	digest=$(sha256sum "$app_yml" | head -c 64)
	python3 -c "
import json, sys, yaml, hashlib
with open(sys.argv[1]) as fp:
    spec = yaml.safe_load(fp)
git_url = (spec.get('source') or {}).get('git', '')
ref = (spec.get('source') or {}).get('ref', 'main')
app_id = (spec.get('metadata') or {}).get('id', 'unknown')
bindings_raw = spec.get('bindings') or {}
bindings = []
for name, b in bindings_raw.items():
    if not isinstance(b, dict): continue
    bindings.append({
        'name': name,
        'kind': b.get('type', ''),
        'required': bool(b.get('required', False)),
    })
grants = []
for perm in (spec.get('permissions') or {}).get('requested', []) or []:
    grants.append({'capability': perm})
out = {
    'appId': app_id,
    'source': {
        'gitUrl': git_url,
        'ref': ref,
        'commit': '$commit',
        'appManifestDigest': 'sha256:$digest',
        'compiledManifestDigest': 'sha256:$digest',
    },
    'bindings': bindings,
    'grants': grants,
    'metadata': {
        'fixture': True,
        'generatedAt': '$(date -u +%FT%TZ)',
        'fromAppYml': sys.argv[1],
    },
}
out_path = sys.argv[2]
with open(out_path, 'w') as fp:
    json.dump(out, fp, indent=2, sort_keys=True)
print(f'wrote {out_path} ({len(bindings)} bindings, {len(grants)} grants)')
" "$app_yml" "$FIXTURE_DIR/$name.json"
done

echo "done."
