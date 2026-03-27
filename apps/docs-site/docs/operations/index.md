# 運用モデル

Takos の tracked config と operator 導線は、現在は次の 3 面で整理するのが安全です。

## 1. local stack

- 正本 template: `.env.local.example`
- 起動: `corepack pnpm local:up`
- 検証: `corepack pnpm local:smoke`, `corepack pnpm local:proxyless-smoke`

local は単なる UI preview ではなく、control plane と runtime contract の再現環境です。

## 2. Cloudflare deploy

Cloudflare 側の tracked template は control deployment template 群です。

- `wrangler.toml`
- `wrangler.dispatch.toml`
- `wrangler.worker.toml`
- `wrangler.runtime-host.toml`
- `wrangler.executor.toml`
- `wrangler.browser-host.toml`
- `apps/control/.env.self-host.example` (Cloudflare worker vars/secrets の template)
- `secret 管理コマンド (`scripts/admin/` 配下)` (secret 管理コマンド)

この面が current production/staging deploy の primary contract です。

## 3. self-host / local-platform

self-host 系の正本は local-platform entrypoint と Helm chart です。

- entrypoints: `pnpm -C apps/control dev:local:*`
- env template: `control self-host env example`
- chart: Helm chart

ここでは Postgres / Redis / S3-compatible storage / browser-executor-runtime services を operator が用意する前提です。

## tracked config の扱い

repo に含まれる tracked config はすべて **template** です。実運用では必ず次を置き換えてください。

- domain / callback URL
- Cloudflare account/zone/database IDs
- bucket / queue / vector index 名
- OAuth / Stripe / provider secret

## operator が確認するもの

- app deployment status
- rollout state
- custom domain / hostname state
- notification / run stream
- local smoke と proxyless smoke
