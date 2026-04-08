# Cloudflare

このページは **Takos kernel を Cloudflare Workers にホストする方法**を説明します。takos オペレーター向けです。Cloudflare backend は Takos runtime の基準 backend で、Cloudflare-native public spec の参照実装です。

Takos 上で app を deploy する方法は [Deploy](/deploy/) を参照してください。

::: info アプリ開発者へ
アプリ開発者向けの current surface は Cloudflare-native spec を書く `takos deploy` です。Cloudflare backend はその spec を直接実現する基準 backend で、他環境でも同じ spec を使います。
:::

## 必要なもの

- Cloudflare アカウント（Paid Workers プラン推奨）
- API トークン（後述の権限設定を参照）
- `takos-cli` がインストール済み
- `wrangler` CLI（v4 以上）

## セットアップ

### 1. API トークンを取得

Cloudflare ダッシュボードで API トークンを作成する。必要な権限:

| カテゴリ | 権限 | レベル | 用途 |
| --- | --- | --- | --- |
| Workers Scripts | Workers Scripts | 読み取り + 編集 | Worker のデプロイ・管理 |
| D1 | D1 | 読み取り + 編集 | データベースの作成・マイグレーション |
| R2 | R2 | 読み取り + 編集 | ストレージバケットの作成・管理 |
| Workers KV Storage | Workers KV Storage | 読み取り + 編集 | KV Namespace の作成・管理 |
| Account | Cloudflare Pages | 読み取り | Pages 連携（アセット配信） |
| Account | Account Settings | 読み取り | アカウント情報の取得 |

::: tip トークンのスコープ
トークンは使うアカウントだけに限定しよう。「All accounts」ではなく「Specific account」で作成すると安全。ゾーンリソースも同様に特定ゾーンに限定できる。
:::

### 2. 環境変数をセット

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_TOKEN="your-api-token"
```

アカウント ID は Cloudflare ダッシュボードの URL から取得できる。

### 3. ログイン

```bash
takos login
takos whoami
```

## リソースの手動作成

`takos deploy` は manifest に書かれたリソースを自動作成するけど、control plane 本体のリソースは事前に手動で作成する必要がある。

### D1 Database

```bash
# control plane 用のメイン DB を作成
wrangler d1 create takos-control-db

# staging 環境用
wrangler d1 create takos-control-staging-db
```

作成後に返される `database_id` を `wrangler.toml` に設定する。

### R2 Bucket

```bash
# Worker バンドル保存用
wrangler r2 bucket create takos-worker-bundles

# テナントビルド成果物
wrangler r2 bucket create takos-tenant-builds

# テナントソースコード
wrangler r2 bucket create takos-tenant-source

# Git オブジェクトストア
wrangler r2 bucket create takos-git-objects

# D1 ホットデータのオフロード先
wrangler r2 bucket create takos-offload
```

staging 環境用にはサフィックス `-staging` を付ける:

```bash
wrangler r2 bucket create takos-worker-bundles-staging
wrangler r2 bucket create takos-tenant-builds-staging
wrangler r2 bucket create takos-tenant-source-staging
wrangler r2 bucket create takos-git-objects-staging
wrangler r2 bucket create takos-offload-staging
```

### KV Namespace

```bash
# ホスト名ルーティング用
wrangler kv namespace create HOSTNAME_ROUTING
```

返される `id` を `wrangler.toml` の `[[kv_namespaces]]` セクションに設定する。

### Dispatch Namespace

テナント Worker を論理分離するための namespace:

```bash
wrangler dispatch-namespace create takos-staging-tenants
wrangler dispatch-namespace create takos-production-tenants
```

### Queue

```bash
# Agent Run 実行キュー
wrangler queues create takos-runs

# Index ジョブ（embeddings / graph 更新）
wrangler queues create takos-index-jobs

# ワークフロー実行キュー
wrangler queues create takos-workflow-jobs

# デプロイジョブ実行キュー
wrangler queues create takos-deployment-jobs
```

### Vectorize

```bash
wrangler vectorize create takos-embeddings \
  --dimensions 1536 \
  --metric cosine
```

## wrangler.toml の設定例

以下は実際の staging 設定をベースにした例。シークレットは除いてある。

```toml
name = "takos"
main = "src/web.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat", "no_handle_cross_request_promise_resolution"]

[observability]
enabled = true

[vars]
ADMIN_DOMAIN = "admin.example.com"
TENANT_BASE_DOMAIN = "app.example.com"
GOOGLE_CLIENT_ID = "your-google-client-id.apps.googleusercontent.com"
ROUTING_DO_PHASE = "4"
WFP_DISPATCH_NAMESPACE = "your-dispatch-namespace"
CF_ACCOUNT_ID = "replace-with-account-id"
CF_ZONE_ID = "replace-with-zone-id"

[triggers]
crons = ["3,18,33,48 * * * *", "5 * * * *"]

# Static assets（Worker 経由でホスト名ベースルーティング）
[assets]
directory = "./dist"
binding = "ASSETS"
run_worker_first = true

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "takos-control-db"
database_id = "replace-with-d1-database-id"
migrations_dir = "db/migrations"

# KV（ホスト名ルーティング用）
[[kv_namespaces]]
binding = "HOSTNAME_ROUTING"
id = "replace-with-kv-namespace-id"

# Durable Objects
[[durable_objects.bindings]]
name = "SESSION_DO"
class_name = "SessionDO"

[[durable_objects.bindings]]
name = "RUN_NOTIFIER"
class_name = "RunNotifierDO"

[[durable_objects.bindings]]
name = "NOTIFICATION_NOTIFIER"
class_name = "NotificationNotifierDO"

[[durable_objects.bindings]]
name = "RATE_LIMITER_DO"
class_name = "RateLimiterDO"

[[durable_objects.bindings]]
name = "ROUTING_DO"
class_name = "RoutingDO"

[[durable_objects.bindings]]
name = "GIT_PUSH_LOCK"
class_name = "GitPushLockDO"

# R2 Buckets
[[r2_buckets]]
binding = "WORKER_BUNDLES"
bucket_name = "takos-worker-bundles"

[[r2_buckets]]
binding = "TENANT_BUILDS"
bucket_name = "takos-tenant-builds"

[[r2_buckets]]
binding = "TENANT_SOURCE"
bucket_name = "takos-tenant-source"

[[r2_buckets]]
binding = "GIT_OBJECTS"
bucket_name = "takos-git-objects"

[[r2_buckets]]
binding = "TAKOS_OFFLOAD"
bucket_name = "takos-offload"

# Queue producers
[[queues.producers]]
queue = "takos-runs"
binding = "RUN_QUEUE"

[[queues.producers]]
queue = "takos-index-jobs"
binding = "INDEX_QUEUE"

[[queues.producers]]
queue = "takos-workflow-jobs"
binding = "WORKFLOW_QUEUE"

[[queues.producers]]
queue = "takos-deployment-jobs"
binding = "DEPLOY_QUEUE"

# Vectorize（semantic search）
[[vectorize]]
binding = "VECTORIZE"
index_name = "takos-embeddings"

# AI（embeddings 生成）
[ai]
binding = "AI"

# Browser rendering（Puppeteer）
[browser]
binding = "BROWSER"

# Internal service bindings
[[services]]
binding = "TAKOS_EGRESS"
service = "takos-worker"

[[services]]
binding = "RUNTIME_HOST"
service = "takos-runtime-host"
```

### Secrets の設定

以下のシークレットは `wrangler secret put` で設定する:

```bash
# Google OAuth
wrangler secret put GOOGLE_CLIENT_SECRET

# プラットフォーム署名鍵
wrangler secret put PLATFORM_PRIVATE_KEY
wrangler secret put PLATFORM_PUBLIC_KEY

# Common-env 暗号化鍵 (32 byte base64) — 起動時 required
wrangler secret put ENCRYPTION_KEY

# Cloudflare API トークン（Worker 管理用）
wrangler secret put CF_API_TOKEN
```

### staging 環境

staging 環境用の設定は `[env.staging]` セクションで定義する:

```toml
[env.staging]
name = "takos-staging"
workers_dev = true

[env.staging.vars]
ADMIN_DOMAIN = "test.takos.jp"
TENANT_BASE_DOMAIN = "app.test.takos.jp"
ROUTING_DO_PHASE = "4"
# ... 他の環境固有の設定
```

staging 用の secrets は `--env staging` を付けて設定:

```bash
wrangler secret put GOOGLE_CLIENT_SECRET --env staging
```

## Takos kernel のデプロイ

Takos kernel 本体を Cloudflare に deploy する:

```bash
deno task deploy --env staging
```

production:

```bash
deno task deploy --env production
```

::: info アプリの deploy とは別です
ここでの deploy は Takos kernel 自体の deploy です。Takos 上で動く app の
deploy は `takos deploy` を使い、[Deploy](/deploy/) を参照してください。
:::

## Dispatch Namespace

テナントごとに worker を論理分離するための Cloudflare 側の仕組み。Takos kernel
をホストする際に operator が事前に作成する必要があります。

namespace の作成:

```bash
wrangler dispatch-namespace create my-namespace
```

app 開発者は namespace を意識する必要はありません（manifest / group で記述し、
kernel が内部で dispatch namespace に materialize します）。

## Durable Objects

control plane が使う Durable Objects:

| DO クラス | 用途 |
| --- | --- |
| `SessionDO` | ユーザーセッション管理（SQLite-backed） |
| `RunNotifierDO` | Run イベントのリアルタイム通知 |
| `NotificationNotifierDO` | 通知のリアルタイム配信 |
| `RateLimiterDO` | 分散レートリミッタ |
| `RoutingDO` | ホスト名ベースルーティング |
| `GitPushLockDO` | Git push のロック管理 |

Cloudflare backend は Durable Objects の基準 backend です。セルフホスト・ローカルなどの互換 backend では、Takos durable runtime が同じ Cloudflare-native contract を実現します。ただし orchestration や性能特性は Cloudflare backend と byte-for-byte 同一ではありません。

## Cloudflare 固有の環境変数

control plane を Cloudflare にデプロイする場合に使う主要な環境変数:

| 変数 | 用途 |
| --- | --- |
| `ADMIN_DOMAIN` | 管理ドメイン |
| `TENANT_BASE_DOMAIN` | テナント用ベースドメイン |
| `CF_ACCOUNT_ID` | Cloudflare アカウント ID（CLI では `CLOUDFLARE_ACCOUNT_ID` を推奨） |
| `CF_ZONE_ID` | DNS ゾーン ID |
| `WFP_DISPATCH_NAMESPACE` | dispatch namespace 名 |
| `ROUTING_DO_PHASE` | RoutingDO rollout phase。詳細は下記 [Routing phases](#routing-phases) |
| `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` | プラットフォーム署名鍵 |
| `STRIPE_*` | Stripe 決済連携 |

認証系:

| 変数 | 用途 |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` | AI プロバイダ |

## Cloudflare 固有の機能

Cloudflare backend で `native` に解決される機能。他環境では `compatible` な実装に解決される。

### Durable Objects

control plane のステート管理に使われる。Cloudflare では `native`、他環境では `compatible` な PostgreSQL / Redis ベース実装で解決される。

| DO クラス | 用途 | 他環境での `compatible` 実装 |
| --- | --- | --- |
| `SessionDO` | ユーザーセッション管理 | PostgreSQL / Redis |
| `RunNotifierDO` | Run イベントのリアルタイム通知 | ポーリングベース |
| `NotificationNotifierDO` | 通知のリアルタイム配信 | ポーリングベース |
| `RateLimiterDO` | 分散レートリミッタ | Redis ベース |
| `RoutingDO` | ホスト名ベースルーティング | PostgreSQL + キャッシュ |
| `GitPushLockDO` | Git push のロック管理 | PostgreSQL advisory lock |

### Container workloads

image-backed `services` / `containers` は Cloudflare backend でも current
実装では OCI deployment adapter を通る。他環境では `compatible` な ECS / Cloud Run / k8s /
Docker などの provider-aware adapter で解決する。

### Dispatch Namespace

テナント Worker を論理分離する Cloudflare の仕組み。他環境では `compatible` な Takos runtime-host に直接 dispatch される。

### Routing phases

`ROUTING_DO_PHASE` (`packages/control/src/application/services/routing/phase.ts`)
は hostname → service routing の data source rollout を gradual に切り替える
ための feature flag。値は `1`-`4` のいずれかで、production は **`4`**、
新規環境の bootstrap は `1` から始めて段階的に進める想定。

| phase | 読み取り primary | 書き込み primary | 補足 |
| --- | --- | --- | --- |
| `1` | KV のみ | KV のみ (DO は best-effort backfill) | 旧経路。L1 cache 無し |
| `2` | DO verify (KV と差分検出時は KV refresh) | KV + DO 並行 | DO 移行中の dual-write |
| `3` | L1 cache → DO primary, KV は L2 cache | DO 必須 | DO が unavailable なら stale KV へ fallback |
| `4` | phase 3 + KV TTL (`L2_KV_TTL_SECONDS`) | DO 必須 + KV expirationTtl | 通常の本番設定 |

`takos-dispatch` worker (`apps/control/wrangler.dispatch.toml`) と
control-plane worker (`apps/control/wrangler.toml`) で同じ値を設定すること。
phase を下げる方向の rollback はサポートされる (KV/DO 双方が更新されているため)
が、phase 1 から phase 3 以上へ jumping すると DO が空のため routing が壊れる。
順次進めること。

### Analytics Engine

構造化ログ・メトリクスの書き込みを `native` に解決する。他環境では `compatible` な Takos analytics runtime で同じ write API を実現する。

### Browser Rendering

Puppeteer binding による Workers 内ブラウザ操作。他環境では browser-service コンテナで代替する。

### AI Binding

`@cloudflare/ai` のネイティブバインディング。他環境では OpenAI / Anthropic / Google AI の API を直接呼ぶ。

### Workflows

CF Workflows ベースのワークフロー実行。他環境では Takos-managed runner で代替する。

## マルチクラウド対応

takos オペレーターが takos をどのクラウドにホストするかはインストール時の設定で決まる。アプリ開発者は app.yml を書いて `takos deploy` するだけで、デプロイ先を意識する必要はない:

```bash
# アプリ開発者のコマンド（どの環境でも同じ）
takos deploy --env production
```

takos 自体を別のクラウドに移行したい場合は、オペレーターがそのクラウド用のインフラを構築して takos の設定を変更する。詳しくは [環境ごとの差異](/hosting/differences) を参照。

## 次に読むページ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [AWS](/hosting/aws) --- AWS にデプロイする場合
- [GCP](/hosting/gcp) --- GCP にデプロイする場合
- [セルフホスト](/hosting/self-hosted) --- Cloudflare を使わない場合
