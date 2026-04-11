#!/bin/bash
# Build script for takos-runtime with takos-cli

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAKOS_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ECOSYSTEM_ROOT="$(cd "$TAKOS_ROOT/.." && pwd)"

# Build Docker image from the ecosystem root so the runtime image can include
# the standalone takos-cli source of truth during image build.
echo "Building Docker image..."
docker build -t takos-runtime:latest -f "$SCRIPT_DIR/Dockerfile" "$ECOSYSTEM_ROOT"

echo "Done! Image: takos-runtime:latest"
