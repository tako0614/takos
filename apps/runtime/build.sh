#!/bin/bash
# Build script for takos-runtime with takos-cli

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Build Docker image from repo root (same context as container deploy jobs)
echo "Building Docker image..."
docker build -t takos-runtime:latest -f "$SCRIPT_DIR/Dockerfile" "$ROOT_DIR"

echo "Done! Image: takos-runtime:latest"
