#!/usr/bin/env bash
# Takosumi deploy wrapper — submits the current source to Takosumi Installer API.
# Usage: ./scripts/takosumi-deploy.sh [--dry-run] [--space SPACE_ID]
#
# Required env vars:
#   TAKOSUMI_INSTALLER_URL — Takosumi kernel URL (e.g. https://takosumi.example.com)
#   TAKOSUMI_INSTALLER_TOKEN — Bearer token for Installer API
#
# This script:
# 1. Packages the source as a prepared tar archive
# 2. Computes the sha256 digest
# 3. Calls POST /v1/installations (or /v1/installations/{id}/deployments)

set -euo pipefail

DRY_RUN=""
SPACE_ID="${TAKOSUMI_SPACE_ID:-}"
INSTALLATION_ID="${TAKOSUMI_INSTALLATION_ID:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN="true"; shift ;;
    --space) SPACE_ID="$2"; shift 2 ;;
    --installation) INSTALLATION_ID="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "${TAKOSUMI_INSTALLER_URL:-}" ]]; then
  echo "Error: TAKOSUMI_INSTALLER_URL is required"
  exit 1
fi

if [[ -z "${TAKOSUMI_INSTALLER_TOKEN:-}" ]]; then
  echo "Error: TAKOSUMI_INSTALLER_TOKEN is required"
  exit 1
fi

# Package source as tar
echo "Packaging source..."
ARCHIVE=$(mktemp /tmp/takosumi-source-XXXXXX.tar)
tar cf "$ARCHIVE" -C "$(pwd)" .takosumi.yml $(find . -name '*.ts' -o -name '*.json' -o -name '*.yml' | head -1000)
DIGEST="sha256:$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
echo "Source digest: $DIGEST"

if [[ -n "$DRY_RUN" ]]; then
  if [[ -n "$INSTALLATION_ID" ]]; then
    ENDPOINT="${TAKOSUMI_INSTALLER_URL}/v1/installations/${INSTALLATION_ID}/deployments/dry-run"
  else
    ENDPOINT="${TAKOSUMI_INSTALLER_URL}/v1/installations/dry-run"
  fi
else
  if [[ -n "$INSTALLATION_ID" ]]; then
    ENDPOINT="${TAKOSUMI_INSTALLER_URL}/v1/installations/${INSTALLATION_ID}/deployments"
  else
    ENDPOINT="${TAKOSUMI_INSTALLER_URL}/v1/installations"
  fi
fi

echo "Deploying to: $ENDPOINT"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$ENDPOINT" \
  -H "Authorization: Bearer $TAKOSUMI_INSTALLER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"spaceId\": \"$SPACE_ID\",
    \"source\": {
      \"kind\": \"prepared\",
      \"url\": \"file://$ARCHIVE\",
      \"digest\": \"$DIGEST\"
    }
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

rm -f "$ARCHIVE"

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  echo "Success ($HTTP_CODE):"
  echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
  echo "Failed ($HTTP_CODE):"
  echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
  exit 1
fi
