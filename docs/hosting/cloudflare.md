# Cloudflare

このページは **Takos kernel を Cloudflare Workers
にホストする方法**を説明します。takos オペレーター向けです。Cloudflare backend
は tenant runtime の reference / primary backend で、backend-neutral public spec
の参照実装です。

Takos 上で group を deploy する方法は [Deploy](/deploy/) を参照してください。

::: info deploy manifest author へ deploy manifest author 向けの current surface
は backend-neutral な Takos deploy manifest を書く `takos deploy` です。
Cloudflare backend はその spec を直接実現する基準 backend で、他環境でも同じ
schema / translation surface を使います。ただし runtime behavior や resource
existence の完全一致は contract ではありません。
:::

::: info OSS テンプレートと private 運用 以下の `wrangler.toml` / bucket / queue
/ worker 名は OSS テンプレート例です。Takos 本体を private で運用する場合は
`takos-private/` を管理元とします。ecosystem checkout root から
`cd takos-private/apps/control && deno task deploy:staging` /
`deno task deploy:production` を実行し、`takos-private-*` の worker /
resource 名を使ってください。秘密値は
`apps/control/.secrets/<env>` と `deno task secrets:sync:*` /
`deno task secrets put ...` で管理します。
:::

## 必要なもの

- Cloudflare アカウント（Paid Workers プラン推奨）
- API トークン（後述の権限設定を参照）
- `takos-cli` がインストール済み
- `wrangler` CLI（v4 以上）

## セットアップ

### 1. API トークンを取得

Cloudflare ダッシュボードで API トークンを作成する。必要な権限:

| カテゴリ           | 権限               | レベル          | 用途                                 |
| ------------------ | ------------------ | --------------- | ------------------------------------ |
| Workers Scripts    | Workers Scripts    | 読み取り + 編集 | Worker のデプロイ・管理              |
| D1                 | D1                 | 読み取り + 編集 | データベースの作成・マイグレーション |
| R2                 | R2                 | 読み取り + 編集 | ストレージバケットの作成・管理       |
| Workers KV Storage | Workers KV Storage | 読み取り + 編集 | KV Namespace の作成・管理            |
| Account            | Cloudflare Pages   | 読み取り        | Pages 連携（アセット配信）           |
| Account            | Account Settings   | 読み取り        | アカウント情報の取得                 |

::: tip トークンのスコープ トークンは使うアカウントだけに限定しよう。「All
accounts」ではなく「Specific
account」で作成すると安全。ゾーンリソースも同様に特定ゾーンに限定できる。
:::

### 2. 環境変数をセット

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_TOKEN="your-api-token"
```

アカウント ID は Cloudflare ダッシュボードの URL から取得できる。

::: tip `CLOUDFLARE_API_TOKEN` と `CF_API_TOKEN` の違い CLI / Wrangler
の認証では `CLOUDFLARE_API_TOKEN` を使う一方、Cloudflare Worker runtime
から参照される secret / binding 名は `CF_API_TOKEN` です。`wrangler.toml` や
secret sync では両者を混同しないでください。
:::

### 3. ログイン

```bash
takos login
takos whoami
```

## リソースの手動作成

`takos deploy` は deploy manifest の `publish` を catalog に保存しますが、SQL /
object-store / queue などの resource を `publish` から自動作成しません。
resource record / binding は resource API / runtime binding 側で扱い、control
plane 本体の Cloudflare resource（D1 / R2 / KV / Dispatch / Queues / Vectorize
など）は operator が事前に作成・設定します。

route publication と Takos built-in provider publication consume は deploy 時に
catalog / grant state へ同期されますが、operator が管理する Cloudflare resource
の作成とは別の扱いです。

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
wrangler dispatch-namespace create takos-tenants
wrangler dispatch-namespace create takos-staging-tenants
```

### Queue

```bash
# 本番環境
# Agent Run 実行キュー
wrangler queues create takos-runs
wrangler queues create takos-runs-dlq

# Index ジョブ（embeddings / graph 更新）
wrangler queues create takos-index-jobs
wrangler queues create takos-index-jobs-dlq

# ワークフロー実行キュー
wrangler queues create takos-workflow-jobs
wrangler queues create takos-workflow-jobs-dlq

# デプロイジョブ実行キュー
wrangler queues create takos-deployment-jobs
wrangler queues create takos-deployment-jobs-dlq

# staging 環境
wrangler queues create takos-runs-staging
wrangler queues create takos-runs-dlq-staging
wrangler queues create takos-index-jobs-staging
wrangler queues create takos-index-jobs-dlq-staging
wrangler queues create takos-workflow-jobs-staging
wrangler queues create takos-workflow-jobs-dlq-staging
wrangler queues create takos-deployment-jobs-staging
wrangler queues create takos-deployment-jobs-dlq-staging
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
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat", "no_handle_cross_request_promise_resolution"]

[observability]
enabled = true

[vars]
ADMIN_DOMAIN = "admin.example.com"
TENANT_BASE_DOMAIN = "app.example.com"
GOOGLE_CLIENT_ID = "your-google-client-id.apps.googleusercontent.com"
AUTH_PUBLIC_BASE_URL = "https://admin.example.com"
AUTH_ALLOWED_REDIRECT_DOMAINS = "app.example.com"
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

# KV（canary / rollout health check 用。未設定なら health gate は skip）
[[kv_namespaces]]
binding = "ROLLOUT_HEALTH_KV"
id = "replace-with-rollout-health-kv-namespace-id"

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

# Internal service bindings
[[services]]
binding = "TAKOS_EGRESS"
service = "takos-worker"

[[services]]
binding = "RUNTIME_HOST"
service = "takos-runtime-host"
```

private 運用で dispatch worker を分離している場合は、同じ service binding block
に `TAKOS_DISPATCH` も追加します。OSS template では dispatch path を別 binding
に分けない構成も許容します。

### Secrets の設定

Takos 本体の private 運用では `apps/control/.secrets/<env>` を基準にし、
`deno task secrets:sync:staging` / `deno task secrets:sync:production` で
Cloudflare Worker runtime へ同期します。単発更新は `deno task secrets put ...`
を使います。次のコマンドは ecosystem checkout root から実行します。内部実装としては
Wrangler が upload を担当します。

```bash
cd takos-private/apps/control
deno task secrets:sync:staging
deno task secrets:sync:production

# 単発更新
deno task secrets put GOOGLE_CLIENT_SECRET --env staging
deno task secrets put GOOGLE_CLIENT_SECRET --env production
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

staging 用の secrets は `apps/control/.secrets/staging/` を更新してから
`deno task secrets:sync:staging` を実行します。

## Takos kernel のデプロイ

Takos kernel 本体を Cloudflare に deploy する場合は、private 管理元である
`takos-private/apps/control` から実行します。次のコマンドは ecosystem checkout
root から実行します:

```bash
cd takos-private/apps/control
deno task deploy:staging
```

production:

```bash
cd takos-private/apps/control
deno task deploy:production
```

::: info group の deploy とは別です ここでの deploy は Takos kernel 自体の
deploy です。Takos 上で動く group の deploy は `takos deploy`
を使い、[Deploy](/deploy/) を参照してください。
:::

## Dispatch Namespace

テナントごとに worker を論理分離するための Cloudflare 側の仕組み。Takos kernel
をホストする際に operator が事前に作成する必要があります。

namespace の作成:

```bash
wrangler dispatch-namespace create my-namespace
```

deploy manifest author は namespace を意識する必要はありません（manifest / group
で記述し、kernel が内部で dispatch namespace に materialize します）。

## Durable Objects

control plane が使う Durable Objects:

| DO クラス                | 用途                                    |
| ------------------------ | --------------------------------------- |
| `SessionDO`              | ユーザーセッション管理（SQLite-backed） |
| `RunNotifierDO`          | Run イベントのリアルタイム通知          |
| `NotificationNotifierDO` | 通知のリアルタイム配信                  |
| `RateLimiterDO`          | 分散レートリミッタ                      |
| `RoutingDO`              | ホスト名ベースルーティング              |
| `GitPushLockDO`          | Git push のロック管理                   |

Cloudflare backend は Durable Objects の基準 backend
です。セルフホスト・ローカルなどの backend-specific runtime では、Takos durable
runtime が同じ Takos durable runtime contract を実現します。ただし orchestration
や性能特性は Cloudflare backend と byte-for-byte 同一ではありません。

## Cloudflare 固有の環境変数

control plane を Cloudflare にデプロイする場合に使う主要な環境変数:

| 変数                                           | 用途                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `ADMIN_DOMAIN`                                 | 管理ドメイン                                                           |
| `TENANT_BASE_DOMAIN`                           | テナント用ベースドメイン                                               |
| `CF_ACCOUNT_ID`                                | Cloudflare アカウント ID（CLI では `CLOUDFLARE_ACCOUNT_ID` を推奨）    |
| `CF_API_TOKEN`                                 | Cloudflare API token secret（CLI では `CLOUDFLARE_API_TOKEN` を推奨）  |
| `CF_ZONE_ID`                                   | DNS ゾーン ID                                                          |
| `WFP_DISPATCH_NAMESPACE`                       | dispatch namespace 名（canonical; `CF_DISPATCH_NAMESPACE` は旧 alias） |
| `OCI_ORCHESTRATOR_URL`                         | image-backed services / containers 用 OCI deployment adapter の URL    |
| `OCI_ORCHESTRATOR_TOKEN`                       | OCI deployment adapter / orchestrator 認証トークン（任意）             |
| `ROUTING_DO_PHASE`                             | RoutingDO rollout phase。詳細は下記 [Routing phases](#routing-phases)  |
| `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` | プラットフォーム署名鍵                                                 |
| `BILLING_PROCESSOR`                            | payment integration の選択。default は `stripe`                        |
| `STRIPE_*`                                     | Stripe 決済連携 (`BILLING_PROCESSOR=stripe` 時のみ有効)                |

認証系:

| 変数                                                      | 用途                                                |
| --------------------------------------------------------- | --------------------------------------------------- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`               | Google OAuth                                        |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` | AI プロバイダ                                       |
| `EXECUTOR_PROXY_SECRET`                                   | executor-host から main `takos` worker への内部 RPC |

## Cloudflare 固有の機能

Cloudflare backend で Cloudflare managed service に materialize される機能。
他環境では backend-specific backing service または Takos-managed runtime で同じ
public contract を実現する。

### Durable Objects

control plane のステート管理に使われる。Cloudflare では Durable Objects、
他環境では PostgreSQL / Redis ベース実装で解決される。

| DO クラス                | 用途                           | 他環境での backing 実装  |
| ------------------------ | ------------------------------ | ------------------------ |
| `SessionDO`              | ユーザーセッション管理         | PostgreSQL / Redis       |
| `RunNotifierDO`          | Run イベントのリアルタイム通知 | ポーリングベース         |
| `NotificationNotifierDO` | 通知のリアルタイム配信         | ポーリングベース         |
| `RateLimiterDO`          | 分散レートリミッタ             | Redis ベース             |
| `RoutingDO`              | ホスト名ベースルーティング     | PostgreSQL + キャッシュ  |
| `GitPushLockDO`          | Git push のロック管理          | PostgreSQL advisory lock |

### Container workloads

image-backed `services` / `containers` は Cloudflare backend でも current
実装では OCI deployment adapter を通る。他環境では Docker / k8s / ECS / Cloud
Run などの tenant image workload adapter で解決する。ECS / Cloud Run は Takos
kernel hosting target ではない。

image-backed workload を使う場合は `OCI_ORCHESTRATOR_URL` が必要で、認証付き
orchestrator を使うなら `OCI_ORCHESTRATOR_TOKEN` を設定する。

### Dispatch Namespace

テナント Worker を論理分離する Cloudflare の仕組み。他環境では routing /
dispatch が Worker `worker-bundle` の tenant worker runtime path に解決される。

### Routing phases

`ROUTING_DO_PHASE` は hostname → service routing の data source rollout を
gradual に切り替える ための feature flag。値は `1`-`4` のいずれかで、production
は **`4`**、新規環境の bootstrap は `1` から始めて段階的に進める想定。

| phase | 読み取り primary                         | 書き込み primary                 | 補足                                        |
| ----- | ---------------------------------------- | -------------------------------- | ------------------------------------------- |
| `1`   | KV のみ                                  | KV のみ (DO は best-effort sync) | L1 cache 無し                               |
| `2`   | DO verify (KV と差分検出時は KV refresh) | KV + DO 並行                     | DO 同時書き込み                             |
| `3`   | L1 cache → DO primary, KV は L2 cache    | DO 必須                          | DO が unavailable なら stale KV へ fallback |
| `4`   | phase 3 + KV TTL (`L2_KV_TTL_SECONDS`)   | DO 必須 + KV expirationTtl       | 通常の本番設定                              |

`takos-dispatch` worker (`apps/control/wrangler.dispatch.toml`) と control-plane
worker (`apps/control/wrangler.toml`) で同じ値を設定すること。phase
を下げる方向の rollback はサポートされる (KV/DO 双方が更新されているため)
が、phase 1 から phase 3 以上へ jumping すると DO が空のため routing が壊れる。
順次進めること。

### Analytics Engine

構造化ログ・メトリクスの書き込みを Analytics Engine に解決する。他環境では Takos
analytics runtime で同じ write API を実現する。

### AI Binding

`@cloudflare/ai` のネイティブバインディング。他環境では OpenAI / Anthropic /
Google AI の API を直接呼ぶ。

### Workflows

CF Workflows ベースのワークフロー実行。他環境では Takos-managed runner
で代替する。

### Security headers

control plane worker は以下の security header を全 response に付与します:

| header                         | 値                                                        | 備考                                                    |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------------------- |
| `Strict-Transport-Security`    | `max-age=31536000; includeSubDomains; preload`            | `ENVIRONMENT=development` 時はスキップ                  |
| `Content-Security-Policy`      | `default-src 'self'; script-src 'self' …; ...`            | HTML response のみ。route 個別の nonce CSP は上書き可能 |
| `X-Content-Type-Options`       | `nosniff`                                                 | 全 response                                             |
| `X-Frame-Options`              | `DENY`                                                    | 全 response (admin console は埋め込み禁止)              |
| `Referrer-Policy`              | `strict-origin-when-cross-origin`                         | 全 response                                             |
| `Permissions-Policy`           | `camera=(), microphone=(), geolocation=(), payment=(), …` | 全 response                                             |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                             | OAuth popup の `window.opener` 経由攻撃を防止           |
| `Cross-Origin-Resource-Policy` | `same-site`                                               | 全 response                                             |

静的アセット (`/`, `/static/*`) は assets binding
経由で配信されるため、`server/middleware/static-assets.ts` が独自に header
を再付与します (assets binding response の header は immutable)。

::: warning Edge での HSTS Cloudflare 以外の deploy 環境 (k8s / AWS / 自前 nginx
等) で edge 側にも HSTS preload 対応が無い場合、ユーザー初回アクセスが HTTP
のままになると downgrade 攻撃のリスクがあります。edge 側でも HSTS を duplicate
して設定することを推奨します。
:::

## マルチクラウド対応

takos オペレーターが takos
をどのクラウドにホストするかはインストール時の設定で決まる。deploy manifest
author は deploy manifest を書いて `takos deploy --group GROUP_NAME`
するだけで、デプロイ先を意識する必要はない:

```bash
# deploy manifest author のコマンド（どの環境でも同じ）
takos deploy --env production --space SPACE_ID --group my-app
```

takos
自体を別のクラウドで動かす場合は、オペレーターがそのクラウド用のインフラを構築して
takos の設定を変更する。詳しくは [環境ごとの差異](/hosting/differences) と
[Not A Current Contract](/hosting/differences#not-a-current-contract) を参照。

## 次に読むページ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [AWS](/hosting/aws) --- AWS にデプロイする場合
- [GCP](/hosting/gcp) --- GCP にデプロイする場合
- [セルフホスト](/hosting/self-hosted) --- Cloudflare を使わない場合
