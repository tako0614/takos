# セルフホスト

Takos をセルフホスト環境で実行する方法。

## 必要なもの

- Docker + Docker Compose V2
- PostgreSQL（pgvector 対応が望ましい）
- Redis
- MinIO（S3 互換ストレージ）

## セットアップ

### 1. 環境変数を準備

```bash
cp .env.local.example .env.local
```

主要な環境変数:

| 変数 | 用途 |
| --- | --- |
| `DATABASE_URL` / `POSTGRES_URL` | PostgreSQL 接続先 |
| `REDIS_URL` | Redis 接続先 |
| `TAKOS_LOCAL_*` | ローカルプラットフォーム設定 |
| `OCI_ORCHESTRATOR_*` | コンテナオーケストレーター設定 |

S3 互換ストレージ:

| 変数 | 用途 |
| --- | --- |
| S3 endpoint / access key / secret key | MinIO 等の接続情報 |

### 2. compose を使わない場合

`apps/control/.env.self-host.example` を参考にする。

```bash
cp apps/control/.env.self-host.example apps/control/.env
```

## 起動

### Docker Compose

```bash
pnpm local:up
```

バックグラウンドで起動する場合:

```bash
docker compose --env-file .env.local -f compose.local.yml up --build -d
```

### 主要サービス

| サービス | 役割 |
| --- | --- |
| `control-web` | Web / API |
| `control-dispatch` | テナントリクエストのルーティング |
| `control-worker` | バックグラウンドジョブ |
| `runtime-host` / `runtime` | テナントランタイム |
| `executor-host` / `executor` | エージェント実行 |
| `browser-host` / `browser` | ブラウザ自動化 |
| `postgres` / `redis` / `minio` | インフラ backing services |

### 個別起動

compose を使わずに個別に起動する場合:

```bash
pnpm -C apps/control dev:local:web
pnpm -C apps/control dev:local:dispatch
pnpm -C apps/control dev:local:worker
```

## 停止

```bash
pnpm local:down
```

## ログ確認

```bash
pnpm local:logs
```

## スモークテスト

```bash
pnpm local:smoke              # 全体の疎通確認
pnpm local:proxyless-smoke    # CF 固有 path の逆流チェック
```

## Helm / Kubernetes

Helm chart が `deploy/helm/takos/` に用意されている。

```bash
helm install takos deploy/helm/takos/ -f values.yaml
```

各サービスは local-platform contract で動作する。

## Vectorize 対応

セルフホストで vectorize binding を使う場合は PostgreSQL + pgvector が必要。

```bash
# 環境変数で有効化
POSTGRES_URL=postgresql://...
PGVECTOR_ENABLED=true
```

未設定の場合、vectorize binding を使う Worker の起動時にエラーになる。

## 次に読むページ

- [ローカル開発](/hosting/local) --- 開発用のローカル環境
- [環境ごとの差異](/hosting/differences) --- Cloudflare との違い
- [Cloudflare](/hosting/cloudflare) --- Cloudflare にデプロイする場合
