#!/usr/bin/env bash
# Generate a new ENCRYPTION_KEY and set it on both takos-web and takos-worker (staging).
#
# Usage: ./scripts/set-encryption-key.sh

set -euo pipefail
cd "$(dirname "$0")/.."

KEY=$(openssl rand -base64 32)

echo "Generated new ENCRYPTION_KEY"
echo ""

echo "--- takos-web (wrangler.toml --env staging) ---"
echo "$KEY" | wrangler secret put ENCRYPTION_KEY --env staging --config wrangler.toml 2>&1 | tail -1

echo "--- takos-worker (wrangler.worker.toml --env staging) ---"
echo "$KEY" | wrangler secret put ENCRYPTION_KEY --env staging --config wrangler.worker.toml 2>&1 | tail -1

echo ""
echo "Done. Same ENCRYPTION_KEY set on both workers."
