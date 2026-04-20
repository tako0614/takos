# Takos OSS Deployment Template - Secrets Configuration

This document describes the current secret contract for the tracked Cloudflare
deployment templates in `apps/control`. It is the reference for the OSS template
and local/self-host operators. Production and staging secret operations are
centralized in `takos-private/`.

Within the tracked template, secrets are managed with `wrangler secret put`.
Non-secret configuration belongs in `wrangler*.toml` `[vars]` / `[env.*.vars]`.

## Worker mapping

Use `--config` to target the correct worker template.

| Script name               | Config                       | Responsibility                                     |
| ------------------------- | ---------------------------- | -------------------------------------------------- |
| `takos` / `takos-staging` | `wrangler.toml`              | web/API worker, auth, setup, billing webhook, cron |
| `takos-dispatch`          | `wrangler.dispatch.toml`     | tenant hostname dispatch                           |
| `takos-worker`            | `wrangler.worker.toml`       | background queues, egress, recovery cron           |
| `takos-runtime-host`      | `wrangler.runtime-host.toml` | runtime container host                             |
| `takos-executor-host`     | `wrangler.executor.toml`     | executor container host                            |

## Quick examples

Examples for the tracked template or local/self-host environments only.

```bash
wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.toml
wrangler secret put OPENAI_API_KEY --config wrangler.worker.toml --env staging
wrangler secret put ENCRYPTION_KEY --config wrangler.worker.toml
wrangler secret put PLATFORM_PUBLIC_KEY --config wrangler.runtime-host.toml < platform-public.pem
wrangler secret put EXECUTOR_PROXY_SECRET --config wrangler.toml
wrangler secret put EXECUTOR_PROXY_SECRET --config wrangler.executor.toml
```

## Required / optional by worker

### `wrangler.toml`

Required secrets:

- `GOOGLE_CLIENT_SECRET`
- `PLATFORM_PRIVATE_KEY`
- `PLATFORM_PUBLIC_KEY`
- `ENCRYPTION_KEY`
- `EXECUTOR_PROXY_SECRET`

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
- `PLATFORM_PRIVATE_KEY`
- `PLATFORM_PUBLIC_KEY`

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

- `PLATFORM_PUBLIC_KEY`

Optional:

- `JWT_PUBLIC_KEY` compatibility override. If set, it must match
  `PLATFORM_PUBLIC_KEY`.

Primary non-secret vars:

- `ADMIN_DOMAIN`
- `PROXY_BASE_URL`

### `wrangler.executor.toml`

Required secrets:

- `EXECUTOR_PROXY_SECRET`

Primary non-secret vars:

- `ADMIN_DOMAIN`
- `CONTROL_RPC_BASE_URL`

## Key details

### Google OAuth

```bash
wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.toml
```

`GOOGLE_CLIENT_ID` is a non-secret var. The callback URL must match the deployed
admin domain.

### Platform keys

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out platform-private.pem
openssl rsa -in platform-private.pem -pubout -out platform-public.pem

wrangler secret put PLATFORM_PRIVATE_KEY --config wrangler.toml < platform-private.pem
wrangler secret put PLATFORM_PUBLIC_KEY --config wrangler.toml < platform-public.pem
wrangler secret put PLATFORM_PRIVATE_KEY --config wrangler.worker.toml < platform-private.pem
wrangler secret put PLATFORM_PUBLIC_KEY --config wrangler.worker.toml < platform-public.pem
wrangler secret put PLATFORM_PUBLIC_KEY --config wrangler.runtime-host.toml < platform-public.pem
```

`PLATFORM_PRIVATE_KEY` is the only private key used to sign runtime-service
JWTs. `takos-runtime-host` passes its `PLATFORM_PUBLIC_KEY` to the runtime
container as `JWT_PUBLIC_KEY`; do not configure a separate `JWT_PRIVATE_KEY`.

### Encryption

```bash
openssl rand -base64 32 | wrangler secret put ENCRYPTION_KEY --config wrangler.worker.toml
openssl rand -base64 32 | wrangler secret put ENCRYPTION_KEY --config wrangler.toml
```

Use the same key on the web/API worker and the background worker.

### Executor RPC

```bash
secret="$(openssl rand -base64 32)"
printf "%s" "$secret" | wrangler secret put EXECUTOR_PROXY_SECRET --config wrangler.toml
printf "%s" "$secret" | wrangler secret put EXECUTOR_PROXY_SECRET --config wrangler.executor.toml
```

Use the same `EXECUTOR_PROXY_SECRET` value on the main `takos` worker and
`takos-executor-host`. The executor-host does not keep LLM provider API keys; it
forwards authenticated control RPC to the main worker through `TAKOS_CONTROL`.

### Cloudflare API token

When you manage WFP/custom-domain resources from Takos itself, provision
`CF_API_TOKEN`.

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

Use the same `takos-private/` caveat for private production and staging
operations.

```bash
wrangler secret list --config wrangler.toml
wrangler secret delete SECRET_NAME --config wrangler.toml
```
