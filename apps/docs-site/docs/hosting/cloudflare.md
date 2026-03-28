# Cloudflare

Takos を Cloudflare Workers にデプロイする方法。

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

`deploy-group` は manifest に書かれたリソースを自動作成するけど、control plane 本体のリソースは事前に手動で作成する必要がある。

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
binding = "TAKOS_DISPATCH"
service = "takos-dispatch"

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

## デプロイ

```bash
takos deploy-group --env staging
```

production にデプロイする場合:

```bash
takos deploy-group --env production
```

デプロイの詳細は [deploy-group](/deploy/deploy-group) を参照。

## Workers

Takos アプリの中核。V8 isolate 上で動く軽量な HTTP ハンドラ。

- `.takos/app.yml` の `workers` セクションで定義
- `deploy-group` が wrangler.toml を自動生成してデプロイ
- リソース binding は manifest から自動注入

詳しくは [Workers](/apps/workers) を参照。

## CF Containers

Docker コンテナを Cloudflare 上で実行する仕組み。Worker の Durable Object として動作する。

```yaml
containers:
  browser:
    dockerfile: packages/browser-service/Dockerfile
    port: 8080
    instanceType: standard-2
    maxInstances: 25

workers:
  browser-host:
    containers: [browser]
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-browser-host
        artifact: browser-host
        artifactPath: dist/browser-host.js
```

`deploy-group` が以下を自動生成する:

1. Durable Object ホストクラス（`@cloudflare/containers` の `Container` を extends）
2. wrangler.toml の `[[containers]]` セクション
3. `[[durable_objects.bindings]]` セクション
4. `[[migrations]]` セクション

### CF Containers の制限事項

| 制約 | 詳細 |
| --- | --- |
| 利用可能リージョン | Cloudflare が自動選択（ユーザーは指定不可） |
| instanceType | `basic`、`standard-2` などが利用可能 |
| 最大インスタンス数 | `maxInstances` で制限可能（プランによる上限あり） |
| IPv4 | `services` セクション（常設コンテナ）で `ipv4: true` を使用可能。CF Containers では不可 |
| コンテナサイズ | Cloudflare のイメージサイズ上限に準拠 |
| Cloudflare provider では canary 不可 | container-image deploy では canary strategy が使えない |
| Worker bindings 非対応 | container runtime には Workers bindings が inject されない |

詳しくは [Containers](/apps/containers) を参照。

## D1 / R2 / KV

`resources` セクションで宣言すると、`deploy-group` が自動で作成・binding する。

```yaml
resources:
  primary-db:
    type: d1
    binding: DB
    migrations:
      up: .takos/migrations/primary-db/up
      down: .takos/migrations/primary-db/down
  assets:
    type: r2
    binding: ASSETS
  cache:
    type: kv
    binding: CACHE
```

<div v-pre>

デプロイ後のリソース命名規則:

| リソース | 命名規則 |
| --- | --- |
| D1 | `{groupName}-{env}-{resourceName}` |
| R2 | `{groupName}-{env}-{resourceName}` |
| KV | `{groupName}-{env}-{resourceName}` |

</div>

既存リソースがある場合は再利用される。

## Dispatch Namespace

テナントごとに Worker を論理分離するための仕組み。

```bash
takos deploy-group --env production --namespace production-tenants --group tenant-a
```

- `--namespace` で dispatch namespace にデプロイ
- `--group` で Worker 名のプレフィックスを変更
- namespace 内の Worker は dispatcher Worker 経由でアクセス

namespace の作成は事前に行う必要がある:

```bash
wrangler dispatch-namespace create my-namespace
```

詳しくは [Dispatch Namespace](/deploy/namespaces) を参照。

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

Durable Objects は Cloudflare 環境でのみ完全動作する。セルフホスト・ローカルでは未対応。

## Cloudflare 固有の環境変数

control plane を Cloudflare にデプロイする場合に使う主要な環境変数:

| 変数 | 用途 |
| --- | --- |
| `ADMIN_DOMAIN` | 管理ドメイン |
| `TENANT_BASE_DOMAIN` | テナント用ベースドメイン |
| `CF_ACCOUNT_ID` | Cloudflare アカウント ID（CLI では `CLOUDFLARE_ACCOUNT_ID` を推奨） |
| `CF_ZONE_ID` | DNS ゾーン ID |
| `WFP_DISPATCH_NAMESPACE` | dispatch namespace 名 |
| `ROUTING_DO_PHASE` | RoutingDO rollout phase（`1`-`4`、本番は `4`） |
| `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` | プラットフォーム署名鍵 |
| `STRIPE_*` | Stripe 決済連携 |

認証系:

| 変数 | 用途 |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` | AI プロバイダ |

## Cloudflare 固有の機能

Cloudflare 環境でのみ利用できる機能。これらは他の環境（AWS / GCP / セルフホスト）では使えないか、代替メカニズムが使われる。

### Durable Objects

control plane のステート管理に使われる。他環境では代替メカニズム（PostgreSQL ベースなど）が使われる。

| DO クラス | 用途 | 他環境での代替 |
| --- | --- | --- |
| `SessionDO` | ユーザーセッション管理 | PostgreSQL / Redis |
| `RunNotifierDO` | Run イベントのリアルタイム通知 | ポーリングベース |
| `NotificationNotifierDO` | 通知のリアルタイム配信 | ポーリングベース |
| `RateLimiterDO` | 分散レートリミッタ | Redis ベース |
| `RoutingDO` | ホスト名ベースルーティング | PostgreSQL + キャッシュ |
| `GitPushLockDO` | Git push のロック管理 | PostgreSQL advisory lock |

### CF Containers

Docker コンテナを Cloudflare 上で Durable Object として実行する仕組み。他環境では ECS / Cloud Run / k8s Pod / Docker で代替する。

### Dispatch Namespace

テナント Worker を論理分離するための仕組み。他環境ではテナント Worker は直接 runtime-host に dispatch される。

### Analytics Engine

構造化ログ・メトリクスの書き込み。他環境では write path が contract-first（書き込み API は同じだけどバックエンドは未実装）。

### Browser Rendering

Puppeteer binding による Workers 内ブラウザ操作。他環境では browser-service コンテナで代替する。

### AI Binding

`@cloudflare/ai` のネイティブバインディング。他環境では OpenAI / Anthropic / Google AI の API を直接呼ぶ。

### Workflows

CF Workflows ベースのワークフロー実行。他環境では Takos-managed runner で代替する。

## マルチクラウド対応

Cloudflare をメインで使いつつ、一部のワークロードを他のクラウドにデプロイすることもできる。app.yml は同じまま、`--provider` フラグでデプロイ先を切り替える:

```bash
# Cloudflare（デフォルト）
takos deploy-group --env production

# 同じ app.yml を AWS にデプロイ
takos deploy-group --env production --provider ecs
```

詳しくは [環境ごとの差異](/hosting/differences) を参照。

## 次に読むページ

- [deploy-group](/deploy/deploy-group) --- デプロイコマンドの詳細
- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [AWS](/hosting/aws) --- AWS にデプロイする場合
- [GCP](/hosting/gcp) --- GCP にデプロイする場合
- [セルフホスト](/hosting/self-hosted) --- Cloudflare を使わない場合
