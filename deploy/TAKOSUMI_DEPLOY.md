# Deploying Takos (and the optional Takosumi run ledger)

## Overview

**Takos is complete as a plain OpenTofu module.** Anyone can stand up a self-hosted Takos with no Takosumi involved.
Takos's whole deploy topology — the worker, its backing resources, and the egress / runtime-host / executor services — is
the OpenTofu module in [`opentofu/`](opentofu) (`var.target` ∈ `aws | gcp | cloudflare`; the `cloudflare` target
provisions the D1 / KV / R2 / Queues / Durable Object / container resources the Worker layer binds to). Self-hosting is
two **phases**:

1. **`tofu apply`** the module against your own infrastructure. This provisions every durable resource and publishes the
   well-known OpenTofu outputs (service URLs, binding map).
2. **One wrangler step** uploads the worker artifact (the worker script + assets + containers + Durable Object
   migrations) that reads those module outputs. This is the half of the deploy the Terraform/OpenTofu provider cannot
   express; the wrangler config at [`cloudflare/wrangler.toml`](cloudflare/wrangler.toml) is that worker-artifact half of
   the same deploy.

Those two phases are the shape of the deploy, but phase 2 has a handful of **mechanical prerequisites the OpenTofu
provider cannot declare today** (the Vectorize index, three container images, the account-plane D1 migration, the
secret set, and copying the module's output ids into the wrangler config). The runbook below lists **every one** of them
in order, with copy-pasteable commands. Nothing here is undocumented; **Takosumi is not required for any of it.**

## Complete self-host runbook (cloudflare target)

Run everything from the `takos/` repo root unless a step says otherwise. Replace `<account-id>`, `<zone-id>`, and
`app.your-domain.example` with your own values.

### 0. Prerequisites

- `tofu` (OpenTofu ≥ 1.5), `bun`, and `wrangler` (`bunx wrangler`) installed and `wrangler login` done.
- A Cloudflare account id (`<account-id>`) and, if you are attaching a custom domain, the DNS zone id (`<zone-id>`) for
  that hostname.
- The `takosumi/` repo checked out as a sibling of `takos/` (the OpenTofu runner image at
  `../../../takosumi/runner/Dockerfile` is built from it; see step 4).

### 1. Provision durable infra (`tofu apply`)

```sh
cd deploy/opentofu
tofu init
tofu apply -var 'target=cloudflare' -var 'cloudflare={account_id="<account-id>"}'
```

This creates the 3 D1 databases, 2 KV namespaces, 7 R2 buckets, and 10 Queues, and publishes their ids/names as
OpenTofu outputs (`tofu output -json`). It does **not** create the Vectorize index or upload the worker — those are
phase 2.

### 2. Fill the wrangler config from the OpenTofu outputs (glue step)

Instead of hand-copying ids out of `tofu output`, run the render script, which reads `tofu output -json` and substitutes
the `replace-with-*` placeholders in [`cloudflare/wrangler.toml`](cloudflare/wrangler.toml):

```sh
# still in deploy/opentofu (so `tofu output` resolves)
bun ../../scripts/control/render-wrangler-from-tofu.mjs production --zone-id <zone-id>
cd ../..
```

It fills `CF_ACCOUNT_ID`, the three D1 ids (`DB` / `TAKOSUMI_ACCOUNTS_DB` / `TAKOS_D1`), and the two KV ids
(`HOSTNAME_ROUTING` / `ROLLOUT_HEALTH_KV`). `--zone-id` fills `CF_ZONE_ID` (the module does not manage your DNS zone, so
this value is yours, not a tofu output). Use `--dry-run` to preview. For a staging deploy, apply the module with
`-var 'environment=staging'` and run the script with `staging` instead of `production`.

You still set the **hostname vars by hand** in `wrangler.toml` (`ADMIN_DOMAIN`, `TENANT_BASE_DOMAIN`,
`AUTH_PUBLIC_BASE_URL`, `PROXY_BASE_URL`, `TAKOS_AGENT_CONTROL_RPC_BASE_URL`, `TAKOSUMI_ACCOUNTS_ISSUER`,
`OIDC_ISSUER_URL`, the `*_REDIRECT_URI(S)`, and `TAKOSUMI_ACCOUNTS_SUBJECT`) — these are your origin, not resource ids,
so they are not auto-filled. Uncomment the `[[routes]]` block and set your hostname there if you want wrangler to
provision the DNS record + TLS cert.

### 3. Create the Vectorize index

The cloudflare provider has no managed Vectorize resource, so create it out-of-band (the module exports its expected
name `<project>-embeddings`; default project is `takos`):

```sh
bunx wrangler vectorize create takos-embeddings --dimensions=768 --metric=cosine
# staging: bunx wrangler vectorize create takos-embeddings-staging --dimensions=768 --metric=cosine
```

(Match the dimensions/metric to the embedding model your deploy uses.)

### 4. Build the SPA and the container images

The worker upload bundles a static SPA and three container images; build them before `wrangler deploy` so the image
`COPY` steps and the `[assets]` directory exist:

```sh
bun run build                 # builds the web SPA into dist/ (the ASSETS binding)
bun run containers:build      # builds dist/ for the runtime + executor containers
```

The third image — the OpenTofu runner (`OpenTofuRunnerObject`) — is built directly by wrangler from
`../../../takosumi/runner/Dockerfile` during deploy; no separate pre-build is needed, but the `takosumi/` repo
must be present (see step 0).

### 5. Migrate the two D1 databases

Two schemas must be applied before serving traffic; both fail-close if skipped:

```sh
# Product control-plane DB (binding DB) — wrangler-native migrations.
bunx wrangler d1 migrations apply DB --remote --config deploy/cloudflare/wrangler.toml

# Account-plane DB (binding TAKOSUMI_ACCOUNTS_DB) — applied by the takosumi accounts
# migrate-d1 runner; the in-process accounts handler refuses to serve on schema drift.
cd ../takosumi
bun run cli -- accounts migrate-d1 --database-id <accounts-d1-id> --account-id <account-id> --remote
cd ../takos
```

`<accounts-d1-id>` is the `cloudflare_accounts_d1_database_id` output (`tofu output -raw cloudflare_accounts_d1_database_id`).
The deploy-control DB (binding `TAKOS_D1`) has **no** migration step — its stores self-create their tables lazily.

### 6. Set the secret set

Push every secret with `wrangler secret put ... --config deploy/cloudflare/wrangler.toml` (add `--env staging` for
staging). The deploy will not function correctly until the **required** ones are set:

**Required**

- `TAKOSUMI_DEPLOY_CONTROL_TOKEN` — REQUIRED to enable the in-process deploy-control routes. The embedded deploy service
  gates `authorizeDeployControl` on this secret (returns 404 "deploy control routes disabled" when unset) and the
  accounts deploy-control proxy sends the SAME value as `Authorization: Bearer`. It is an internal handshake in this one
  worker: generate one shared secret and set it once. **Install / plan / apply silently fail without it.** Must ship in
  the same deploy as the `TAKOS_D1` binding (bootstrap fail-closes in prod when the routes are exposed but no durable
  deploy store is bound).
- `OIDC_CLIENT_SECRET` — OIDC client secret for the worker's installation client.
- `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` — platform token signing pair (also used for runtime-service JWTs; the
  worker injects the public key into the runtime container as `JWT_PUBLIC_KEY`).
- `EXECUTOR_PROXY_SECRET` — shared secret carried into the in-process executor container host env.
- Account-plane (in-process Accounts handler) signing/HMAC secrets:
  - `TAKOSUMI_ACCOUNTS_ES256_PRIVATE_JWK` — ES256 private JWK for OIDC token signing.
  - `TAKOSUMI_ACCOUNTS_OIDC_PAIRWISE_SUBJECT_SECRET` — pairwise OIDC subject HMAC secret.
  - `TAKOSUMI_ACCOUNTS_LAUNCH_TOKEN_PAIRWISE_SECRET` — launch-token pairwise HMAC secret.
  - `TAKOSUMI_ACCOUNTS_EXPORT_DOWNLOAD_SECRET` — signs `/__takosumi/exports/*` download URLs.

**Optional (set only when the matching feature is enabled)**

- `TAKOSUMI_ACCOUNTS_ES256_KEY_ID` — `kid` for the signing key.
- `TAKOSUMI_ACCOUNTS_DEPLOY_CONTROL_TOKEN` — bearer for deploy-control calls (mirror of the handshake above when the
  accounts proxy is split out).
- `OCI_ORCHESTRATOR_TOKEN`, `CF_API_TOKEN` — image-orchestrator / Workers-for-Platforms auth when those backends are on.
- Upstream identity / billing: `TAKOSUMI_ACCOUNTS_STRIPE_SECRET_KEY` / `_STRIPE_WEBHOOK_SECRET`,
  `TAKOSUMI_ACCOUNTS_UPSTREAM_GITHUB_CLIENT_ID` / `_CLIENT_SECRET`,
  `TAKOSUMI_ACCOUNTS_UPSTREAM_GOOGLE_CLIENT_ID` / `_CLIENT_SECRET`,
  `TAKOSUMI_ACCOUNTS_UPSTREAM_OIDC_CLIENT_ID` / `_CLIENT_SECRET`,
  `TAKOSUMI_ACCOUNTS_PASSKEY_RP_ID` / `_PASSKEY_RP_NAME` / `_PASSKEY_ORIGIN`.

### 7. Upload the worker artifact

`deploy:service` re-runs `bun run build` and the `DB` migration for safety, then `wrangler deploy`:

```sh
bun run deploy:service worker production
# staging: bun run deploy:service worker staging
```

That is the entire self-host path. **Takosumi is not required.**

## Takosumi is an optional convenience

Running the *same* OpenTofu module **through Takosumi** is optional. When you do, Takosumi — the OpenTofu-native deploy
control plane — installs and applies the module and records a run ledger on top, adding reviewed plans, policy decisions,
an audit trail, and a dashboard:

- **Installation** — Takosumi resolves the Takos OpenTofu module repo (Git URL / commit / module path) into an
  Installation. Metadata comes from Git and well-known OpenTofu outputs.
- **Run** — `source_sync`, `compatibility_check`, `plan`, `apply`, `destroy_plan`, and `destroy_apply` are recorded as
  Run entries against the Installation.
- **StateSnapshot / OutputSnapshot / Deployment** — a successful `apply` type Run advances the state generation, records
  non-secret service URLs and binding maps as an OutputSnapshot, and updates the Deployment.
- **Connection / ProviderBinding / policy** — provider credentials, provider/resource allowlists, state handling, and
  runner execution limits are resolved through the Installation's per-provider (+ optional alias) bindings and policy;
  container execution details stay internal to the runner.

This gives unified deployment tracking, reviewed plans, and an audit ledger across plan / apply / destroy. Takos holds no
architectural privilege here: to Takosumi it is just one plain OpenTofu module app among others. The module being applied
is identical whether you run `tofu apply` yourself or route it through Takosumi.

## Source of truth

The OpenTofu module in [`opentofu/`](opentofu) is the source of truth for the **durable** deploy topology, whether it is
applied directly with `tofu apply` or installed and applied by Takosumi. The wrangler config
(`cloudflare/wrangler.toml`) is the **worker-artifact half** of the same deploy — the bindings, containers, routes, and
DO migrations the provider cannot declare. The two halves describe one deploy and must stay in sync; the wrangler half is not a competing source of truth
for the durable infra.

## Current Status

Direct `tofu apply` + wrangler self-host is the complete, supported path. The optional Takosumi run-ledger path has its
groundwork complete, but an end-to-end apply against a live Takosumi deploy control plane is NOT YET VALIDATED.

The OpenTofu module composes all three targets. No staging or production `apply` type Run has been driven end-to-end through a
live Takosumi instance yet; until that is validated, self-hosters use the direct `tofu apply` + wrangler path (and the
private materialization derived from it) to realize the same topology.

### Known Limitations

- No staging typed Runs have been driven end-to-end against a live Takosumi deploy control plane.
- The direct-apply wrangler materialization and the Takosumi-applied module have not yet been reconciled in a real CI
  environment.
- The render-wrangler glue (step 2) fills resource-id placeholders only; hostname vars, the Vectorize index, container
  builds, D1 migrations, and secrets remain explicit runbook steps (3–6) because the provider cannot express them.

### Next Steps (to validate the optional Takosumi path)

1. Register the Takos OpenTofu module as a Takosumi Installation with staging Connection / ProviderBinding settings.
2. Produce a `plan` type Run and review the plan.
3. Drive an `apply` type Run in staging alongside the direct wrangler materialization and compare the resulting Deployment /
   OutputSnapshot.
4. Confirm the Takosumi-applied module yields the same topology as the direct path, then monitor for one release cycle.
5. Repeat steps 1–4 for production.

## Optional-Takosumi Adoption Path

1. Create the staging Installation from the OpenTofu module repo.
2. Review a `plan` type Run in staging.
3. Run an `apply` type Run in staging alongside the direct wrangler materialization and compare the Deployment /
   OutputSnapshot.
4. Adopt the Takosumi-applied module as the staging materialization once the outputs match.
5. Repeat for production.
