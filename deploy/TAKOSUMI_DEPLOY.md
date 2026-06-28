# Deploying Takos As A Takosumi-Native Distribution

## Overview

Takos is the first-party AI Workspace distribution on Takosumi. A self-hosted
Takos deployment materializes one same-origin Worker that composes:

- Takos product routes: chat, agents, memory, Git, Workspace projection, app
  launcher, and MCP tools.
- Takosumi Accounts: login, OIDC issuer, billing/account contracts, and launch
  tokens.
- Takosumi deploy-control: Workspace / Source / ProviderConnection / Capsule /
  Run / StateVersion / Output ledger and in-process control seam.
- Takosumi dashboard and OpenTofu runner container.

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
`takosumi_release.post_apply` command with `executor = "operator"`. Takosumi
does not learn a DB-specific migration resource. It records an opaque
post-apply command, and the operator-side release activator runs:

```sh
bun scripts/control/takosumi-release.mjs <environment>
```

That command consumes `TAKOSUMI_OUTPUTS_JSON`, renders Wrangler bindings, runs
the product-owned activation steps, and uploads the Worker artifact. Any D1 or
schema work remains Takos script behavior, not a Takosumi resource type.

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

Useful flags: `staging` (positional), `--vectorize-index <name>`,
`--takosumi-repo-dir <path>`, and `--skip-provision` / `--skip-migrations` /
`--skip-secrets` to resume a partial run. The feature-gated secrets in step 6
remain operator-provided; the command prints the list to set by hand. The
numbered steps below document what each phase does.

### 0. Prerequisites

- `tofu` (OpenTofu >= 1.5), `bun`, and `wrangler` (`bunx wrangler`) installed.
- `wrangler login` completed for the target Cloudflare account.
- A Cloudflare account id and, if using a custom domain, the DNS zone id.
- The sibling `takosumi/` repo checked out. The Takos distribution worker imports
  Takosumi source via tsconfig aliases and wrangler builds the OpenTofu runner
  image from `../../../takosumi/runner/Dockerfile`.

### 1. Provision Durable Infra

```sh
cd deploy/opentofu
tofu init
tofu apply -var 'target=cloudflare' -var 'cloudflare={account_id="<account-id>"}'
```

The module provisions the D1, KV, R2, Queue, Durable Object, and container
backing resources and exposes their ids through `tofu output -json`.

### 2. Render Wrangler Bindings

```sh
# still in deploy/opentofu
bun ../../scripts/control/render-wrangler-from-tofu.mjs production --zone-id <zone-id>
cd ../..
```

The render script fills resource id placeholders in
[`cloudflare/wrangler.toml`](cloudflare/wrangler.toml). Hostname vars such as
`ADMIN_DOMAIN`, `TENANT_BASE_DOMAIN`, `AUTH_PUBLIC_BASE_URL`,
`TAKOSUMI_ACCOUNTS_ISSUER`, `OIDC_ISSUER_URL`, redirect URIs, and route patterns
are operator-owned values and must be set explicitly.

In Takosumi release activation, `TAKOSUMI_OUTPUTS_JSON` is injected by the
release runner, so the render step reads the same non-secret outputs without
requiring local `tofu output -json`.

### 3. Create Vectorize

Cloudflare's OpenTofu provider does not currently manage Vectorize indexes, so
create the expected index out of band:

```sh
bunx wrangler vectorize create takos-embeddings --dimensions=768 --metric=cosine
```

Match dimensions and metric to the embedding model configured for the deploy.

### 4. Build Assets And Containers

```sh
bun run build
bun run containers:build
```

Wrangler builds the OpenTofu runner image from the sibling `takosumi/` checkout
during deploy.

### 5. Run Product Activation

```sh
bunx wrangler d1 migrations apply DB --remote --config deploy/cloudflare/wrangler.toml

cd ../takosumi
bun run cli -- accounts migrate-d1 --database-id <accounts-d1-id> --account-id <account-id> --remote
cd ../takos
```

`<accounts-d1-id>` is the `cloudflare_accounts_d1_database_id` OpenTofu output.
The deploy-control DB binding (`TAKOSUMI_CONTROL_DB`) self-creates its tables lazily.
These are product-owned activation commands. Takosumi does not model them as
database migration resources; when installed through Takosumi, the same class of
work is executed through the opaque `takosumi_release.post_apply` command.

### 6. Set Secrets

Push secrets with:

```sh
bunx wrangler secret put <NAME> --config deploy/cloudflare/wrangler.toml
```

Required:

- `TAKOSUMI_DEPLOY_CONTROL_TOKEN`: internal bearer shared by the in-process
  Accounts proxy and deploy-control handler.
- `OIDC_CLIENT_SECRET`: OIDC client secret for the worker's installation client.
- `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY`: platform signing pair.
- `EXECUTOR_PROXY_SECRET`: shared secret for executor container calls.
- `TAKOSUMI_ACCOUNTS_ES256_PRIVATE_JWK`: OIDC token signing private key.
- `TAKOSUMI_ACCOUNTS_OIDC_PAIRWISE_SUBJECT_SECRET`: pairwise subject HMAC.
- `TAKOSUMI_ACCOUNTS_LAUNCH_TOKEN_PAIRWISE_SECRET`: launch token HMAC.
- `TAKOSUMI_ACCOUNTS_EXPORT_DOWNLOAD_SECRET`: export download signing secret.

Feature-gated:

- `TAKOSUMI_ACCOUNTS_ES256_KEY_ID`
- `OCI_ORCHESTRATOR_TOKEN`
- `CF_API_TOKEN`
- `TAKOSUMI_ACCOUNTS_STRIPE_SECRET_KEY`
- `TAKOSUMI_ACCOUNTS_STRIPE_WEBHOOK_SECRET`
- `TAKOSUMI_ACCOUNTS_UPSTREAM_GOOGLE_CLIENT_ID`
- `TAKOSUMI_ACCOUNTS_UPSTREAM_GOOGLE_CLIENT_SECRET`
- `TAKOSUMI_ACCOUNTS_UPSTREAM_OIDC_CLIENT_ID`
- `TAKOSUMI_ACCOUNTS_UPSTREAM_OIDC_CLIENT_SECRET`
- `TAKOSUMI_ACCOUNTS_PASSKEY_RP_ID`
- `TAKOSUMI_ACCOUNTS_PASSKEY_RP_NAME`
- `TAKOSUMI_ACCOUNTS_PASSKEY_ORIGIN`

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
