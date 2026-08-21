#!/usr/bin/env bash
# Takosumi deploy wrapper — plans and applies the Takos OpenTofu module through
# Takosumi's OpenTofu-native deploy control API.
#
# Premise: Takos can be managed by Takosumi as a normal Capsule. The deploy
# topology is the plain OpenTofu module in deploy/opentofu/cloudflare. The current
# Cloudflare target provisions the D1 / KV / R2 / Queues backing resources.
# Takosumi resolves that Git module as a Capsule, records a
# plan Run, and applies the reviewed plan through an apply Run that records a new
# StateVersion and Output. Provider Connection, Provider Binding, and runner
# policy own provider credentials, state backend, and Cloudflare Container
# execution.
#
# Usage:
#   ./scripts/takosumi-deploy.sh [--target TARGET]
#   ./scripts/takosumi-deploy.sh --apply-run PLAN_RUN_ID
#
# Required env vars:
#   TAKOSUMI_URL        — Takosumi control plane origin (e.g. https://app.takosumi.com)
#   TAKOSUMI_TOKEN      — Bearer token for the deploy control API
#   TAKOSUMI_CAPSULE_ID — existing Capsule to plan (not needed with --apply-run)
#
# Planning and applying are deliberately separate invocations. The first form
# creates and prints a reviewable Plan Run, then stops. After review, the second
# form applies that exact Run id. The script never auto-applies a newly-created
# plan.

set -euo pipefail

TARGET="${TAKOSUMI_TARGET:-}"
CAPSULE_ID="${TAKOSUMI_CAPSULE_ID:-}"
APPLY_RUN_ID=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --plan-only) shift ;;
    --apply-run)
      [[ $# -ge 2 ]] || { echo "Error: --apply-run requires a Run id"; exit 1; }
      APPLY_RUN_ID="$2"; shift 2 ;;
    --target)
      [[ $# -ge 2 ]] || { echo "Error: --target requires a value"; exit 1; }
      TARGET="$2"; shift 2 ;;
    --capsule)
      [[ $# -ge 2 ]] || { echo "Error: --capsule requires a Capsule id"; exit 1; }
      CAPSULE_ID="$2"; shift 2 ;;
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

if [[ -z "$APPLY_RUN_ID" && -z "$CAPSULE_ID" ]]; then
  echo "Error: TAKOSUMI_CAPSULE_ID (or --capsule) is required"
  echo "  The Capsule resolves the Git OpenTofu module (deploy/opentofu/cloudflare)."
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
    printf '%s' "$body"
  else
    echo "$label failed ($http_code):" >&2
    echo "$body" >&2
    exit 1
  fi
}

if [[ -n "$APPLY_RUN_ID" ]]; then
  echo "Applying reviewed plan Run ${APPLY_RUN_ID}..."
  APPLY_RESPONSE=$(api_post "/api/v1/runs/${APPLY_RUN_ID}/apply" "{}")
  APPLY_OUT=$(check_response "$APPLY_RESPONSE" "apply Run")
  echo "$APPLY_OUT"
  echo "Apply Run accepted. Follow the canonical Run until it reaches a terminal state."
  exit 0
fi

# 1. Trigger a plan Run for the Capsule's OpenTofu module.
echo "Triggering plan Run for capsule ${CAPSULE_ID}..."
PLAN_BODY="{}"
if [[ -n "$TARGET" ]]; then
  PLAN_BODY="{ \"variables\": { \"target\": \"$TARGET\" } }"
fi
PLAN_RESPONSE=$(api_post "/api/v1/capsules/${CAPSULE_ID}/plan" "$PLAN_BODY")
PLAN_OUT=$(check_response "$PLAN_RESPONSE" "plan Run")
echo "$PLAN_OUT"
PLAN_RUN_ID=$(printf '%s' "$PLAN_OUT" | bun -e '
  try {
    const value = JSON.parse(await Bun.stdin.text());
    const id = value?.run?.id ?? value?.id ?? value?.planRunId;
    if (typeof id === "string") process.stdout.write(id);
  } catch {}
' || true)

if [[ -z "$PLAN_RUN_ID" ]]; then
  echo "Error: plan response did not include a run id"
  exit 1
fi

echo "Plan Run ${PLAN_RUN_ID} is ready for review."
echo "After review, apply it explicitly with:"
echo "  $0 --apply-run ${PLAN_RUN_ID}"
