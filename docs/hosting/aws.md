# AWS

Takos を AWS にホストする方法。このページは **takos オペレーター**向け。ECS / Fargate 上で Takos runtime の互換 backend を動かす。

このページの resource 名は `aws-prod` Terraform overlay の current naming に合わせています。`takos-prod` prefix と `-production` suffix を前提に読み替えてください。

::: warning experimental / compatibility mode
AWS provider は **experimental な compatibility backend** です。Cloudflare-native の primary path と機能パリティはなく、`takos deploy` のリソース / ワークロードのうち AWS backend にマッピングされているものだけが動作します。production 投入は十分な動作確認と社内サポート前提でお願いします。サポート範囲は予告なく変更される可能性があります。
:::

::: info アプリ開発者へ
このページは takos オペレーター向けです。public spec は Cloudflare-native のままで、AWS では Takos runtime が provider-backed resource と Takos-managed runtime を組み合わせて同じ `takos deploy` surface を解決します (translation report で `unsupported` と表示された項目は実行できません)。
:::

## リソースマッピング

`.takos/app.yml` の `publish` / `compute` 宣言が AWS サービスに解決される:

| manifest surface | AWS サービス | アダプタ |
| --- | --- | --- |
| `publish.kind: sql` | PostgreSQL (RDS) | PostgreSQL adapter |
| `publish.kind: object-store` | S3 | `s3-object-store` |
| `publish.kind: key-value` | DynamoDB | `dynamo-kv-store` |
| `publish.kind: queue` | SQS | `sqs-queue` |
| `publish.kind: vector-index` | PostgreSQL + pgvector | `pgvector-store` |
| `publish.kind: analytics-engine` | Takos analytics runtime | `analytics-engine-binding` |
| `publish.kind: workflow` | Takos workflow runtime | `workflow-binding` |
| `publish.kind: durable-object` | Takos durable runtime | `persistent-durable-objects` |
| `publish.kind: secret` | Secrets Manager | `aws-secrets-manager` |
| `compute.<name>` (Worker = `build` あり) | ECS Task (Node.js) | Node.js platform adapter |
| `compute.<name>` (Service = `image` あり, `build` なし) | ECS / Fargate | OCI deployment provider (`ecs`) |

## 必要なもの

- AWS アカウント
- IAM ユーザーまたはロール（後述の権限設定を参照）
- `takos-cli` がインストール済み
- PostgreSQL 16+（RDS 推奨）

## セットアップ

### 1. 必要な IAM 権限

Takos のデプロイ・運用に必要な IAM ポリシー:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:HeadObject"
      ],
      "Resource": "arn:aws:s3:::takos-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:DeleteItem",
        "dynamodb:Scan",
        "dynamodb:DescribeTable"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/takos-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:CreateQueue",
        "sqs:SendMessage",
        "sqs:SendMessageBatch",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:*:*:takos-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:PutSecretValue",
        "secretsmanager:GetSecretValue",
        "secretsmanager:DeleteSecret"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:takos-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:CreateService",
        "ecs:UpdateService",
        "ecs:DeleteService",
        "ecs:DescribeServices",
        "ecs:RegisterTaskDefinition",
        "ecs:DeregisterTaskDefinition",
        "ecs:RunTask",
        "ecs:StopTask",
        "ecs:DescribeTasks"
      ],
      "Resource": "*"
    }
  ]
}
```

::: tip 最小権限の原則
上の例は開発用。本番では Resource を特定の ARN に絞ること。
:::

### 2. 環境変数

```bash
# AWS 認証
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="ap-northeast-1"

# PostgreSQL (RDS)
export DATABASE_URL="postgresql://takos:password@your-rds-endpoint:5432/takos"

# S3
export S3_ENDPOINT=""  # AWS の場合は空でOK（SDK がリージョンから自動解決）
export S3_REGION="ap-northeast-1"
export S3_ACCESS_KEY_ID="your-access-key"
export S3_SECRET_ACCESS_KEY="your-secret-key"

# DynamoDB
export DYNAMO_REGION="ap-northeast-1"
export DYNAMO_TABLE_NAME="takos-kv"

# SQS（platform background queues）
export AWS_SQS_RUN_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/123456789/takos-runs-production"
export AWS_SQS_INDEX_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/123456789/takos-index-jobs-production"
export AWS_SQS_WORKFLOW_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/123456789/takos-workflow-jobs-production"
export AWS_SQS_DEPLOY_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/123456789/takos-deployment-jobs-production"

# tenant queue / secret resources
# queue (publish.kind: queue) は provider_resource_name を SQS queue 名として作成・解決する
# secret (publish.kind: secret) は provider_resource_name を Secrets Manager secret 名として作成・解決する

# pgvector（セマンティック検索を使う場合）
export PGVECTOR_ENABLED="true"
export POSTGRES_URL="${DATABASE_URL}"
```

### 3. インフラの準備

#### RDS (PostgreSQL)

```bash
aws rds create-db-instance \
  --db-instance-identifier takos-production-postgres \
  --engine postgres \
  --engine-version 16 \
  --db-instance-class db.t4g.medium \
  --allocated-storage 20 \
  --master-username takos \
  --master-user-password "your-password" \
  --db-name takos
```

pgvector を使う場合は RDS に pgvector 拡張を有効化:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

#### S3 バケット

```bash
aws s3 mb s3://takos-prod-worker-bundles-production-123456789012 --region ap-northeast-1
aws s3 mb s3://takos-prod-tenant-builds-production-123456789012 --region ap-northeast-1
aws s3 mb s3://takos-prod-tenant-source-production-123456789012 --region ap-northeast-1
aws s3 mb s3://takos-prod-git-objects-production-123456789012 --region ap-northeast-1
```

#### DynamoDB テーブル

```bash
aws dynamodb create-table \
  --table-name takos-prod-kv \
  --attribute-definitions AttributeName=key,AttributeType=S \
  --key-schema AttributeName=key,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-northeast-1
```

#### SQS キュー（platform background queues）

```bash
aws sqs create-queue --queue-name takos-runs-production --region ap-northeast-1
aws sqs create-queue --queue-name takos-index-jobs-production --region ap-northeast-1
aws sqs create-queue --queue-name takos-workflow-jobs-production --region ap-northeast-1
aws sqs create-queue --queue-name takos-deployment-jobs-production --region ap-northeast-1
```

## takos のデプロイ

takos 自体を AWS にデプロイするには、Terraform / CDK でインフラを構築してから takos を起動する:

```bash
# Terraform / CDK でインフラを構築した後
# ECS タスク定義で takos の Docker イメージを指定して起動する
```

アプリ開発者がアプリをデプロイするときは、環境を問わず同じコマンド:

```bash
takos deploy --env production --space SPACE_ID
```

## Cloudflare backend との差分

| Cloudflare backend の機能 | AWS backend での実現 |
| --- | --- |
| Durable Objects | Takos durable runtime |
| Analytics Engine | Takos analytics runtime |
| Dispatch Namespace | runtime-host dispatch path |
| Container workloads | ECS Task / Fargate |
| Browser Rendering | browser コンテナ（ECS Task） |

## 次に読むページ

- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [GCP](/hosting/gcp) --- GCP にデプロイする場合
- [セルフホスト](/hosting/self-hosted) --- Docker Compose でのセルフホスト
