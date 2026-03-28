# GCP

Takos を Google Cloud Platform にホストする方法。このページは **takos オペレーター**向け。Cloud Run 上で Node.js の local-platform adapter を使って takos を動かす。

::: info アプリ開発者へ
アプリ開発者は takos がどのクラウドで動いているか意識する必要はない。app.yml を書いて `takos deploy-group --env staging` するだけ。
:::

## リソースマッピング

app.yml のリソース宣言が GCP サービスに自動マッピングされる:

| app.yml | GCP サービス | アダプタ |
| --- | --- | --- |
| `d1` | PostgreSQL (Cloud SQL) | PostgreSQL adapter |
| `r2` | Cloud Storage (GCS) | `gcs-object-store` |
| `kv` | Firestore | `firestore-kv-store` |
| `queue` | Pub/Sub | `pubsub-queue` |
| `vectorize` | PostgreSQL + pgvector (Cloud SQL) | `pgvector-store` |
| `workers` | Cloud Run (Node.js) | Node.js platform adapter |
| `services` | Cloud Run | OCI deployment provider (`cloud-run`) |

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
export GCS_BUCKET="takos-worker-bundles"
export GCS_PROJECT_ID="${GCP_PROJECT_ID}"

# Firestore
export FIRESTORE_PROJECT_ID="${GCP_PROJECT_ID}"
export FIRESTORE_COLLECTION_NAME="takos-kv"

# Pub/Sub
export PUBSUB_PROJECT_ID="${GCP_PROJECT_ID}"
export PUBSUB_TOPIC_NAME="takos-runs"

# pgvector（セマンティック検索を使う場合）
export PGVECTOR_ENABLED="true"
export POSTGRES_URL="${DATABASE_URL}"
```

### 3. インフラの準備

#### Cloud SQL (PostgreSQL)

```bash
gcloud sql instances create takos-db \
  --database-version=POSTGRES_16 \
  --tier=db-custom-2-4096 \
  --region=asia-northeast1

gcloud sql databases create takos \
  --instance=takos-db

gcloud sql users create takos \
  --instance=takos-db \
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
gsutil mb -l asia-northeast1 gs://takos-worker-bundles
gsutil mb -l asia-northeast1 gs://takos-tenant-builds
gsutil mb -l asia-northeast1 gs://takos-tenant-source
gsutil mb -l asia-northeast1 gs://takos-git-objects
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

#### Pub/Sub

```bash
gcloud pubsub topics create takos-runs
gcloud pubsub topics create takos-index-jobs
gcloud pubsub topics create takos-workflow-jobs
gcloud pubsub topics create takos-deployment-jobs

# サブスクリプション（worker のポーリング用）
gcloud pubsub subscriptions create takos-runs-sub --topic=takos-runs
gcloud pubsub subscriptions create takos-index-jobs-sub --topic=takos-index-jobs
gcloud pubsub subscriptions create takos-workflow-jobs-sub --topic=takos-workflow-jobs
gcloud pubsub subscriptions create takos-deployment-jobs-sub --topic=takos-deployment-jobs
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
takos deploy-group --env production
```

## Cloudflare 固有機能の代替

| Cloudflare | GCP での代替 |
| --- | --- |
| Durable Objects | 未対応（control plane の DO 依存部分は使えない） |
| CF Containers | Cloud Run サービス |
| Dispatch Namespace | 直接 dispatch（runtime-host 経由） |
| Analytics Engine | 未対応 |
| Browser Rendering | browser-service コンテナ（Cloud Run） |

## 次に読むページ

- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [AWS](/hosting/aws) --- AWS にデプロイする場合
- [セルフホスト](/hosting/self-hosted) --- Docker Compose でのセルフホスト
