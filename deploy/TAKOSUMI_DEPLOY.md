# Deploying Takos As A Takosumi-Native Distribution

## Overview

Takos is the first-party AI Workspace distribution on Takosumi. A self-hosted
Takos deployment materializes a Takos product Worker that exposes:

- Takos product routes: chat, agents, memory, Git, Workspace projection, app
  launcher, and MCP tools.
- Takos runtime resources: product D1, KV/R2 storage, queues, Durable Objects,
  runtime containers, and worker assets.

Takosumi remains the control plane outside this Worker. It owns Accounts, OIDC
issuer/client policy, dashboard, ProviderConnection / ProviderBinding, the
OpenTofu runner, and the Capsule / Run / StateVersion / Output ledger. Takos
consumes that external Takosumi origin through OIDC and Capsule projection APIs.

The Cloudflare target is split into two mechanical phases:

1. `tofu apply` the OpenTofu module in [`opentofu/`](opentofu) with
   `var.target = cloudflare`. This provisions durable backing infra and exports
   non-secret ids / names.
2. Upload the Worker artifact with wrangler. This publishes the script, SPA
   assets, containers, Durable Object migrations, routes, and bindings that the
   OpenTofu provider cannot express.

Those phases are one Takosumi-native deploy. The wrangler config is not a
separate product-only deploy authority; it consumes the module outputs and must
stay in sync with them.

When Takos is installed through Takosumi, the OpenTofu module exports a
`takosumi_release.post_apply` command. Takosumi does not learn a DB-specific
migration resource. It records an opaque post-apply command, and the configured
release executor runs it from the reviewed source snapshot after the reviewed
OpenTofu apply has committed:

```sh
bun scripts/control/takosumi-release.mjs <environment>
```

That command consumes `TAKOSUMI_OUTPUTS_JSON`, renders Wrangler bindings, runs
the product-owned activation steps, and uploads the Worker artifact using the
authorized Cloudflare credentials. Any D1 or schema work remains Takos script
behavior, not a Takosumi resource type.
This bridge is intentionally narrow: durable resources that the OpenTofu
provider can express stay in the module, while provider gaps such as Vectorize
index creation are run from the reviewed app source and the reviewed
OpenTofu outputs. The OpenTofu module selects either a SHA-256-pinned Git release
artifact or an explicit source build. Takosumi executes that reviewed module and
its declared release command; it does not infer build commands, choose a newer
artifact, or replace Git as the source of truth.
The module exposes `release_executor` and defaults it to `operator` so the
normal Takosumi Cloud install path publishes Worker artifacts through the
operator release activator after OpenTofu has committed durable infrastructure:

- `runner`: use only when the selected runner can run `wrangler deploy` and
  publish Cloudflare Worker artifacts from the restored source snapshot.
- `operator`: use for Takosumi Cloud / hosted operators where the OpenTofu
  runner is a constrained execution sandbox and Worker artifact publication
  should happen through the operator release activator materializer. In this
  mode, prebuilt container images from the Git CI release manifest are required;
  the materializer fails closed instead of running `containers:build`.

The default install path uses `worker_release_tag`. The tagged Git release
contains `takosumi-artifact.json`, a Worker + SPA archive, its SHA-256, and the
Cloudflare Container image refs produced by the same workflow. OpenTofu reads
that manifest during plan and seals the selected URL, digest, and image refs into
the reviewed release command. Apply then skips `bun install`, the SPA build,
Worker bundling, and all container builds.

```hcl
worker_release_tag = "v0.10.9"
build_from_source  = false
```

Set `build_from_source = true` to build the Worker and SPA from the selected Git
snapshot. This mode still reuses the tagged release's runtime and executor
container images, because rebuilding those images inside an install run is the
dominant latency and capacity cost. The source path uses a frozen dependency
install with lifecycle scripts disabled, and may reuse a persistent Bun cache
through `TAKOS_RELEASE_BUN_INSTALL_CACHE_DIR`.

```hcl
worker_release_tag = "v0.10.9"
build_from_source  = true
```

`release_container_images` remains an explicit override for an operator-owned
registry or a release without the standard image metadata:

```hcl
release_container_images = {
  runtime  = "registry.cloudflare.com/<account-id>/takos-worker-runtime:0.10.9-<commit>"
  executor = "registry.cloudflare.com/<account-id>/takos-agent-executor:0.10.9-<commit>"
}
```

Use the Cloudflare managed registry refs from the CI release manifest. Wrangler
currently exposes those managed registry images as CI-published tags; if the
registry ref is from an external registry, use an immutable digest ref so the
reviewed Run and the deployed container image stay bound to the same artifact.

When prebuilt container images are selected, the release activator rewrites the
generated Wrangler config to use those image refs and skips the local
`containers:build` step. `release_executor = "operator"` fails at plan time if
the runtime or executor image is missing, so Takosumi Cloud never starts an
accidental container build. A self-hosted `runner` may intentionally clear
`worker_release_tag` and omit image refs to build every artifact from source,
but that is the slow fallback rather than the normal install path.
The canonical artifact source for hosted Takos installs is the Takos Git CI
release workflow: it publishes `takos-worker-runtime` and
`takos-agent-executor` to the Cloudflare managed container registry with
`wrangler containers build --push`, records the resulting registry refs in the
release manifest, and the operator passes those refs into OpenTofu as plain
module variables. GHCR images may remain as provenance / SBOM evidence, but
Cloudflare Worker deploys should consume the Cloudflare registry refs.

Normal installs do not need a generated tfvars file. For an explicit operator
override, the mechanical helper can still turn a downloaded release manifest
into `release_container_images` input:

```sh
bun scripts/control/release-container-images-from-manifest.mjs \
  release-manifest.json \
  --output release.auto.tfvars.json

tofu apply -var-file=release.auto.tfvars.json
```

This helper is intentionally mechanical. It only reads the Git CI release
manifest, requires `cloudflareRegistryRef` for `takos-worker-runtime` and
`takos-agent-executor`, and writes the `release_container_images` variable. It
does not fetch artifacts, choose alternate images, or bypass the Git/OpenTofu
source of truth.

The Git CI token used for Cloudflare registry publication must include the
account-scoped `Containers Write` / `Containers Edit` permission. Prefer storing
that as the narrower GitHub Actions secret `CLOUDFLARE_CONTAINERS_API_TOKEN`;
the release workflow falls back to `CLOUDFLARE_API_TOKEN` only for older
operator setups. A regular Workers deploy token can successfully publish scripts
while still failing container registry operations with `ApiError: Forbidden`;
the release workflow preflights this before running any image matrix job, so a
registry permission gap does not publish partial release artifacts.

Hosted Takosumi release activation also needs the operator-held containers token
when `release_containers_rollout` is `immediate` or `gradual`. Forward
`CLOUDFLARE_CONTAINERS_API_TOKEN` through the release activator command env
allowlist; `scripts/control/takosumi-release.mjs` uses it only for the final
`wrangler deploy` step. The normal Provider Connection token remains the
credential for OpenTofu, D1 migrations, workers.dev enablement, and verification
calls.

Only source builds need the Takosumi source modules imported by the Worker. The
release command accepts a clean sibling checkout at the exact reviewed ref, or
clones `takosumi_source_repo_url` at the immutable `takosumi_source_ref` declared
by OpenTofu. Artifact installs do not clone Takosumi source.

## Cloudflare Self-Host Runbook

Run commands from the `takos/` repo root unless a step says otherwise. Replace
`<account-id>`, `<zone-id>`, and `app.your-domain.example` with your own values.

### Guided One-Command Path

Steps 1-7 below are wrapped by a single guided command that reuses the same
control scripts and runs them in order, stopping on the first failure so you can
fix the environment and re-run (the render, vectorize, and secret steps are
idempotent):

```sh
# Preview the exact ordered command list without executing anything:
bun run selfhost:bootstrap -- --dry-run

# Run it for real (production):
bun run selfhost:bootstrap -- --account-id <account-id> --zone-id <zone-id>
```

Useful flags: `staging` (positional), `--vectorize-index <name>`, and
`--skip-provision` / `--skip-migrations` / `--skip-secrets` to resume a partial
run. The feature-gated secrets in step 6 remain operator-provided; the command
prints the list to set by hand. The numbered steps below document what each
phase does.

### 0. Prerequisites

- `tofu` (OpenTofu >= 1.5), `bun`, and `wrangler` (`bunx wrangler`) installed.
- `wrangler login` completed for the target Cloudflare account.
- A Cloudflare account id and, if using a custom domain, the DNS zone id.
- A clean sibling `takosumi/` checkout only when building from source. Hosted
  source builds may instead clone the exact OpenTofu
  `takosumi_source_repo_url` / `takosumi_source_ref` pin. Artifact installs do
  not require this checkout.

### 1. Provision Durable Infra

```sh
cd deploy/opentofu
tofu init
tofu apply -var 'target=cloudflare' -var 'cloudflare={account_id="<account-id>"}'
```

The module provisions the Takos product D1, KV, R2, and Queue backing resources
and exposes their ids through `tofu output -json`. The generic output contract
is service-form based:

```text
sql_databases
key_value_stores
object_buckets
queues
vector_indexes
```

Provider-specific outputs such as `cloudflare_d1_database_ids` may exist for
Cloudflare-native helper steps, but release helpers read the generic names above.
Durable Object migrations and container artifact publication remain in the
Wrangler artifact step.

### 2. Render Wrangler Bindings

```sh
# still in deploy/opentofu
bun ../../scripts/control/render-wrangler-from-tofu.mjs production --zone-id <zone-id>
cd ../..
```

The render script fills resource id placeholders in
[`cloudflare/wrangler.toml`](cloudflare/wrangler.toml). In Takosumi release
activation it writes a generated
`deploy/cloudflare/.takos-release-wrangler.<environment>.toml` and all Wrangler
commands use that generated config, so repeated installs do not preserve stale
resource ids in the Git template. Hostname vars such as
`ADMIN_DOMAIN`, `TENANT_BASE_DOMAIN`, `AUTH_PUBLIC_BASE_URL`,
`TAKOSUMI_ACCOUNTS_URL`, `OIDC_ISSUER_URL`, redirect URIs, and route patterns
are operator-owned values and must be set explicitly.

In Takosumi release activation, `TAKOSUMI_OUTPUTS_JSON` is injected by the
release runner, so the render step reads the same non-secret outputs without
requiring local `tofu output -json`.

### 3. Create Vectorize

Cloudflare's OpenTofu provider does not currently manage Vectorize indexes, so
create the expected index through the app-owned activation bridge before
running expensive build or migration work:

```sh
bunx wrangler vectorize create takos-embeddings --dimensions=768 --metric=cosine
```

The index name, dimensions, and metric are exported from the OpenTofu module and
consumed by `takosumi-release.mjs`. Match dimensions and metric to the embedding
model configured for the deploy.

### 4. Select A Release Artifact Or Build Source

The normal install selects `worker_release_tag` and does not build locally. To
exercise the source fallback, set `build_from_source = true`; the activation
command runs:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
```

Container images remain prebuilt by default in both modes. Only an intentional
self-hosted runner with no release image refs runs `bun run containers:build`.

### 5. Run Product Activation

```sh
bunx wrangler d1 migrations apply DB --remote --config deploy/cloudflare/wrangler.toml
```

This is a Takos product-owned activation command. Takosumi does not model it as
database migration resources; when installed through Takosumi, the same class of
work is executed through the opaque `takosumi_release.post_apply` command.

### 6. Set Secrets

Push secrets with:

```sh
bunx wrangler secret put <NAME> --config deploy/cloudflare/wrangler.toml
```

Required:

- `OIDC_CLIENT_SECRET`: OIDC client secret for the worker's installation client.
- `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY`: platform signing pair.
- `EXECUTOR_PROXY_SECRET`: shared secret for executor container calls.
- `TAKOS_INTERNAL_API_SECRET`: internal Takos API secret.

Run `wrangler deploy` again after rotating secrets. Cloudflare creates a new
Worker version for `secret put`; the final published version must be a
code-backed deploy with the rendered bindings, compatibility flags, containers,
and assets intact.

Feature-gated:

- `TAKOSUMI_ACCOUNTS_TOKEN`: optional server-to-server Capsule projection token
  issued by the external Takosumi control plane.
- `OCI_ORCHESTRATOR_TOKEN`
- `CF_API_TOKEN`

### 7. Deploy The Worker Artifact

```sh
bun run deploy:service worker production
```

For staging, render the staging wrangler profile and pass `staging`.

## Source Of Truth

The OpenTofu module owns durable topology. The wrangler config owns the artifact
publication pieces the provider cannot declare. Takosumi owns the deploy ledger:
Capsule, typed Runs, StateVersion, Output, policy decision, and audit events.

Takos product code must not introduce another deploy authority. App launcher,
MCP, file-handler, and Workspace surfaces should project Capsule / Output state
from Takosumi instead of inventing product-local lifecycle state for deployed
apps.

## Validation

Before treating a deploy path as release-ready:

```sh
cd takos
bun run release-gate

cd ..
bun run check:architecture
bun run check:design-docs
bun run check:legacy-names
bun run test:install-cross-product
```
