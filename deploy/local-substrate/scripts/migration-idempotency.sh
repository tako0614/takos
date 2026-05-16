#!/usr/bin/env bash
# Asserts the accounts-service D1 schema is stable across worker restarts.
#
# accounts-service uses CREATE TABLE IF NOT EXISTS for all schema (no
# proper up/down migrations exist), so the only thing we can drill on is
# idempotency: starting the worker N times must produce the same schema
# every time. A change to the init SQL that's not safe to re-run (e.g. a
# CREATE INDEX on a column that now has duplicates) would fail this.
#
# Procedure:
#   1. Snapshot the current schema via sqlite3 .schema (D1 store is sqlite
#      under miniflare).
#   2. Force-recreate the worker container (re-runs initialize()).
#   3. Snapshot again; assert byte-identical.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SUBSTRATE_DIR"

# 1. Snapshot the worker's D1 sqlite via python (host has sqlite3 built-in,
#    the worker image doesn't). Copy the file out so we don't lock-contend
#    with the live miniflare.
snapshot() {
	local out=$1
	local sqlite_path
	sqlite_path=$(docker exec local-substrate-takosumi-cloud-worker-1 sh -c \
		"find /data/d1 -name '*.sqlite' | head -1" 2>/dev/null)
	if [[ -z "$sqlite_path" ]]; then
		echo "FAIL: no .sqlite under /data/d1 in the worker container" >&2
		return 1
	fi
	docker cp "local-substrate-takosumi-cloud-worker-1:$sqlite_path" /tmp/d1-snap.sqlite >/dev/null
	python3 -c "
import sqlite3
con = sqlite3.connect('/tmp/d1-snap.sqlite')
rows = con.execute(\"SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name\").fetchall()
print('\n'.join(r[0] for r in rows))
" > "$out"
	rm -f /tmp/d1-snap.sqlite
}
snapshot /tmp/schema-before.txt

SIZE_BEFORE=$(wc -c < /tmp/schema-before.txt)
if [[ "$SIZE_BEFORE" -lt 100 ]]; then
	echo "FAIL: schema snapshot suspiciously small ($SIZE_BEFORE bytes)" >&2
	cat /tmp/schema-before.txt >&2
	exit 1
fi

# 2. Recreate the worker (forces initialize() to re-run against the same D1).
docker compose -f compose.substrate.yml --profile postgres up -d --force-recreate takosumi-cloud-worker >/dev/null 2>&1
# Give miniflare a moment to come up + run init.
sleep 5

# 3. Snapshot again, compare.
snapshot /tmp/schema-after.txt

if ! diff -q /tmp/schema-before.txt /tmp/schema-after.txt >/dev/null; then
	echo "FAIL: schema drifted after worker restart" >&2
	diff /tmp/schema-before.txt /tmp/schema-after.txt | head -20 >&2
	exit 1
fi

LINES=$(wc -l < /tmp/schema-before.txt)
echo "OK schema stable across restart ($LINES schema entries, $SIZE_BEFORE bytes)"
