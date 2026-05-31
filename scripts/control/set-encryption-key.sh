#!/usr/bin/env bash
# Generate a new ENCRYPTION_KEY and set it on the unified takos-worker (staging).
#
# Usage: ./scripts/set-encryption-key.sh

set -euo pipefail
cd "$(dirname "$0")/../.."

KEY=$(openssl rand -base64 32)

echo "Generated new ENCRYPTION_KEY"
echo ""

echo "--- takos-worker (deploy/cloudflare/wrangler.toml --env staging) ---"
echo "$KEY" | wrangler secret put ENCRYPTION_KEY --env staging --config deploy/cloudflare/wrangler.toml 2>&1 | tail -1

echo ""
echo "Done. ENCRYPTION_KEY set on takos-worker."
