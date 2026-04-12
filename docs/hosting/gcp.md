# GCP

Takos を Google Cloud Platform にホストする方法。このページは **takos オペレーター**向け。Cloud Run 上で Takos runtime の互換 backend を動かす。

このページの resource 名は `gcp-prod` Terraform overlay の current naming に合わせています。`takos-prod` prefix と `-production` suffix を前提に読み替えてください。

::: info アプリ開発者へ
このページは takos オペレーター向けです。public spec は Cloudflare-native のままで、GCP では Takos runtime が provider-backed resource と Takos-managed runtime を組み合わせて同じ `takos deploy` surface を解決します。
:::

## リソースマッピング

`.takos/app.yml` の `publish` / `compute` 宣言が GCP サービスに解決される:

| manifest surface | GCP サービス | アダプタ |
| --- | --- | --- |
| `publish.kind: sql` | PostgreSQL (Cloud SQL) | PostgreSQL adapter |
| `publish.kind: object-store` | Cloud Storage (GCS) | `gcs-object-store` |
| `publish.kind: key-value` | Firestore | `firestore-kv-store` |
| `publish.kind: queue` | Pub/Sub | `pubsub-queue` |
| `publish.kind: vector-index` | PostgreSQL + pgvector (Cloud SQL) | `pgvector-store` |
| `publish.kind: analytics-engine` | Takos analytics runtime | `analytics-engine-binding` |
| `publish.kind: workflow` | Takos workflow runtime | `workflow-binding` |
| `publish.kind: durable-object` | Takos durable runtime | `persistent-durable-objects` |
| `publish.kind: secret` | Secret Manager | `gcp-secret-manager` |
| `compute.<name>` (Worker = `build` あり) | Cloud Run (Node.js) | Node.js platform adapter |
| `compute.<name>` (Service = `image` あり, `build` なし) | Cloud Run | OCI deployment provider (`cloud-run`) |

## 必要なもの

- GCP プロジェクト
- サービスアカウント（後述の権限設定を参照）
- `takos-cli` がインストール済み
- PostgreSQL 16+（Cloud SQL 推奨）

## セットアップ

### 1. 必要な IAM ロール

Takos のデプロイ・運用に必要なロール:

| ロール | 用途 |
| --- | --- |
| `roles/storage.admin` | GCS バケット管理 |
| `roles/datastore.user` | Firestore 読み書き |
| `roles/pubsub.editor` | Pub/Sub トピック・サブスクリプション管理 |
| `roles/secretmanager.admin` | Secret Manager secret 管理 |
| `roles/cloudsql.client` | Cloud SQL 接続 |
| `roles/run.admin` | Cloud Run サービス管理 |
| `roles/iam.serviceAccountUser` | Cloud Run のサービスアカウント指定 |

::: tip サービスアカウント
本番では Workload Identity Federation を使って、サービスアカウントキーファイルなしで認証するのが推奨。
:::

### 2. 環境変数

```bash
# GCP 認証（サービスアカウントキーを使う場合）
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
export GCP_PROJECT_ID="your-project-id"

# PostgreSQL (Cloud SQL)
export DATABASE_URL="postgresql://takos:password@/takos?host=/cloudsql/project:region:instance"

# GCS
export GCS_BUCKET="takos-prod-worker-bundles-production"
export GCS_PROJECT_ID="${GCP_PROJECT_ID}"

# Firestore
export FIRESTORE_PROJECT_ID="${GCP_PROJECT_ID}"
export FIRESTORE_COLLECTION_NAME="takos-kv"

# Pub/Sub（platform background queues）
export GCP_PUBSUB_RUN_TOPIC="takos-runs-production"
export GCP_PUBSUB_INDEX_TOPIC="takos-index-jobs-production"
export GCP_PUBSUB_WORKFLOW_TOPIC="takos-workflow-jobs-production"
export GCP_PUBSUB_DEPLOY_TOPIC="takos-deployment-jobs-production"

# worker polling 用 subscriptions
export GCP_PUBSUB_RUN_SUBSCRIPTION="takos-runs-production-sub"
export GCP_PUBSUB_INDEX_SUBSCRIPTION="takos-index-jobs-production-sub"
export GCP_PUBSUB_WORKFLOW_SUBSCRIPTION="takos-workflow-jobs-production-sub"
export GCP_PUBSUB_DEPLOY_SUBSCRIPTION="takos-deployment-jobs-production-sub"

# tenant queue / secret resources
# tenant queue (publish.kind: queue) は provider_resource_name を Pub/Sub topic 名として作成し、subscription は自動生成する
# secret (publish.kind: secret) は provider_resource_name を Secret Manager secret 名として作成・解決する

# pgvector（セマンティック検索を使う場合）
export PGVECTOR_ENABLED="true"
export POSTGRES_URL="${DATABASE_URL}"
```

### 3. インフラの準備

#### Cloud SQL (PostgreSQL)

```bash
gcloud sql instances create takos-production-postgres \
  --database-version=POSTGRES_16 \
  --tier=db-custom-2-4096 \
  --region=asia-northeast1

gcloud sql databases create takos \
  --instance=takos-production-postgres

gcloud sql users create takos \
  --instance=takos-production-postgres \
  --password="your-password"
```

pgvector を使う場合:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

::: info Cloud SQL での pgvector
Cloud SQL for PostgreSQL は pgvector をネイティブサポートしている。追加のインストール不要で `CREATE EXTENSION` だけで有効化できる。
:::

#### GCS バケット

```bash
gsutil mb -l asia-northeast1 gs://takos-prod-worker-bundles-production
gsutil mb -l asia-northeast1 gs://takos-prod-tenant-builds-production
gsutil mb -l asia-northeast1 gs://takos-prod-tenant-source-production
gsutil mb -l asia-northeast1 gs://takos-prod-git-objects-production
```

#### Firestore

```bash
gcloud firestore databases create \
  --location=asia-northeast1 \
  --type=firestore-native
```

Firestore の TTL ポリシーを設定すると、期限切れの KV エントリが自動で削除される:

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=takos-kv \
  --enable-ttl
```

#### Pub/Sub（platform background queues）

```bash
gcloud pubsub topics create takos-runs-production
gcloud pubsub topics create takos-index-jobs-production
gcloud pubsub topics create takos-workflow-jobs-production
gcloud pubsub topics create takos-deployment-jobs-production

# サブスクリプション（worker のポーリング用）
gcloud pubsub subscriptions create takos-runs-production-sub --topic=takos-runs-production
gcloud pubsub subscriptions create takos-index-jobs-production-sub --topic=takos-index-jobs-production
gcloud pubsub subscriptions create takos-workflow-jobs-production-sub --topic=takos-workflow-jobs-production
gcloud pubsub subscriptions create takos-deployment-jobs-production-sub --topic=takos-deployment-jobs-production
```

## takos のデプロイ

takos 自体を GCP にデプロイするには、gcloud / Terraform でインフラを構築してから takos を起動する:

```bash
# Cloud Run にデプロイ
gcloud run deploy takos-control-web \
  --image your-registry/takos-control:latest \
  --region asia-northeast1 \
  --set-env-vars "DATABASE_URL=..." \
  --allow-unauthenticated
```

アプリ開発者がアプリをデプロイするときは、環境を問わず同じコマンド:

```bash
takos deploy --env production --space SPACE_ID
```

## Cloudflare backend との差分

| Cloudflare backend の機能 | GCP backend での実現 |
| --- | --- |
| Durable Objects | Takos durable runtime |
| Analytics Engine | Takos analytics runtime |
| Dispatch Namespace | runtime-host dispatch path |
| Container workloads | Cloud Run サービス |
| Browser Rendering | browser コンテナ（Cloud Run） |

## 次に読むページ

- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [AWS](/hosting/aws) --- AWS にデプロイする場合
- [セルフホスト](/hosting/self-hosted) --- Docker Compose でのセルフホスト
