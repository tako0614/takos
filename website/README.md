# takos/website

Landing site for `takos.jp`. It is a SolidStart / Vinxi static prerender app, separate from the Takos docs site under
`docs/`.

Build artifacts are generated under `.output/` and `.vinxi/`; those directories are ignored and should not be committed.

## Build

```sh
npm ci
npm run build
```

## Takosumi Install Links

The primary CTA resolves to the Takosumi platform worker install prefill route:

```txt
https://app.takosumi.com/install?git=<takos-git-url>&ref=<immutable-release>&path=<module-path>&name=takos
```

The fallback currently targets the next immutable Takos release, `v0.12.8`.
Before publishing a website build, verify that the GitHub tag exists, points to
the reviewed release commit, and contains the Cloudflare module plus the
credential-free source build below. Never publish this CTA while the tag is
missing or movable:

```sh
VITE_TAKOS_INSTALL_GIT_URL=https://github.com/tako0614/takos.git
VITE_TAKOS_INSTALL_REF=v0.12.8
VITE_TAKOS_INSTALL_MODULE_PATH=deploy/opentofu/cloudflare
```

The default public link includes `name=takos` and contains no provider-specific
input. Takosumi resolves the selected Cloudflare adapter and its connection
through the ordinary ProviderBinding flow, then receives Cloudflare inputs from
that module's install form.

`VITE_CLOUD_HOME_URL`, `VITE_CLOUD_USE_TAKOS_URL`, and
`VITE_CLOUD_INSTALL_URL` can override the full Takosumi URLs when an operator
needs a staging platform worker. Keep production public links on the bare
platform origin `https://app.takosumi.com`; do not use retired accounts or
deploy-control subdomains.

## Manual Cloudflare deployment

The CTA opens a Takosumi browser install prefill. Direct self-hosting is an
operator-run OpenTofu flow: use the same immutable release as the CTA, build the
Worker artifact from that checkout, and keep the variable and plan files outside
the Git tree:

```sh
set -eu
release=v0.12.8
git clone https://github.com/tako0614/takos.git takos
cd takos
git fetch --tags origin
git checkout --detach "$release"
git rev-parse --verify "$release^{commit}"

bun install --frozen-lockfile
bun run build:opentofu-worker-artifact

operator_dir="$HOME/.config/takos"
install -d -m 700 "$operator_dir"
cp deploy/opentofu/cloudflare/opentofu.tfvars.example "$operator_dir/takos.tfvars"
chmod 600 "$operator_dir/takos.tfvars"
# Edit "$operator_dir/takos.tfvars" with the operator-owned public_url and
# Cloudflare account settings. Keep secrets out of Git, state, and output.

cd deploy/opentofu/cloudflare
tofu init -input=false
tofu plan -input=false \
  -var-file="$operator_dir/takos.tfvars" \
  -out="$operator_dir/takos.tfplan"
tofu show "$operator_dir/takos.tfplan"
chmod 600 "$operator_dir/takos.tfplan"
tofu apply -input=false "$operator_dir/takos.tfplan"
```

`bun run build:opentofu-worker-artifact` must run before the plan. It produces
the Worker, assets, bridge helper, migration set, container desired config, and
artifact manifest under `deploy/opentofu/cloudflare/.takos-build/`; the module
consumes those exact paths. The plan is reviewed before the apply, and both
files remain operator-owned outside the checkout.

The normal Cloudflare provider lane leaves
`cloudflare_provider_gap_bridge_mode = "off"`. The optional app-owned bridge
covers remaining Vectorize, D1 migration, container-enabled Durable Object, and
Container application provider gaps; with `off`, ordinary production provider
applies leave those unsupported gaps unresolved. Use `"staging"` only with
`environment = "staging"` for disposable smoke inputs. A one-shot disposable production E2E must select
`"disposable-production"` and set
`environment = "production"` plus
`cloudflare_provider_gap_bridge_acknowledgement = "DISPOSABLE_PRODUCTION_ONE_SHOT"`
exactly; any other value fails closed. When enabled,
`container_image` must be an immutable Docker Hub digest or a same-account
Cloudflare registry digest; GHCR references are rejected. The source build does
not publish that image, so image publication and bridge execution require the
operator-owned release/deployment workflow.

For artifact publication, worker/container image provenance, secrets, and live
health/readback, follow the Takos release-artifact and deployment runbooks in
the main repository.

## Deploy

```sh
wrangler pages deploy .output/public --project-name takos-landing
```

Production custom domains for this Pages project are:

```txt
takos.jp
www.takos.jp
```

Both domains must be registered under the `takos-landing` Pages project and
their DNS records should point at `takos-landing.pages.dev`. The public CTA must
continue to resolve to `https://app.takosumi.com/install?...` with a release tag
or commit SHA, not a moving ref such as `main`.

The docs site deploys from `takos/docs/` to the `takos-docs` Pages project. Keep landing deploys and docs deploys
separate unless an operator explicitly chooses to combine them at the Cloudflare routing layer.

## Local mirror

In local-substrate, Caddy serves the prerendered landing at `https://takos.test/` and docs at
`https://takos.test/docs/`.
