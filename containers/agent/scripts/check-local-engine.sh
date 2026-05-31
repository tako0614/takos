#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
agent_dir="$(cd "${script_dir}/.." && pwd)"
engine_dir="$(cd "${agent_dir}/../../../takos-agent-engine" && pwd)"

if [[ ! -f "${engine_dir}/Cargo.toml" ]]; then
  echo "takos-agent-engine checkout not found at ${engine_dir}" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

work_dir="${tmp_dir}/takos-agent"
mkdir -p "${work_dir}"
awk -v engine_dir="${engine_dir}" '
  /takos-agent-engine = \{ path = "\.\.\/\.\.\/\.\.\/takos-agent-engine"/ {
    sub(/path = "\.\.\/\.\.\/\.\.\/takos-agent-engine"/, "path = \"" engine_dir "\"")
  }
  { print }
' "${agent_dir}/Cargo.toml" > "${work_dir}/Cargo.toml"
cp "${agent_dir}/Cargo.lock" "${work_dir}/"
cp -R "${agent_dir}/src" "${agent_dir}/tests" "${work_dir}/"

cat >> "${work_dir}/Cargo.toml" <<EOF

[patch."https://github.com/tako0614/takos-agent-engine"]
takos-agent-engine = { path = "${engine_dir}" }
EOF

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${agent_dir}/target/local-engine-check}"
cargo test --manifest-path "${work_dir}/Cargo.toml" --features mock-llm
