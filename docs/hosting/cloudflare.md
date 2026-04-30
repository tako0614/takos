# Cloudflare

このページは **Takos kernel を Cloudflare Workers
にホストする方法**を説明します。takos オペレーター向けです。Cloudflare Workers /
Containers / D1 / R2 / KV / Queues を組み合わせた構成は **tracked reference
Workers backend** で、backend-neutral public spec の参照実装です。PaaS Core の
canonical provider ではありません。本ページは Cloudflare 関連詳細の canonical
hosting guide で、`architecture/` 章では同じ詳細を collapsible
節に降格しています。

Takos 上で group を deploy する方法は [Deploy](/deploy/) を参照してください。

::: info deploy manifest author へ deploy manifest author 向けの current surface
は backend-neutral な Takos deploy manifest を書く `takos deploy` です。tracked
reference Workers backend はその spec を実現する参照実装で、他環境でも同じ
schema / translation surface を使います。ただし runtime behavior や resource
existence の完全一致は contract ではありません。 :::

::: info OSS テンプレートと private 運用 以下の `wrangler.toml` / bucket / queue
/ worker 名は OSS テンプレート例です。Takos 本体を private で運用する場合は
`takos-private/` を管理元とします。ecosystem checkout root から
`cd takos-private/apps/control && deno task deploy:staging` /
`deno task deploy:production` を実行し、`takos-private-*` の worker / resource
名を使ってください。秘密値は `takos-private/apps/control/.secrets/<env>` と
`deno task secrets:sync:*` / `deno task secrets put ...` で管理します。 :::

## 必要なもの

- Cloudflare アカウント（Paid Workers プラン推奨）
- API トークン（後述の権限設定を参照）
- `takos-cli` がインストール済み
- `wrangler` CLI（v4 以上）

## クイック deploy runbook (4 step)

Phase 7-16 完了 (Phase 16) 後の正本 deploy 手順は次の 4 step です。各 step
の詳細は本 docs の対応セクションへリンクします:

```bash
# 1. credentials 取得 (Cloudflare API token / Google OAuth / OPENAI_API_KEY)
#    → "API トークンを取得" セクションを参照

# 2. platform secret 5 個 (PEM keys + 32 byte secrets) を生成
cd takos-private && deno task generate:keys:production

# 3. secrets を Cloudflare Worker に同期し、本体を deploy
cd takos-private/apps/control \
  && deno task secrets:sync:production \
  && deno task deploy:production --confirm production

# 4. 初期 admin / tenant / registry trust roots を seed
cd takos/paas && deno task bootstrap:initial --admin-email=admin@example.com
```

各 step が完了したら
`cd takos-private && deno task e2e:smoke:real --env=production --api-url=https://takos.jp`
で full-stack smoke を実行し、`auth-smoke` の login flow / PAT issue / agent run
まで通れば operator が残すのは初回 admin login のみです (Phase 16 acceptance)。

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
account」で作成すると安全。ゾーンリソースも同様に特定ゾーンに限定できる。 :::

### 2. 環境変数をセット

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_TOKEN="your-api-token"
```

アカウント ID は Cloudflare ダッシュボードの URL から取得できる。

::: tip `CLOUDFLARE_API_TOKEN` と `CF_API_TOKEN` の違い CLI / Wrangler
の認証では `CLOUDFLARE_API_TOKEN` を使う一方、Cloudflare Worker runtime
から参照される secret / binding 名は `CF_API_TOKEN` です。`wrangler.toml` や
secret sync では両者を混同しないでください。 :::

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
# in takos/app/apps/control/wrangler.toml
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

### 鍵生成

新規環境 (staging / production / local) を bootstrap するときは、まず Takos
kernel が必要とする 5 つの platform secret を生成します:

- `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` ― RSA 2048 PKCS#8 / SPKI PEM
  (プラットフォーム署名鍵)
- `ENCRYPTION_KEY` ― 32 byte base64 (データ暗号化キー)
- `EXECUTOR_PROXY_SECRET` ― 32 byte hex (executor-host から control-web への
  内部 RPC)
- `TAKOS_INTERNAL_API_SECRET` ― 32 byte hex (内部テナント API)
- `TAKOS_SECRET_STORE_PASSPHRASE` ― 32 byte 以上 (secret store at-rest 暗号化
  passphrase。`ENCRYPTION_KEY` / `TAKOS_SECRET_STORE_KEY` /
  `TAKOS_SECRET_ENCRYPTION_KEY` のいずれかでも可)

::: danger production / staging では encryption key が必須
`TAKOS_ENVIRONMENT=production` または `staging` で起動するとき、Takos PaaS は
`TAKOS_SECRET_STORE_PASSPHRASE` / `TAKOS_SECRET_STORE_KEY` /
`TAKOS_SECRET_ENCRYPTION_KEY` / `ENCRYPTION_KEY` のいずれか 1 つを **必須** と
します。これらが未設定だと boot 時に fail-closed で `process exit 1` し、 secret
store を平文 (base64-only `PlaceholderSecretBoundaryCrypto`) に
フォールバックしません。

この強制によって、operator が `WebCryptoAesGcmSecretBoundaryCrypto` を
明示的に切り替え忘れた場合でも、DB に **平文の secret が保存される事故** を
防ぎます。production deploy 前に必ず secret 同期で encryption key を投入して
ください。

ローカル開発では明示的な opt-in `TAKOS_ALLOW_PLAINTEXT_SECRETS=1` で placeholder
crypto を許可できます (production では opt-in を渡しても fail- closed
のままです)。 :::

`takos-private/scripts/generate-platform-keys.ts` がこの 5 ファイルを
`takos-private/apps/control/.secrets/<env>/` に書き出します。既存ファイルが
ある場合は `--force` を付けない限り上書きせず exit 1 で警告します。

```bash
# ecosystem checkout root から実行
cd takos-private

# 新しい環境用の鍵を生成
deno task generate:keys:staging
deno task generate:keys:production

# ローカル開発用 (.secrets/local/ に出力)
deno task generate:keys:local

# 既存ファイルを上書きする場合
deno run --allow-read --allow-write --allow-env \
  scripts/generate-platform-keys.ts --env=staging --force

# 出力先を変更する場合
deno run --allow-read --allow-write --allow-env \
  scripts/generate-platform-keys.ts --env=staging --output=/tmp/keys
```

生成後は次節の `secrets:sync:*` で Cloudflare Worker secret として upload
します。 `GOOGLE_CLIENT_SECRET` などの third-party API key は別途
`.secrets/<env>/<NAME>` に手で配置するか `deno task secrets put ...`
で投入します。

::: warning 鍵の取り扱い `.secrets/<env>/` は `.gitignore` で git から除外
されています。生成した PEM / 32 byte secret を絶対に commit しないでください。
production の `PLATFORM_PRIVATE_KEY` を rotate する場合は事前に
`PLATFORM_PUBLIC_KEY` を併記運用する移行手順が必要です。 :::

### Secrets の設定

Takos 本体の private 運用では `takos-private/apps/control/.secrets/<env>`
を基準にし、 `deno task secrets:sync:staging` /
`deno task secrets:sync:production` で Cloudflare Worker runtime
へ同期します。単発更新は `deno task secrets put ...` を使います。次のコマンドは
ecosystem checkout root から実行します。内部実装としては Wrangler が upload
を担当します。

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
# in takos/app/apps/control/wrangler.toml
[env.staging]
name = "takos-staging"
workers_dev = true

[env.staging.vars]
ADMIN_DOMAIN = "test.takos.jp"
TENANT_BASE_DOMAIN = "app.test.takos.jp"
ROUTING_DO_PHASE = "4"
# ... 他の環境固有の設定
```

staging 用の secrets は `takos-private/apps/control/.secrets/staging/`
を更新してから `deno task secrets:sync:staging` を実行します。

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
を使い、[Deploy](/deploy/) を参照してください。 :::

### 初期セットアップ

control plane の deploy が完了したら、初期 admin account / tenant Space + Group
/ default app distribution / registry trust root を **`bootstrap-initial.ts`**
で seed します。スクリプトは idempotent で、既存 admin / tenant
が見つかった場合は新規作成を スキップして既存 PAT を再表示します。

```bash
# プレビュー (DB に書き込まない)
cd takos/paas/apps/paas
deno task bootstrap:initial \
  --admin-email=admin@takos.jp \
  --tenant-name="Takos" \
  --env=production \
  --dry-run

# 実行 (admin user / tenant / PAT を作成)
deno task bootstrap:initial \
  --admin-email=admin@takos.jp \
  --tenant-name="Takos" \
  --env=production
```

オプションで以下の env から default app distribution / registry trust root を
seed できます:

| 環境変数                              | 形式       | 用途                                                                                                                        |
| ------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `TAKOS_DEFAULT_APP_DISTRIBUTION_JSON` | JSON array | `[{ ref, digest, version?, publisher?, kind? }]` を `default_app_distribution_entries` 相当の registry descriptor に投入    |
| `TAKOS_REGISTRY_TRUST_ROOTS_JSON`     | JSON array | `[{ id, packageRef, packageDigest, packageKind?, trustLevel?, conformanceTier?, verifiedBy? }]` を trusted registry の seed |

実行後、stdout に以下が出力されます:

```text
Initial PAT (operator login):
  email : admin@takos.jp
  pat   : tk_pat_<64 hex chars>
```

この PAT は **初回ログイン時のみ表示される** ので、安全な場所 (1Password 等の
operator secret store) に保管してください。再実行時は同じ PAT が `[reused]`
として再表示されます (`pat:admin:<email>` secret に保存済みの場合)。

### Staging integration test

Phase 14 の **staging deploy pipeline integration test** は、上記 4 ステップ
(key generation, control deploy, DB migration, bootstrap) を **dry-run**
で連続実行して pipeline の各 step が壊れていないことを確認する
スモークテストです。Cloudflare credentials が未取得の状態でも実行できるので、
新しい operator が手元で初期確認するときや、CI で deploy script の regression
を検出するときに使います。

**1. dry-run (credentials 不要、安全)**:

```bash
cd takos-private
deno task staging:integration-test
```

各 step は独立して `success | fail | skip` を返し、レポート末尾に集計が
出力されます。期待される出力例:

```text
[OK] 1) generate-platform-keys (dry-run output)
     5 secret files generated at /tmp/takos-test-secrets/staging, all shapes valid
[OK] 2) takos-private deploy script smoke
     deploy.mjs imported, buildD1MigrationArgs(staging) -> 12 args
[OK] 3) takos/paas db:migrate --dry-run
     [db-migrate] env=staging dryRun=true catalog=10 migrations | 53 log lines
[OK] 4) takos/paas bootstrap:initial --dry-run
     dry-run preview produced for admin=test@example.com env=staging
summary: 4 success, 0 skip, 0 fail
```

このとき step 1 の secret 出力先は `/tmp/takos-test-secrets/<env>/` に
固定されており、`takos-private/apps/control/.secrets/staging/` の本物の secret
を **絶対に上書きしません**。

**2. real run (operator 専用、credentials 要)**:

実 staging に対して deploy script の `--dry-run` (wrangler 側の dry-run、 remote
API は呼ばない) まで含めて連続実行する場合:

```bash
cd takos-private
deno task staging:integration-test:real
```

`--real` を付けると:

- step 2 が `deno task deploy:staging --dry-run` を invoke する (predeploy
  verify + secrets check + wrangler dry-run)。
- credentials (`.secrets/staging/` の 5 secret file) が不在の場合は step 2 が
  `[SKIP]` を返し、警告を表示するだけでテスト全体は完走する (fail
  せず、不在の理由を log に出す)。
- 残りの step (DB migration / bootstrap) は引き続き dry-run で実行される。

**完全な real staging deploy** を行うには integration test ではなく
[Takos kernel のデプロイ](#takos-kernel-のデプロイ) の手順
(`deno task deploy:staging`) を `--dry-run` 無しで使ってください。 integration
test はあくまで pipeline の連続性を確認するスモークです。

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

tracked reference Workers backend は Durable Objects の基準実装
です。セルフホスト・ローカルなどの他 backend では、Takos durable runtime が同じ
Takos durable runtime contract を実現します。ただし orchestration や性能特性は
tracked reference Workers backend と byte-for-byte 同一ではありません。

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

tracked reference Workers backend で Cloudflare managed service に materialize
される機能。他環境では backend-specific backing service または Takos-managed
runtime で同じ public contract を実現する。

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

image-backed `services` / `containers` は tracked reference Workers backend でも
current 実装では OCI deployment adapter を通る。他環境では Docker / k8s / ECS /
Cloud Run などの tenant image workload adapter で解決する。ECS / Cloud Run は
Takos kernel hosting target ではない。

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

`takos-dispatch` worker (`takos/app/apps/control/wrangler.dispatch.toml`) と
control-plane worker (`takos/app/apps/control/wrangler.toml`) で同じ値を設定する
こと。phase を下げる方向の rollback はサポートされる (KV/DO 双方が更新されている
ため) が、phase 1 から phase 3 以上へ jumping すると DO が空のため routing が
壊れる。順次進めること。

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
して設定することを推奨します。 :::

### Auth integration smoke

deploy 完了後、operator は **auth / 3rd party integration smoke**
を実行して、login flow と PAT 発行 / agent run が staging
環境でも動くか確認できます。Phase 15 で追加した
`takos-private/scripts/auth-smoke.ts` がそのための runbook script です。

スモークは 4 個の check を順に実行します:

| # | check                      | dry-run                                    | --real                                                                  |
| - | -------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| 1 | Google OAuth client config | secrets ファイル shape 検証                | 上記 + Google discovery endpoint 接続性確認                             |
| 2 | takos login flow           | apiUrl + callback + state machine validate | apiUrl 健全性 probe（実際の `takos login` は operator が手動で実行）    |
| 3 | PAT 発行                   | `tak_pat_*` regex 自己テスト               | `/api/me/personal-access-tokens` で PAT 発行 → cleanup（DELETE）        |
| 4 | agent run（OpenAI 互換）   | `OPENAI_API_KEY` 存在 + stub payload 検証  | `/api/v1/chat/completions` または OpenAI 直接で minimal completion 1 本 |

#### dry-run（credentials 不要）

`takos-private` から credentials が無くても完走します。各 check は `success` /
`skip` のいずれかになり、`fail` は無いはずです:

```bash
cd takos-private
deno task auth:smoke:dry-run                  # default --env=staging
deno task auth:smoke:dry-run -- --env=production
```

未配置の secret は `[SKIP]` として report され、exit code は 0 のままです （CI
でも OK）。

#### --real（credentials 投入後）

実環境に対する live smoke。実行前に以下を済ませてください:

1. `takos-private/apps/control/.secrets/<env>/` に `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET` / `OPENAI_API_KEY` を配置（Phase 11B の
   `generate:keys:*` で作る platform secret に追加する形）
2. operator 端末で `takos login --api-url=<staging url>` を実行し、session token
   を `~/.config/takos/credentials` から取得して `TAKOS_SESSION_TOKEN`
   環境変数に export （PAT 発行 check と agent run check で必要）
3. staging API URL が反映されているか確認

```bash
export TAKOS_SESSION_TOKEN=...               # takos login で得た session token
cd takos-private
deno task auth:smoke:real -- \
  --env=staging \
  --api-url=https://staging.takos.example.com
```

各 check の意味:

- `[OK]` 該当 surface が正常動作（PAT は発行 → 自動 cleanup されています）
- `[SKIP]` 該当 credentials / session 未投入。warning だけ出して非破壊で終了
- `[FAIL]` HTTP 5xx / 接続失敗 等。exit code 1。runbook を再確認

production に対しても `--env=production` で同じスモークが実行できますが、PAT
は実体が発行され（直後に DELETE されます）、agent run check は OpenAI API
の課金対象なので、production では運用 window を決めて実行してください。

#### staging 統合との関係

[`staging:integration-test`](#staging-integration-test) が deploy pipeline の
dry-run を扱うのに対し、`auth:smoke:*` は **deploy 完了後の auth surface**
を確認します。production 投入直前の最後の手順として 順に走らせる想定です:

```bash
deno task staging:integration-test            # Phase 14: deploy pipeline dry-run
deno task auth:smoke:dry-run                  # Phase 15: auth surface shape validation
deno task auth:smoke:real -- --api-url=...    # Phase 15: live smoke
```

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

## multi-cloud に拡張する (Phase 17 以降)

Phase 16 までは Cloudflare 単独で kernel + tenant runtime
を動かす想定です。Phase 17 で **AWS / GCP / k8s / selfhosted provider plugin**
が完成したことで、Cloudflare control plane を維持したまま tenant runtime や 特定
resource (Postgres / S3 / Pub/Sub) を別 cloud に切り出せるようになりました。

クイック deploy runbook の 4 step に加えて、multi-cloud 構成では次の 5 step が
必要です:

```bash
# 5. (Cloudflare 以外の cloud を使う場合) その cloud の credentials を
#    Cloudflare Worker secret として inject
cd takos-private/apps/control
echo "AKIA..." | deno task secrets put AWS_ACCESS_KEY_ID --env production
echo "..."     | deno task secrets put AWS_SECRET_ACCESS_KEY --env production
# GCP の場合: GCP_SERVICE_ACCOUNT_JSON (base64) / GCP_PROJECT_ID
# k8s の場合: K8S_API_SERVER / K8S_API_TOKEN / K8S_API_CA_CERT
# selfhosted の場合: DATABASE_URL / S3_* など (kernel から到達できる場所)

# 6. profile を multi-cloud 用に切り替える
#    profiles/cloudflare-aws.example.json
#    profiles/cloudflare-gcp.example.json
#    profiles/cloudflare-kubernetes.example.json
cd takos-paas-plugins
cp profiles/cloudflare-aws.example.json deploy/cloudflare/profiles/production.json
# accountId / region / artifactBucket などを編集
deno task profile:apply --env production

# 7. (runtime-agent を使う場合) AWS / GCP / k8s / bare metal に
#    runtime-agent process を deploy
#    詳細は各 hosting docs の "runtime-agent を ... に置く" セクション参照
ssh ec2-user@runtime-agent-host \
  'sudo systemctl enable --now takos-runtime-agent'

# 8. routing layer の DNS / cert を設定
#    AWS:  Route53 hosted zone + ACM cert + ALB
#    GCP:  Cloud DNS zone + Google-managed cert + HTTP(S) LB
#    k8s:  external-dns + cert-manager + Ingress controller
#    selfhosted: Caddy / nginx + Let's Encrypt
#    詳細は各 hosting docs の "routing" セクション参照

# 9. composite descriptor を deploy manifest で使う (任意)
#    composite.cf-control-aws-tenant@v1
#    composite.cf-control-gcp-tenant@v1
#    composite.serverless-with-postgres@v1
takos deploy --env production --space SPACE_ID --group my-multi-cloud-app
```

step 5 (credential injection) と step 7 (runtime-agent) は **operator が
手動でやること** です。kernel は plugin 経由で resource lifecycle と routing
materialization を担当します。

詳細な runbook と各 cloud の credential / IAM / DNS 設計は
[Multi-cloud](/hosting/multi-cloud) を参照してください。

## 次に読むページ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [Multi-cloud](/hosting/multi-cloud) --- 4 cloud 横断 runbook
- [AWS](/hosting/aws) --- AWS にデプロイする場合
- [GCP](/hosting/gcp) --- GCP にデプロイする場合
- [Kubernetes](/hosting/kubernetes) --- Kubernetes にデプロイする場合
- [セルフホスト](/hosting/self-hosted) --- Cloudflare を使わない場合
