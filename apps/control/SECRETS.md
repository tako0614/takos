# Takos OSS Deployment Template - Secrets Configuration

This document describes the current secret contract for the tracked Cloudflare deployment templates in `apps/control`.

Secrets are managed with `wrangler secret put`. Non-secret configuration belongs in `wrangler*.toml` `[vars]` / `[env.*.vars]`.

## Worker mapping

Use `--config` to target the correct worker template.

| Script name | Config | Responsibility |
| --- | --- | --- |
| `takos` / `takos-staging` | `wrangler.toml` | web/API worker, auth, setup, billing webhook, cron |
| `takos-dispatch` | `wrangler.dispatch.toml` | tenant hostname dispatch |
| `takos-worker` | `wrangler.worker.toml` | background queues, egress, recovery cron |
| `takos-runtime-host` | `wrangler.runtime-host.toml` | runtime container host |
| `takos-executor-host` | `wrangler.executor.toml` | executor container host |
| `takos-browser-host` | `wrangler.browser-host.toml` | browser container host |

## Quick examples

```bash
wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.toml --env production
wrangler secret put OPENAI_API_KEY --config wrangler.worker.toml --env staging
wrangler secret put ENCRYPTION_KEY --config wrangler.worker.toml --env production
```

## Required / optional by worker

### `wrangler.toml`

Required secrets:

- `GOOGLE_CLIENT_SECRET`
- `PLATFORM_PRIVATE_KEY`
- `PLATFORM_PUBLIC_KEY`
- `ENCRYPTION_KEY`

Required when Cloudflare management is enabled:

- `CF_API_TOKEN`

Optional:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TURNSTILE_SECRET_KEY`
- `OPENAI_API_KEY`
- `SERPER_API_KEY`
- `AUDIT_IP_HASH_KEY`

Primary non-secret vars:

- `ADMIN_DOMAIN`
- `TENANT_BASE_DOMAIN`
- `GOOGLE_CLIENT_ID`
- `CF_ACCOUNT_ID`
- `CF_ZONE_ID`
- `WFP_DISPATCH_NAMESPACE`
- `STRIPE_PLUS_PRICE_ID`
- `STRIPE_PRO_TOPUP_PACKS_JSON`

### `wrangler.dispatch.toml`

Required secrets:

- none

Primary non-secret vars:

- `ADMIN_DOMAIN`
- `ROUTING_DO_PHASE`

### `wrangler.worker.toml`

Required secrets:

- `ENCRYPTION_KEY`

Required for agent functionality:

- at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`

Optional:

- `SERPER_API_KEY`
- `CF_API_TOKEN`

Primary non-secret vars:

- `ADMIN_DOMAIN`
- `TENANT_BASE_DOMAIN`
- `CF_ACCOUNT_ID`
- `CF_ZONE_ID`
- `WFP_DISPATCH_NAMESPACE`

### `wrangler.runtime-host.toml`

Required secrets:

- none

Optional:

- `JWT_PUBLIC_KEY`

Primary non-secret vars:

- `ADMIN_DOMAIN`
- `PROXY_BASE_URL`

### `wrangler.executor.toml`

Required secrets:

- none

Optional:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `EXECUTOR_PROXY_SECRET`

Primary non-secret vars:

- `ADMIN_DOMAIN`
- `CONTROL_RPC_BASE_URL`

### `wrangler.browser-host.toml`

Required secrets:

- none

Primary non-secret vars:

- `ADMIN_DOMAIN`

## Key details

### Google OAuth

```bash
wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.toml --env production
```

`GOOGLE_CLIENT_ID` is a non-secret var. The callback URL must match the deployed admin domain.

### Platform keys

```bash
openssl genrsa -out platform-private.pem 2048
openssl rsa -in platform-private.pem -pubout -out platform-public.pem

wrangler secret put PLATFORM_PRIVATE_KEY --config wrangler.toml --env production < platform-private.pem
wrangler secret put PLATFORM_PUBLIC_KEY --config wrangler.toml --env production < platform-public.pem
```

### Encryption

```bash
openssl rand -base64 32 | wrangler secret put ENCRYPTION_KEY --config wrangler.worker.toml --env production
openssl rand -base64 32 | wrangler secret put ENCRYPTION_KEY --config wrangler.toml --env production
```

Use the same key on the web/API worker and the background worker.

### Cloudflare API token

When you manage WFP/custom-domain resources from Takos itself, provision `CF_API_TOKEN`.

Minimum permissions usually include:

- Workers Scripts: Edit
- Workers Routes: Edit
- Workers for Platforms: Admin
- D1: Edit

### Billing

If billing is enabled, configure:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PLUS_PRICE_ID`
- `STRIPE_PRO_TOPUP_PACKS_JSON`

Webhook endpoint:

- `https://<admin-domain>/api/billing/webhook`

## Listing / deleting

```bash
wrangler secret list --config wrangler.toml --env production
wrangler secret delete SECRET_NAME --config wrangler.toml --env production
```
