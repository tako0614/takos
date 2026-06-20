#!/usr/bin/env bash
# Takosumi deploy wrapper — installs and applies the Takos OpenTofu module through
# Takosumi's OpenTofu-native deploy control API.
#
# Premise: Takos can be managed by Takosumi as a normal Installation. The deploy
# topology is the plain OpenTofu module in deploy/opentofu (var.target ∈ aws |
# gcp | cloudflare; the cloudflare target provisions the D1 / KV / R2 / Queues
# backing resources). Takosumi resolves that Git module as an Installation,
# records a plan Run, and applies the reviewed plan through an apply Run that
# updates the Deployment and OutputSnapshot. Connection, Installation provider
# connection, and runner policy own provider credentials, state backend, and
# Cloudflare Container execution.
#
# Usage: ./scripts/takosumi-deploy.sh [--plan-only] [--target TARGET]
#
# Required env vars:
#   TAKOSUMI_URL            — Takosumi control plane origin (e.g. https://app.takosumi.com)
#   TAKOSUMI_TOKEN          — Bearer token for the deploy control API
#   TAKOSUMI_INSTALLATION_ID — existing Installation to plan/apply
#
# This script:
# 1. Triggers a plan Run for the Installation's OpenTofu module
# 2. Prints the reviewed plan summary
# 3. (unless --plan-only) applies the reviewed plan through the session/API facade

set -euo pipefail

PLAN_ONLY=""
TARGET="${TAKOSUMI_TARGET:-}"
INSTALLATION_ID="${TAKOSUMI_INSTALLATION_ID:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --plan-only) PLAN_ONLY="true"; shift ;;
    --target) TARGET="$2"; shift 2 ;;
    --installation) INSTALLATION_ID="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "${TAKOSUMI_URL:-}" ]]; then
  echo "Error: TAKOSUMI_URL is required"
  exit 1
fi

if [[ -z "${TAKOSUMI_TOKEN:-}" ]]; then
  echo "Error: TAKOSUMI_TOKEN is required"
  exit 1
fi

if [[ -z "$INSTALLATION_ID" ]]; then
  echo "Error: TAKOSUMI_INSTALLATION_ID (or --installation) is required"
  echo "  The Installation resolves the Git OpenTofu module (deploy/opentofu)."
  exit 1
fi

TAKOSUMI_URL="${TAKOSUMI_URL%/}"

api_post() {
  # $1 = path, $2 = json body
  curl -s -w "\n%{http_code}" \
    -X POST "${TAKOSUMI_URL}${1}" \
    -H "Authorization: Bearer $TAKOSUMI_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$2"
}

check_response() {
  # $1 = combined "body\nhttp_code" response, $2 = label
  local response="$1" label="$2"
  local http_code body
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -n -1)
  if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
    echo "$label OK ($http_code):"
    echo "$body" | jq . 2>/dev/null || echo "$body"
  else
    echo "$label failed ($http_code):"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    exit 1
  fi
  echo "$body"
}

# 1. Trigger a plan Run for the Installation's OpenTofu module.
echo "Triggering plan Run for installation ${INSTALLATION_ID}..."
PLAN_BODY="{}"
if [[ -n "$TARGET" ]]; then
  PLAN_BODY="{ \"variables\": { \"target\": \"$TARGET\" } }"
fi
PLAN_RESPONSE=$(api_post "/api/v1/installations/${INSTALLATION_ID}/plan" "$PLAN_BODY")
PLAN_OUT=$(check_response "$PLAN_RESPONSE" "plan Run")
PLAN_RUN_ID=$(echo "$PLAN_OUT" | jq -r '.run.id // .id // .planRunId // empty' 2>/dev/null || true)

if [[ -z "$PLAN_RUN_ID" ]]; then
  echo "Error: plan response did not include a run id"
  exit 1
fi

if [[ -n "$PLAN_ONLY" ]]; then
  echo "--plan-only: stopping after plan Run (no apply)."
  exit 0
fi

# 2. Apply the reviewed plan Run. The server rebuilds and verifies the apply guard.
echo "Applying reviewed plan Run ${PLAN_RUN_ID}..."
APPLY_BODY="{}"
APPLY_RESPONSE=$(api_post "/api/v1/plan-runs/${PLAN_RUN_ID}/apply" "$APPLY_BODY")
check_response "$APPLY_RESPONSE" "apply Run" >/dev/null

echo "Done. Deployment and OutputSnapshot are updated after the apply Run succeeds."
