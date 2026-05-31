#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/seed-dev-git.sh [repository-id]

Seeds a local bare repository under TAKOS_GIT_REPOSITORY_ROOT and writes
.takos/repositories.json metadata that takos-git migrates into SQLite on first
startup.

Environment:
  TAKOS_GIT_REPOSITORY_ROOT   Repository root. Defaults to ./.takos-git/repositories.
  TAKOS_GIT_OWNER_SPACE_ID    Metadata owner space id. Defaults to space_local.
  TAKOS_GIT_DEFAULT_BRANCH    Default branch. Defaults to main.
  TAKOS_GIT_SEED_FORCE        Set to 1 to replace an existing seeded bare repo.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

repo_id="${1:-local/demo}"
repo_id="${repo_id%.git}"
root="${TAKOS_GIT_REPOSITORY_ROOT:-"${PWD}/.takos-git/repositories"}"
owner_space_id="${TAKOS_GIT_OWNER_SPACE_ID:-space_local}"
default_branch="${TAKOS_GIT_DEFAULT_BRANCH:-main}"
force="${TAKOS_GIT_SEED_FORCE:-0}"

if [[ "${repo_id}" == /* || "${repo_id}" == *..* || "${repo_id}" == *//* ]]; then
  echo "repository-id must be a safe relative path" >&2
  exit 2
fi

if [[ "${default_branch}" == refs/* || "${default_branch}" == /* || "${default_branch}" == *..* ]]; then
  echo "TAKOS_GIT_DEFAULT_BRANCH must be a safe branch name, not a ref path" >&2
  exit 2
fi

bare_path="${root}/${repo_id}.git"
metadata_dir="${root}/.takos"
metadata_path="${metadata_dir}/repositories.json"

if [[ -e "${bare_path}" ]]; then
  if [[ "${force}" != "1" ]]; then
    echo "seed repository already exists: ${bare_path}" >&2
    echo "set TAKOS_GIT_SEED_FORCE=1 to replace it" >&2
    exit 1
  fi
  rm -rf "${bare_path}"
fi

mkdir -p "${root}" "${metadata_dir}" "$(dirname "${bare_path}")"
work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT

git init --bare --initial-branch="${default_branch}" "${bare_path}" >/dev/null
git -C "${work_dir}" init -b "${default_branch}" >/dev/null
git -C "${work_dir}" config user.name "Takos Local Seed"
git -C "${work_dir}" config user.email "git@takos.local"
cat > "${work_dir}/README.md" <<EOF
# ${repo_id}

Seed repository for local takos-git verification.
EOF
git -C "${work_dir}" add README.md
GIT_AUTHOR_DATE="2000-01-01T00:00:00Z" \
  GIT_COMMITTER_DATE="2000-01-01T00:00:00Z" \
  git -C "${work_dir}" commit -m "Initial seed" >/dev/null
git -C "${work_dir}" remote add origin "${bare_path}"
git -C "${work_dir}" push origin "${default_branch}" >/dev/null
git --git-dir "${bare_path}" symbolic-ref HEAD "refs/heads/${default_branch}"

commit="$(git --git-dir "${bare_path}" rev-parse "refs/heads/${default_branch}")"
now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cat > "${metadata_path}" <<EOF
{
  "repositories": [
    {
      "id": "${repo_id}",
      "name": "${repo_id}",
      "ownerSpaceId": "${owner_space_id}",
      "defaultBranch": "${default_branch}",
      "refs": [
        { "name": "refs/heads/${default_branch}", "target": "${commit}" }
      ],
      "state": "active",
      "createdAt": "${now}",
      "updatedAt": "${now}"
    }
  ]
}
EOF

cat <<EOF
Seeded takos-git repository:
  repositoryId: ${repo_id}
  barePath: ${bare_path}
  metadata: ${metadata_path}

Use:
  export TAKOS_GIT_REPOSITORY_ROOT="${root}"
  unset TAKOS_GIT_DATABASE_URL
  bun run dev
EOF
