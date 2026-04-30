# Release artifact manifest

`scripts/build-release-manifest.ts` emits a JSON manifest for the current
`takos-paas` checkout without network access.

## Scope

The manifest captures:

- root/workspace Deno package metadata from `deno.json` files
- version-ish local git metadata when `git` is available (`branch`, `commit`,
  `shortCommit`, `describe`, dirty flag)
- release validation command inventory
- expected and observed process roles from compose/Helm manifests
- `apps/paas/src/domains/*` domain directories
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
