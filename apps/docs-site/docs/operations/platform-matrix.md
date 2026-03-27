# Platform Compatibility Matrix

Takos は複数のクラウドプラットフォームとセルフホスト環境で動作するよう設計されています。このドキュメントは各プラットフォームにおけるバインディングの実装状態と必要な環境変数を一覧します。

## バインディング互換マトリクス

| 機能 | CF Workers | Node+Docker | K8s (Helm) | AWS ECS | GCP Cloud Run |
|---|---|---|---|---|---|
| **Database** | D1 (SQLite) | SQLite / PostgreSQL | PostgreSQL | RDS PostgreSQL | Cloud SQL |
| **Object Storage** | R2 | Local file / MinIO | S3 / MinIO | S3 | GCS |
| **Queues (send)** | CF Queue | Redis / Local | Redis / SQS / Pub-Sub | SQS | Pub/Sub |
| **Queues (consume)** | Auto (platform) | Poll loop | Poll loop | Poll + SQS receive | Poll + Pub/Sub pull |
| **KV Store** | KV Namespace | Local file / Redis | Redis / DynamoDB | DynamoDB | Firestore / Redis |
| **Durable Objects** | Native DO | Redis / Local file | Redis | Redis (ElastiCache) | Redis (Memorystore) |
| **Vector DB** | Vectorize | pgvector | pgvector | pgvector (RDS) | pgvector (Cloud SQL) |
| **AI / Embeddings** | Workers AI | OpenAI API | OpenAI API | OpenAI / Bedrock | OpenAI / Vertex AI |
| **PDF Rendering** | CF Browser | Puppeteer | Puppeteer | Puppeteer | Puppeteer |
| **Container Mgmt** | CF Containers | Docker socket | K8s API | ECS tasks | Cloud Run revisions |
| **Cron / Scheduled** | CF Cron Trigger | Timer loop | Timer + CronJob | Timer + EventBridge | Timer + Cloud Scheduler |
| **Service Discovery** | Service Bindings | HTTP URLs | K8s Services | ALB / ELB | Cloud Run URLs |
| **Observability** | CF Analytics | OTEL | OTEL | OTEL + CloudWatch | OTEL + Cloud Logging |

## デプロイプロバイダ

Takos は以下の 5 つのデプロイプロバイダをサポートしています:

| プロバイダ | 識別名 | 仕組み |
|---|---|---|
| Cloudflare Workers for Platforms | `workers-dispatch` | CF API 経由で Worker をデプロイ |
| OCI (Docker) | `oci` | OCI Orchestrator HTTP API 経由 |
| AWS ECS | `ecs` | OCI Orchestrator に委譲 |
| GCP Cloud Run | `cloud-run` | OCI Orchestrator に委譲 |
| Kubernetes | `k8s` | OCI Orchestrator に委譲 |

`TAKOS_DEFAULT_DEPLOY_PROVIDER` で既定プロバイダを指定できます。未設定時は環境変数から自動検出されます。

## 環境変数リファレンス

### Database

| 変数名 | 説明 | 例 |
|---|---|---|
| `DATABASE_URL` / `POSTGRES_URL` | PostgreSQL 接続文字列 | `postgresql://user:pass@host:5432/takos` |
| `TAKOS_LOCAL_DATA_DIR` | ローカル SQLite / ファイル永続化ディレクトリ | `.takos-local` |

### Object Storage (バケットごと)

| 変数名 | 説明 |
|---|---|
| `AWS_S3_{NAME}_BUCKET` | S3 バケット名 (`GIT_OBJECTS`, `OFFLOAD`, `TENANT_SOURCE`, `WORKER_BUNDLES`, `TENANT_BUILDS`, `UI_BUNDLES`) |
| `AWS_S3_ENDPOINT` | S3 互換エンドポイント (MinIO など) |
| `AWS_REGION` | AWS リージョン |
| `AWS_ACCESS_KEY_ID` | AWS アクセスキー |
| `AWS_SECRET_ACCESS_KEY` | AWS シークレットキー |
| `GCP_GCS_{NAME}_BUCKET` | GCS バケット名 |
| `GCP_PROJECT_ID` | GCP プロジェクト ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCP サービスアカウント鍵ファイルパス |

### Queues (キューごと)

| 変数名 | 説明 |
|---|---|
| `AWS_SQS_{NAME}_QUEUE_URL` | SQS キュー URL (`RUN`, `INDEX`, `WORKFLOW`, `DEPLOY`) |
| `GCP_PUBSUB_{NAME}_TOPIC` | Pub/Sub トピック名 |
| `GCP_PUBSUB_{NAME}_SUBSCRIPTION` | Pub/Sub サブスクリプション名 (consume に必要) |
| `REDIS_URL` | Redis 接続 URL (キュー / KV / DO / ルーティングに使用) |

### KV Store

| 変数名 | 説明 |
|---|---|
| `AWS_DYNAMO_KV_TABLE` | DynamoDB テーブル名 |
| `GCP_FIRESTORE_KV_COLLECTION` | Firestore コレクション名 |

### AI / Vector DB

| 変数名 | 説明 |
|---|---|
| `OPENAI_API_KEY` | OpenAI API キー (embedding 生成に使用) |
| `OPENAI_BASE_URL` | OpenAI 互換 API ベース URL (オプション) |
| `PGVECTOR_ENABLED` | `true` に設定すると pgvector ストアを有効化 |

### PDF Rendering

| 変数名 | 説明 |
|---|---|
| `CHROME_CDP_URL` | Chrome DevTools Protocol エンドポイント URL |
| `PUPPETEER_EXECUTABLE_PATH` | ローカル Chromium バイナリパス |

### Container Management

| 変数名 | 説明 |
|---|---|
| `OCI_ORCHESTRATOR_URL` | OCI Orchestrator の URL |
| `OCI_ORCHESTRATOR_TOKEN` | OCI Orchestrator 認証トークン |
| `OCI_BACKEND` | `docker` (default) or `k8s` |
| `K8S_NAMESPACE` | Kubernetes namespace (k8s backend) |

### Deploy Provider Detection

| 変数名 | 説明 |
|---|---|
| `TAKOS_DEFAULT_DEPLOY_PROVIDER` | 既定デプロイプロバイダ名 |
| `TAKOS_PLATFORM_SOURCE` | `workers` or `node` |
| `CF_ACCOUNT_ID` / `CF_API_TOKEN` / `WFP_DISPATCH_NAMESPACE` | Cloudflare WFP 設定 |
| `AWS_ECS_CLUSTER_ARN` / `AWS_ECS_TASK_FAMILY` | AWS ECS 設定 |
| `GCP_PROJECT_ID` / `GCP_REGION` / `GCP_CLOUD_RUN_SERVICE_ID` | GCP Cloud Run 設定 |

### Platform Config

| 変数名 | 説明 |
|---|---|
| `ADMIN_DOMAIN` | 管理画面のドメイン |
| `TENANT_BASE_DOMAIN` | テナントアプリのベースドメイン |
| `ENCRYPTION_KEY` | デプロイメント暗号化キー |
| `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` | JWT 署名キーペア |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth 設定 |
| `SERVICE_INTERNAL_JWT_ISSUER` | 内部サービス間 JWT 発行者 |

## Helm デプロイメント

### 基本

```bash
helm install takos ./deploy/helm/takos/ -f values.yaml
```

### AWS (EKS)

```bash
helm install takos ./deploy/helm/takos/ -f values.yaml -f values-aws.yaml \
  --set externalDatabase.url="postgresql://..." \
  --set externalRedis.url="redis://..."
```

### GCP (GKE)

```bash
helm install takos ./deploy/helm/takos/ -f values.yaml -f values-gcp.yaml \
  --set externalDatabase.url="postgresql://..." \
  --set externalRedis.url="redis://..."
```

## バインディング検出の仕組み

`env-builder.ts` は環境変数を以下の優先順位でカスケード検出します:

```
Database:       DATABASE_URL/POSTGRES_URL → PostgreSQL
                TAKOS_LOCAL_DATA_DIR      → SQLite
                else                      → in-memory

Object Storage: AWS_S3_{NAME}_BUCKET      → S3
  (per-bucket)  GCP_GCS_{NAME}_BUCKET     → GCS
                TAKOS_LOCAL_DATA_DIR       → persistent file
                else                       → in-memory

Queues:         AWS_SQS_{NAME}_QUEUE_URL  → SQS
  (per-queue)   GCP_PUBSUB_{NAME}_TOPIC   → Pub/Sub
                REDIS_URL                  → Redis
                TAKOS_LOCAL_DATA_DIR       → persistent file
                else                       → in-memory

KV:             AWS_DYNAMO_KV_TABLE       → DynamoDB
                TAKOS_LOCAL_DATA_DIR       → persistent file
                else                       → in-memory

Durable Objs:   REDIS_URL                → Redis-backed
                TAKOS_LOCAL_DATA_DIR       → persistent file
                else                       → in-memory

AI:             OPENAI_API_KEY            → OpenAI adapter
                else                       → disabled

Vectorize:      PGVECTOR_ENABLED + PG     → pgvector
                else                       → disabled
```

異なるプロバイダを混在させることも可能です（例: S3 for storage + Pub/Sub for queues + PostgreSQL for DB）。
