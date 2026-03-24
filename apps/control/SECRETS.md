# Takos OSS Deployment Template - Secrets Configuration

This document describes the secret contract for the `apps/control` Cloudflare
Workers.

Secrets are managed via `wrangler secret put <name>` and must never be stored
in version control. This file is a public template, not a record of the Takos
team's live production setup.

Non-secret runtime config belongs in `wrangler*.toml` `[vars]` / `[env.staging.vars]`, not in Wrangler secrets.

## Worker Mapping

Secrets are scoped per Worker script. Use `--config` to target the right Worker.

| Worker | Config | Responsibility | Public Entry |
|---|---|---|---|
| `takos-web` | `wrangler.toml` | Admin domain (SPA + API gateway) + cron + public OAuth/OIDC provider | `admin.example.com` (and `staging-admin.example.com`) |
| `takos-dispatch` | `wrangler.dispatch.toml` | Tenant domain routing (WFP dispatch) | `*.app.example.com`, `*.staging-app.example.com` |
| `takos-worker` | `wrangler.worker.toml` | Unified background worker: run/index/workflow/deployment queues + egress proxy + cron | Queue + Service binding |
| `takos-runtime-host` | `wrangler.runtime-host.toml` | Runtime container host (CF Containers) | Service binding |
| `takos-executor` | `wrangler.executor.toml` | Agent executor container host (CF Containers) | Service binding |

## Quick Examples

```bash
# takos-worker (staging)
wrangler secret put OPENAI_API_KEY --config wrangler.worker.toml --env staging
```

Non-secret examples:

```toml
# wrangler.toml
[vars]
GOOGLE_CLIENT_ID = "your-google-client-id.apps.googleusercontent.com"

# wrangler.executor.toml
[env.staging.vars]
CONTROL_RPC_BASE_URL = "https://your-executor-staging.workers.dev"
```

## Required Secrets (By Worker)

### takos-web (`wrangler.toml`)

Required:
- `GOOGLE_CLIENT_SECRET`
- `PLATFORM_PRIVATE_KEY`
- `PLATFORM_PUBLIC_KEY`
- `CF_API_TOKEN`
- `ENCRYPTION_KEY`

Required vars:
- `GOOGLE_CLIENT_ID`

Billing (required if billing is enabled):
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Optional vars:
- `CF_ZONE_ID`
- `STRIPE_PLUS_PRICE_ID`
- `STRIPE_PRO_TOPUP_PACKS_JSON`

Optional:
- `OPENAI_API_KEY` (required for direct index rebuild/file jobs and OpenAI-backed web features)
- `SERPER_API_KEY` (only if you run web_search in the web worker)
- `TURNSTILE_SECRET_KEY` (Cloudflare Turnstile bot protection on auth endpoints; if not set, Turnstile is disabled)
- `AUDIT_IP_HASH_KEY` (if audit IP hashing is enabled)

Must not be configured:
- `HOSTED_SERVICE_SECRET`
- `SERVICE_API_KEY`
- `SERVICE_SIGNING_ACTIVE_KID`
- `SERVICE_SIGNING_KEYS`
- `YURUCOMMU_HOSTED_API_KEY`

### takos-dispatch (`wrangler.dispatch.toml`)

Required:
- none

Notes:
- `takos-dispatch` は tenant domain routing のみを担当する。
- tenant app の OAuth callback / code exchange は tenant app 自身が Takos の public `/oauth/*` endpoint を直接利用して完結させる。

### takos-worker (`wrangler.worker.toml`)

Required:
- `ENCRYPTION_KEY` (decrypting workflow secret values — must match `takos-web`)

Required (agent functionality):
- At least one LLM provider key: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` or `GOOGLE_API_KEY`

Optional:
- `SERPER_API_KEY` (web_search)
- `CF_API_TOKEN` (needed if workflow steps or agent runs must execute Cloudflare-management tools)

### takos-runtime-host (`wrangler.runtime-host.toml`)

Required:
- none (proxy auth uses DO-local random tokens; no JWT keys needed)

Optional:
- `JWT_PUBLIC_KEY` (defense-in-depth: verifies takos-control → container requests)

### takos-executor (`wrangler.executor.toml`)

Required:
- none (proxy auth uses DO-local random tokens; no JWT keys needed)

Optional:
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` (proxied to container on demand)
- `SERPER_API_KEY`

## Secret Details

### Authentication (takos-web)

| Name | Kind | Description | Required |
|------|------|-------------|----------|
| `GOOGLE_CLIENT_ID` | var | OAuth 2.0 client ID from Google Cloud Console | Yes |
| `GOOGLE_CLIENT_SECRET` | secret | OAuth 2.0 client secret from Google Cloud Console | Yes |

**Setup:**
1. Go to Google Cloud Console and create OAuth 2.0 credentials (Web application)
2. Add redirect URIs for each environment:
   - production: `https://admin.example.com/auth/callback`
   - staging: `https://staging-admin.example.com/auth/callback`

### Platform Keys (JWT Signing) (takos-web)

| Secret | Description | Required |
|--------|-------------|----------|
| `PLATFORM_PRIVATE_KEY` | RSA private key (PEM) for signing JWTs | Yes |
| `PLATFORM_PUBLIC_KEY` | RSA public key (PEM) for verifying JWTs | Yes |

```bash
openssl genrsa -out platform-private.pem 2048
openssl rsa -in platform-private.pem -pubout -out platform-public.pem

wrangler secret put PLATFORM_PRIVATE_KEY --config wrangler.toml --env production < platform-private.pem
wrangler secret put PLATFORM_PUBLIC_KEY  --config wrangler.toml --env production < platform-public.pem
```

### Cloudflare API

| Name | Kind | Description | Required |
|------|------|-------------|----------|
| `CF_API_TOKEN` | secret | Cloudflare API token for Workers management | Yes (takos-web, takos-worker) |
| `CF_ZONE_ID` | var | Cloudflare Zone ID (for custom domains) | Optional |

**CF_API_TOKEN permissions (minimum):**
- Workers Scripts: Edit
- Workers Routes: Edit
- Workers for Platforms: Admin
- D1: Edit (only if managed programmatically)

### AI Services (takos-worker)

| Secret | Description | Required |
|--------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for GPT models | At least one required |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models | At least one required |
| `GOOGLE_API_KEY` | Google AI API key for Gemini models | At least one required |
| `SERPER_API_KEY` | Serper.dev API key for web search | Optional |

### Data Encryption

| Secret | Description | Required |
|--------|-------------|----------|
| `ENCRYPTION_KEY` | 32-byte key for encrypting sensitive data | Yes (takos-web, takos-worker) |

```bash
openssl rand -base64 32 | wrangler secret put ENCRYPTION_KEY --config wrangler.toml --env production
```

### Stripe (Billing) (takos-web)

| Name | Kind | Description | Required |
|------|------|-------------|----------|
| `STRIPE_SECRET_KEY` | secret | Stripe API secret key (`sk_live_...` or `sk_test_...`) | Yes (if billing enabled) |
| `STRIPE_WEBHOOK_SECRET` | secret | Stripe webhook signing secret (`whsec_...`) | Yes (if billing enabled) |
| `STRIPE_PLUS_PRICE_ID` | var | Stripe Plus subscription Price ID (`price_...`) | Yes (if billing enabled) |
| `STRIPE_PRO_TOPUP_PACKS_JSON` | var | JSON catalog for Pro top-up packs | Yes (if billing enabled) |

Webhook endpoint:
- production: `https://admin.example.com/api/billing/webhook`

### Turnstile (Bot Protection) (takos-web)

| Secret | Description | Required |
|--------|-------------|----------|
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key for bot protection on auth endpoints | No (if not set, Turnstile verification is skipped) |

**Setup:**
1. Go to Cloudflare Dashboard > Turnstile and create a site widget
2. Copy the secret key

```bash
wrangler secret put TURNSTILE_SECRET_KEY --config wrangler.toml --env production
```

## Listing / Deleting Secrets

```bash
wrangler secret list --config wrangler.toml --env production
wrangler secret delete SECRET_NAME --config wrangler.toml --env production
```
