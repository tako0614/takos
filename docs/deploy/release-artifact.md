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
- Treat `takosumi-composition-source.json` as the Takos-owned authority for the
  Takosumi contract source compiled into this release. The checkout must use
  the physical sibling layout `takos/` plus `takosumi/`; the sibling may not be
  missing, symlinked, substituted by another Git root, or dirty. Its `HEAD`
  must equal the pinned full commit. Local `origin/main` must equal live
  canonical GitHub `main`, and that exact main commit must contain the pin in
  its Git history. This gives the pin a live canonical ancestry proof without
  making a later main advance change the release composition. A standalone
  Takos clone without that sibling fails the portable gate and release prepare
  before compilation.
- Use the package version as the tag (`v<package version>`); do not choose a
  second tag for the same bytes.
- Require the portable Takoform defaults in that source tree to name the same
  tag, GitHub archive URL, and archive SHA-256. Prepare fails before its first
  registry push when those values do not close over the built archive bytes.
- Keep the Wrangler config, Cloudflare account-id file, API-token file,
  output directory, and evidence files outside the repository. Make operator
  directories `0700` and account/token files `0600`.
- Use absolute paths. The account-id file must contain one 32-character
  lowercase hexadecimal account id.

Set up a private work area, for example:

```sh
private=/var/lib/takos/release-artifacts/v0.12.2
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
  --tag v0.12.2 \
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

Before its first remote push, prepare reruns the complete portable gate and
rechecks the composition sibling before compilation and after the exact
archive smoke. The Worker descriptor and private prepare evidence both bind
the Takosumi composition kind, repository, commit, and composition-pin digest;
publish rejects evidence from another composition.

Prepare builds the Worker archive with canonical
archive metadata: owner/group `0`, timestamp `0`, directories `0755`, and
Worker/static files `0644`, independent of the build process umask and source
filesystem modes. Only the Wrangler JavaScript entrypoint is copied, not source
maps or checkout paths. The archive fixed-point tests cover different absolute
checkout roots, `SOURCE_DATE_EPOCH` values, and process umasks `022` / `077`.
No archive file has an executable-filesystem contract.
Prepare boots those exact bytes through Wrangler local workerd. It
requires the real Takos `/health` JSON, the unauthenticated `/api/auth/me`
boundary to return its JSON `401`, and `/.well-known/takosumi` product discovery
response (including `/api/v1`), then records the bounded smoke evidence.
The final archive built after image digest readback must be byte-identical to
that preflight archive.

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
  --tag v0.12.2 \
  --prepare-evidence "$private/prepare.json" \
  --evidence "$private/publish.json"
```

With the plan approved, add `--execute` to that command. Publish verifies the
tag and GitHub Release identities are both absent, re-reads the prepared public
GHCR image anonymously, then invokes one create-only GitHub Release operation
with the tag target and complete three-asset closure. There is no draft,
upload, edit, update, delete, force, adoption, or retry path.

After creation starts, publish authoritatively re-reads the tag commit and
immutable non-draft Release, requires the API asset digests and names to be
exact, downloads all three assets, and hashes their bytes again. It then boots
the downloaded Worker archive in Wrangler local workerd and exercises the same
Takos health and product discovery API paths. Only this complete readback may
produce `publish.json`, which also records whether the create command was
acknowledged normally or recovered solely from exact lost-acknowledgment
readback.

## Evidence and digest readback

Keep `prepare.json`, `publish.json`, and the asset directory outside the
checkout. Treat the JSON as operator-private release evidence; it contains
commit, package/tag, account id, paths, asset digests, and image references,
but never a token or provider command output.

The prepare record is the source for the Takos and Takosumi composition source
closure, the three asset digests, the Cloudflare
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
- Once create-only publication starts, never rerun it automatically. A command
  error may be a lost acknowledgment: the entrypoint accepts success only when
  authoritative tag, immutable Release, exact downloaded bytes, and Takos
  runtime smoke all close over the prepared identity. Any incomplete readback
  is indeterminate and requires operator investigation, not retry or adoption.
- Any existing tag or Release, a conflicting asset, or any digest/runtime
  mismatch is a hard stop. Do not force-push, delete, replace, upload, or edit
  the existing identity.
- Published tags, image tags, and release assets are treated as immutable
  identities. A correction is a new version and tag; there is no in-place
  rollback of those bytes.
