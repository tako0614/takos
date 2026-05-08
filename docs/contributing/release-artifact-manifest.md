# Release artifact manifest

`scripts/build-release-manifest.ts` emits a JSON manifest for the current Takos
product shell checkout without network access.

## Scope

本 manifest は **Part I (1.0 Core Release)** の artifact metadata を捕捉します。
Part II (Phase 1.x) の Installable App Model artifacts (takosumi-cloud /
Takosumi Accounts JWT signing / AppInstallation ledger / export bundles 等) は
Phase 1.x release artifact manifest で別途管理予定です
(acceptance-test-backlog.md 参照)。

The manifest captures:

- root/workspace Deno package metadata from `deno.json` files
- version-ish local git metadata when `git` is available (`branch`, `commit`,
  `shortCommit`, `describe`, dirty flag)
- release validation command inventory
- expected and observed Takos service IDs from Helm manifests
- AWS/GCP Helm overlay generator drift check command
- Helm template/client dry-run smoke command and CI-required env overrides
- Helm cluster install smoke command and CI-required test CRD override
- release promotion validator command
- `takosumi/packages/kernel/src/domains/*` domain directories
- local smoke/e2e script inventory

## Usage

Print to stdout:

```sh
deno run --config deno.json --allow-read --allow-run=git scripts/build-release-manifest.ts
```

Optionally write an artifact file:

```sh
deno run --config deno.json --allow-read --allow-run=git --allow-write=release-manifest.json \
  scripts/build-release-manifest.ts --output release-manifest.json
```

The script is read-only unless `--output` is supplied. It does not fetch tags,
contact remotes, start Docker, or run release gates.
