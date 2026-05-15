# Production deploy to Cloudflare (takosumi.com / cloud.takosumi.com)

The local-substrate mirrors production using `.test` TLDs:

| Production | Local mirror | Backend |
|---|---|---|
| `https://takosumi.com/` | `https://takosumi.test/` | Cloudflare Pages (prod) / Caddy file_server (local) |
| `https://cloud.takosumi.com/` | `https://cloud.takosumi.test/` | Cloudflare Worker + D1 (prod) / Miniflare + SQLite (local) |

Once the local mirror passes `scripts/smoke.sh`, follow this runbook to
push the same artifacts to real Cloudflare. The Worker code is byte-for-
byte identical; only DNS / binding IDs / secrets differ.

## Prerequisites

1. **Domain ownership**: `takosumi.com` registered, DNS delegated to
   Cloudflare nameservers.
2. **Cloudflare account** with the `takosumi.com` zone added.
3. **API token** with: `Workers Scripts:Edit`, `Workers Routes:Edit`,
   `D1:Edit`, `Pages:Edit`, `DNS:Edit` for `takosumi.com`.
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

# Push secrets (interactive prompts).
wrangler secret put TAKOSUMI_ACCOUNTS_ES256_PRIVATE_JWK    --config deploy/cloudflare/wrangler.toml
wrangler secret put TAKOSUMI_ACCOUNTS_OIDC_PAIRWISE_SUBJECT_SECRET --config deploy/cloudflare/wrangler.toml
wrangler secret put TAKOSUMI_ACCOUNTS_LAUNCH_TOKEN_PAIRWISE_SECRET --config deploy/cloudflare/wrangler.toml
# (Stripe / upstream OIDC / passkey secrets if used)

# Deploy.
wrangler deploy --config deploy/cloudflare/wrangler.toml
```

The `[[routes]]` block in `wrangler.toml` already maps
`cloud.takosumi.com/*` to this Worker. Cloudflare auto-creates the DNS
record on first deploy as long as the zone is in your account.

Verify:

```sh
curl https://cloud.takosumi.com/.well-known/openid-configuration
```

## Step 2 — takosumi docs (takosumi.com via Cloudflare Pages)

The VitePress site at `takosumi/docs/` builds to `.vitepress/dist/`.
Cloudflare Pages serves static files cheaply.

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

## Step 3 — DNS sanity

In the `takosumi.com` Cloudflare zone you should now have:

| Type | Name | Target | Proxied |
|---|---|---|---|
| `A` / Pages route | `@` (takosumi.com) | (managed by Pages) | yes |
| Worker route | `cloud.takosumi.com` | takosumi-cloud-accounts Worker | (no DNS record needed for `*.com/*` Worker routes — Cloudflare matches on the route pattern) |

If using a separate CNAME for `cloud.takosumi.com`, add it pointing
anywhere — the Worker route intercepts before DNS resolution matters.

## Rollback

```sh
# Worker
wrangler rollback --config takosumi-cloud/deploy/cloudflare/wrangler.toml

# Pages
# Use the dashboard to redeploy a previous build.
```

## Why the local mirror is a faithful test

The local-substrate runs the **same bundled Worker file** that
`wrangler deploy` ships:

```
takosumi-cloud/deploy/cloudflare/.wrangler/dist/takosumi-cloud-accounts-worker.mjs
```

The build container produces it; Miniflare runs it locally with an
emulated D1 (SQLite). The difference between local and prod is the D1
backend (SQLite vs Cloudflare's distributed DB) and the bindings'
values (local issuer / client URLs). Code path is identical.

If `cloud.takosumi.test/.well-known/openid-configuration` returns 200
in local-substrate, the same endpoint at `cloud.takosumi.com` will too,
modulo Cloudflare-side configuration.
