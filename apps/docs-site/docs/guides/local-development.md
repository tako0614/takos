# ローカル開発ガイド

Takos の current local stack は Docker Compose と local-platform entrypoints の組み合わせです。

## 前提

| tool | version |
| --- | --- |
| Node.js | 20+ |
| pnpm | 9+ |
| Docker | current stable |
| Docker Compose | V2 |

## セットアップ

```bash
corepack pnpm install
cp .env.local.example .env.local
```

`.env.local.example` が compose/local stack の正本 template です。

## compose で全部起動する

```bash
corepack pnpm local:up
corepack pnpm local:logs
corepack pnpm local:down
```

`local:up` は foreground で起動します。バックグラウンドにしたい場合は `docker compose --env-file .env.local -f compose.local.yml up --build -d` を使います。

## smoke

```bash
corepack pnpm local:smoke
corepack pnpm local:proxyless-smoke
```

- `local:smoke`: local stack 全体の疎通
- `local:proxyless-smoke`: Cloudflare 固有 path が local runtime に逆流していないかを確認

## compose の主要サービス

| service | role |
| --- | --- |
| `control-web` | web/API worker |
| `control-dispatch` | tenant dispatch |
| `control-worker` | background worker |
| `runtime-host` | runtime host |
| `executor-host` | executor host |
| `browser-host` | browser host |
| `runtime` | tenant runtime container |
| `executor` | agent executor container |
| `browser` | browser automation container |
| `postgres` / `redis` / `minio` | self-host 相当の infra backing services |
| `oci-orchestrator` | local container orchestration helper |

## 手動で個別起動する場合

`apps/control` には local-platform entrypoint script が揃っています。

```bash
corepack pnpm -C apps/control dev:local:web
corepack pnpm -C apps/control dev:local:dispatch
corepack pnpm -C apps/control dev:local:worker
corepack pnpm -C apps/control dev:local:runtime-host
corepack pnpm -C apps/control dev:local:executor-host
corepack pnpm -C apps/control dev:local:browser-host
corepack pnpm -C apps/control dev:local:oci-orchestrator
```

compose を使わず manual に構成したい場合は `apps/control/.env.self-host.example` を starting point にしつつ、実際の env contract は `TAKOS_LOCAL_*` と `OCI_ORCHESTRATOR_*` を優先してください。

## local での既知差分

local runtime は Workers-compatible を目指しますが、provider 実体まで完全一致ではありません。既知差分は [互換性と制限](../architecture/compatibility-and-limitations.md) を参照してください。
