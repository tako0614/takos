#!/usr/bin/env bash
set -euo pipefail

service_id="takos-agent"
base_url="${TAKOS_AGENT_INTERNAL_URL:-}"
timeout_seconds="${TAKOS_LIVE_SMOKE_TIMEOUT_SECONDS:-10}"

if [[ -z "${base_url}" ]]; then
  echo "skip ${service_id} live smoke: TAKOS_AGENT_INTERNAL_URL is not set"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "error ${service_id} live smoke: curl is required" >&2
  exit 1
fi

health_url="${base_url%/}/health"
body_file="$(mktemp)"
trap 'rm -f "${body_file}"' EXIT

status_code="$(
  curl \
    --silent \
    --show-error \
    --max-time "${timeout_seconds}" \
    --output "${body_file}" \
    --write-out '%{http_code}' \
    "${health_url}"
)"

if [[ "${status_code}" != "200" ]]; then
  echo "error ${service_id} live smoke: GET ${health_url} expected 200, got ${status_code}" >&2
  sed -n '1,20p' "${body_file}" >&2
  exit 1
fi

if ! grep -Eq '"service"[[:space:]]*:[[:space:]]*"takos-agent"' "${body_file}"; then
  echo "error ${service_id} live smoke: health response did not identify takos-agent" >&2
  sed -n '1,20p' "${body_file}" >&2
  exit 1
fi

if ! grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' "${body_file}"; then
  echo "error ${service_id} live smoke: health response status was not ok" >&2
  sed -n '1,20p' "${body_file}" >&2
  exit 1
fi

echo "ok ${service_id} health ${health_url}"
