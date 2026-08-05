# Takos release artifact runbook

This runbook is for the Takos-owned release artifact: the Worker archive,
`takosumi-artifact.json`, and the digest-pinned `takos-agent` image published
to both the target Cloudflare registry and public GHCR. Takosumi may consume these outputs, but it does not own
their publication. This publishes distribution bytes only; Takosumi remains
the sole authority for Capsule plan/apply/destroy lifecycle operations.

The entrypoint is `bun run deploy -- takos-release-artifact`. Both phases are
read-only unless `--execute` is present. Provider output and secret values are
not recorded in evidence.

## Preconditions

- Work from a clean `main` checkout whose `HEAD`, `origin/main`, and pushed
  `origin` main ref are identical.
- Use the package version as the tag (`v<package version>`); do not choose a
  second tag for the same bytes.
- Keep the Wrangler config, Cloudflare account-id file, API-token file,
  output directory, and evidence files outside the repository. Make operator
  directories `0700` and account/token files `0600`.
- Use absolute paths. The account-id file must contain one 32-character
  lowercase hexadecimal account id.

Set up a private work area, for example:

```sh
private=/var/lib/takos/release-artifacts/v0.11.11
mkdir -p "$private"
chmod 700 "$private"
chmod 600 /var/lib/takos/operator/cloudflare-account-id
chmod 600 /var/lib/takos/operator/cloudflare-api-token
```

## Prepare

Run the exact command once without `--execute`. It checks identity and paths,
then returns a plan without building, pushing images, creating a tag, or
writing the output/evidence paths.

```sh
bun run deploy -- takos-release-artifact prepare \
  --tag v0.11.11 \
  --config /absolute/path/to/deploy/cloudflare/wrangler.toml \
  --account-id-file /var/lib/takos/operator/cloudflare-account-id \
  --cloudflare-api-token-file /var/lib/takos/operator/cloudflare-api-token \
  --output-dir "$private/assets" \
  --evidence "$private/prepare.json"
```

After reviewing the plan, rerun the same command with `--execute`. Prepare
refuses an existing output/evidence path. It builds the agent image once,
uploads the same bytes under non-authoritative nonce tags in both registries,
records their read-back immutable digest references, builds the exact Worker
assets, and writes `prepare.json` with
mode `0600`. Only the digest references are release identities; upload tags are
never placed in the descriptor.

Each registry push runs with its own `DOCKER_CONFIG` directory under the
temporary private build directory. The command never uses or changes the
operator's default Docker config. Prepare reads back both registry manifests
and records only bounded content identity evidence: the config digest and the
ordered layer digests. The Cloudflare and public GHCR identities must match;
any mismatch stops the release before an artifact can be published.

## Publish

Dry-run publish first, using the prepared evidence. Use a new publish evidence
path for every attempt because evidence is never overwritten.

```sh
bun run deploy -- takos-release-artifact publish \
  --tag v0.11.11 \
  --prepare-evidence "$private/prepare.json" \
  --evidence "$private/publish.json"
```

With the plan approved, add `--execute` to that command. Publish verifies the
remote tag and draft release identity, adopts only an exact same-commit draft,
re-reads the prepared public GHCR image anonymously, and refuses to create or
adopt the release when its manifest digest, config digest, or ordered layer
digests have drifted,
uploads missing assets, downloads every asset again, and compares each
SHA-256 to the prepared bytes before making the draft public. It then writes
`publish.json` with the release URL, asset digests, image references, and the
remote immutability readback.

## Evidence and digest readback

Keep `prepare.json`, `publish.json`, and the asset directory outside the
checkout. Treat the JSON as operator-private release evidence; it contains
commit, package/tag, account id, paths, asset digests, and image references,
but never a token or provider command output.

The prepare record is the source for the three asset digests, the Cloudflare
registry reference, the public GHCR reference, and the two registry content
identities. The identity contains only `configDigest` and ordered
`layerDigests`, all in `sha256:<64 hex>` form; it never contains credentials or
provider command output. Prepare also performs an anonymous GHCR readback and
requires it to match the authenticated readback. If an independent check is
needed, run it against the private files and compare the result to the recorded
values; do not replace the evidence with a manually edited copy.

## Recovery and no-overwrite

- An interrupted prepare after an image push may leave a non-authoritative
  upload tag. It does not consume the versioned Git or GitHub Release identity;
  inspect the failure and rerun only after confirming no tag/release was made.
- A publish interruption before the draft is public can be resumed with the
  same prepared evidence and a new publish evidence path. The command skips
  only assets whose remote bytes have the exact prepared digest.
- A foreign tag, a published/non-draft release, a conflicting asset, or any
  digest mismatch is a hard stop. Do not force-push, delete, replace, or edit
  the existing identity.
- Published tags, image tags, and release assets are treated as immutable
  identities. A correction is a new version and tag; there is no in-place
  rollback of those bytes.
