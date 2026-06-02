#!/usr/bin/env bash
# Takosumi deploy wrapper — installs and applies the Takos OpenTofu module through
# Takosumi's OpenTofu-native deploy control API.
#
# Premise: Takos is a product DEPLOYED BY Takosumi. The deploy topology is the plain
# OpenTofu module in deploy/opentofu (var.target ∈ aws | gcp | cloudflare; the
# cloudflare target provisions the D1 / KV / R2 / Queues backing resources). Takosumi
# resolves that Git module as an Installation, records a PlanRun, and on apply records
# an ApplyRun that updates the Deployment and its DeploymentOutput. A RunnerProfile owns
# the provider allowlist, credentials, state backend, and Cloudflare Container execution.
#
# Usage: ./scripts/takosumi-deploy.sh [--plan-only] [--target TARGET]
#
# Required env vars:
#   TAKOSUMI_URL            — Takosumi deploy control plane URL (e.g. https://takosumi.example.com)
#   TAKOSUMI_TOKEN          — Bearer token for the deploy control API
#   TAKOSUMI_INSTALLATION_ID — existing Installation to plan/apply (resolves the Git module + RunnerProfile)
#
# This script:
# 1. Triggers a PlanRun for the Installation's OpenTofu module
# 2. Prints the reviewed plan summary
# 3. (unless --plan-only) triggers an ApplyRun, which updates the Deployment and DeploymentOutput

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
  echo "  The Installation resolves the Git OpenTofu module (deploy/opentofu) and its RunnerProfile."
  exit 1
fi

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

# 1. Trigger a PlanRun for the Installation's OpenTofu module.
echo "Triggering PlanRun for installation ${INSTALLATION_ID}..."
PLAN_BODY="{}"
if [[ -n "$TARGET" ]]; then
  PLAN_BODY="{ \"variables\": { \"target\": \"$TARGET\" } }"
fi
PLAN_RESPONSE=$(api_post "/v1/installations/${INSTALLATION_ID}/plan-runs" "$PLAN_BODY")
PLAN_OUT=$(check_response "$PLAN_RESPONSE" "PlanRun")
PLAN_RUN_ID=$(echo "$PLAN_OUT" | jq -r '.id // .planRunId // empty' 2>/dev/null || true)

if [[ -n "$PLAN_ONLY" ]]; then
  echo "--plan-only: stopping after PlanRun (no ApplyRun)."
  exit 0
fi

# 2. Trigger an ApplyRun referencing the reviewed PlanRun. A successful ApplyRun updates
#    the Deployment and its DeploymentOutput.
echo "Triggering ApplyRun for installation ${INSTALLATION_ID}..."
APPLY_BODY="{}"
if [[ -n "$PLAN_RUN_ID" ]]; then
  APPLY_BODY="{ \"planRunId\": \"$PLAN_RUN_ID\" }"
fi
APPLY_RESPONSE=$(api_post "/v1/installations/${INSTALLATION_ID}/apply-runs" "$APPLY_BODY")
check_response "$APPLY_RESPONSE" "ApplyRun" >/dev/null

echo "Done. Deployment and DeploymentOutput updated by the ApplyRun."
