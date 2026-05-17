# Production deploy to Cloudflare (takosumi.com / cloud.takosumi.com)

The local-substrate mirrors production using `.test` TLDs:

| Production                                 | Local mirror                        | Backend                                                                     |
| ------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------- |
| `https://takosumi.com/`                    | `https://takosumi.test/`            | Cloudflare Pages (prod) / Caddy file_server (local)                         |
| `https://cloud.takosumi.com/`              | `https://cloud.takosumi.test/`      | Accounts Cloudflare Worker + D1 + R2 (prod) / Miniflare + SQLite/R2 (local) |
| operator-selected Takosumi kernel hostname | `https://kernel-worker.takos.test/` | Takosumi kernel Worker + D1/R2/Queues/DO (prod) / Miniflare local binds     |

Once the local mirror passes `scripts/smoke.sh`, follow this runbook to push the same artifacts to real Cloudflare. The
Worker code is byte-for- byte identical; only DNS / binding IDs / secrets differ.

## Prerequisites

1. **Domain ownership**: `takosumi.com` registered, DNS delegated to Cloudflare nameservers.
2. **Cloudflare account** with the `takosumi.com` zone added.
3. **API token** with: `Workers Scripts:Edit`, `Workers Routes:Edit`, `D1:Edit`, `R2:Edit`, `Queues:Edit`, `Pages:Edit`,
   `DNS:Edit` for `takosumi.com`.
4. **wrangler** installed (`npm install -g wrangler` or `npx wrangler`).
5. **Logged in**: `wrangler login` once.

## Step 1 — takosumi-cloud Worker (cloud.takosumi.com)

```sh
cd takosumi-cloud/

# Create D1 database and capture the UUID it returns.
wrangler d1 create takosumi-cloud-accounts
# → "database_id": "abcd1234-..."
# Paste the UUID into deploy/cloudflare/wrangler.toml's [[d1_databases]]
# database_id field, replacing the all-zeros placeholder.

# Create the R2 bucket for metadata-only AppInstallation export artifacts.
wrangler r2 bucket create takosumi-cloud-accounts-exports

# Push secrets (interactive prompts).
wrangler secret put TAKOSUMI_ACCOUNTS_ES256_PRIVATE_JWK    --config deploy/cloudflare/wrangler.toml
wrangler secret put TAKOSUMI_ACCOUNTS_OIDC_PAIRWISE_SUBJECT_SECRET --config deploy/cloudflare/wrangler.toml
wrangler secret put TAKOSUMI_ACCOUNTS_LAUNCH_TOKEN_PAIRWISE_SECRET --config deploy/cloudflare/wrangler.toml
wrangler secret put TAKOSUMI_ACCOUNTS_EXPORT_DOWNLOAD_SECRET --config deploy/cloudflare/wrangler.toml
# (Stripe / upstream OIDC / passkey secrets if used)

# Deploy.
wrangler deploy --config deploy/cloudflare/wrangler.toml
```

The `[[routes]]` block in `wrangler.toml` already maps `cloud.takosumi.com/*` to this Worker. Cloudflare auto-creates
the DNS record on first deploy as long as the zone is in your account.

Verify:

```sh
curl https://cloud.takosumi.com/.well-known/openid-configuration
```

## Step 2 — Takosumi kernel Worker

The Takosumi kernel Worker is owned by `takosumi/deploy/cloudflare/`. It is Worker-first and uses Cloudflare bindings
directly: D1 for kernel snapshots / public deployment stores, R2 for artifacts, Queues for enqueue, and Durable Objects
for coordination.

```sh
cd takosumi/

# Create backing resources and paste returned identifiers into deploy/cloudflare/wrangler.toml.
wrangler d1 create takosumi
wrangler r2 bucket create takos-artifacts
wrangler queues create takosumi-control-plane
wrangler queues create takosumi-control-plane-dlq

# Push operator secrets.
wrangler secret put TAKOSUMI_DEPLOY_TOKEN --config deploy/cloudflare/wrangler.toml
wrangler secret put TAKOSUMI_INTERNAL_API_SECRET --config deploy/cloudflare/wrangler.toml
wrangler secret put TAKOSUMI_SECRET_STORE_PASSPHRASE --config deploy/cloudflare/wrangler.toml

# Optional if provider apply should call a runtime-agent from the Worker.
wrangler secret put TAKOSUMI_AGENT_TOKEN --config deploy/cloudflare/wrangler.toml

# Deploy.
wrangler deploy --config deploy/cloudflare/wrangler.toml
```

Add the operator-owned route or custom domain for the kernel Worker in Cloudflare after choosing the public/private API
hostname. The local-substrate intentionally exposes the mirror as `kernel-worker.takos.test` so it can be checked beside
the default Deno+Postgres kernel at `kernel.takos.test`.

Verify:

```sh
curl https://<kernel-host>/healthz
curl https://<kernel-host>/storage/healthz
curl https://<kernel-host>/coordination/healthz
curl -X POST -H "Content-Type: application/json" \
  -d '{"kind":"smoke"}' \
  https://<kernel-host>/queue/test
```

## Step 3 — takosumi docs (takosumi.com via Cloudflare Pages)

The VitePress site at `takosumi/docs/` builds to `.vitepress/dist/`. Cloudflare Pages serves static files cheaply.

Option A — connect Pages to the takosumi repo (recommended for CI):

1. Cloudflare dashboard → Pages → Create Project → Connect to Git.
2. Build settings:
   - Build command: `npm run build`
   - Build output directory: `docs/.vitepress/dist`
   - Root directory: `docs/`
3. Custom domain: `takosumi.com` (apex). Pages provisions cert.

Option B — `wrangler pages deploy` (one-shot from your laptop):

```sh
cd takosumi/docs
npm install
npm run build
wrangler pages deploy .vitepress/dist --project-name takosumi-docs
# Then in dashboard, add takosumi.com as custom domain.
```

Verify:

```sh
curl -I https://takosumi.com/
# 200 OK, content-type: text/html
```

## Step 4 — DNS sanity

In the `takosumi.com` Cloudflare zone you should now have:

| Type              | Name                     | Target                         | Proxied                                                                                      |
| ----------------- | ------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------- |
| `A` / Pages route | `@` (takosumi.com)       | (managed by Pages)             | yes                                                                                          |
| Worker route      | `cloud.takosumi.com`     | takosumi-cloud-accounts Worker | (no DNS record needed for `*.com/*` Worker routes — Cloudflare matches on the route pattern) |
| Worker route      | operator kernel hostname | takosumi kernel Worker         | choose operator-owned public/private hostname and route policy                               |

If using a separate CNAME for `cloud.takosumi.com`, add it pointing anywhere — the Worker route intercepts before DNS
resolution matters.

## Rollback

```sh
# Accounts Worker
wrangler rollback --config takosumi-cloud/deploy/cloudflare/wrangler.toml

# Kernel Worker
wrangler rollback --config takosumi/deploy/cloudflare/wrangler.toml

# Pages
# Use the dashboard to redeploy a previous build.
```

## Why the local mirror is a faithful test

The local-substrate runs the **same bundled Worker files** that `wrangler deploy` ships:

```
takosumi-cloud/deploy/cloudflare/.wrangler/dist/takosumi-cloud-accounts-worker.mjs
takosumi/deploy/cloudflare/.wrangler/dist/takosumi-cloudflare-worker.mjs
```

The build containers produce them; Miniflare runs them locally with emulated D1/R2/Queues/DO bindings. The difference
between local and prod is the provider-managed binding backend and the binding / secret values. Code path is identical.

If `cloud.takosumi.test/.well-known/openid-configuration` returns 200 in local-substrate, the same Worker route should
work on `cloud.takosumi.com` only after Cloudflare-side DNS/TLS, route, D1/R2 binding IDs, and secrets are validated and
recorded as launch-readiness evidence. If
`kernel-worker.takos.test/{healthz,storage/healthz,coordination/healthz,queue/test}` passes locally, the kernel Worker
bundle has booted with the same Cloudflare binding contract that production uses.
