# AWS

Takos を AWS にホストする方法。このページは **takos オペレーター**向け。ECS / Fargate 上で Node.js の local-platform adapter を使って takos を動かす。

::: info アプリ開発者へ
アプリ開発者は takos がどのクラウドで動いているか意識する必要はない。app.yml を書いて `takos deploy-group --env staging` するだけ。
:::

## リソースマッピング

app.yml のリソース宣言が AWS サービスに自動マッピングされる:

| app.yml | AWS サービス | アダプタ |
| --- | --- | --- |
| `d1` | PostgreSQL (RDS) | PostgreSQL adapter |
| `r2` | S3 | `s3-object-store` |
| `kv` | DynamoDB | `dynamo-kv-store` |
| `queue` | SQS | `sqs-queue` |
| `vectorize` | PostgreSQL + pgvector | `pgvector-store` |
| `workers` | ECS Task (Node.js) | Node.js platform adapter |
| `services` | ECS / Fargate | OCI deployment provider (`ecs`) |

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

# SQS
export SQS_REGION="ap-northeast-1"
export SQS_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/123456789/takos-runs"

# pgvector（セマンティック検索を使う場合）
export PGVECTOR_ENABLED="true"
export POSTGRES_URL="${DATABASE_URL}"
```

### 3. インフラの準備

#### RDS (PostgreSQL)

```bash
aws rds create-db-instance \
  --db-instance-identifier takos-db \
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
aws s3 mb s3://takos-worker-bundles --region ap-northeast-1
aws s3 mb s3://takos-tenant-builds --region ap-northeast-1
aws s3 mb s3://takos-tenant-source --region ap-northeast-1
aws s3 mb s3://takos-git-objects --region ap-northeast-1
```

#### DynamoDB テーブル

```bash
aws dynamodb create-table \
  --table-name takos-kv \
  --attribute-definitions AttributeName=key,AttributeType=S \
  --key-schema AttributeName=key,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-northeast-1
```

#### SQS キュー

```bash
aws sqs create-queue --queue-name takos-runs --region ap-northeast-1
aws sqs create-queue --queue-name takos-index-jobs --region ap-northeast-1
aws sqs create-queue --queue-name takos-workflow-jobs --region ap-northeast-1
aws sqs create-queue --queue-name takos-deployment-jobs --region ap-northeast-1
```

## takos のデプロイ

takos 自体を AWS にデプロイするには、Terraform / CDK でインフラを構築してから takos を起動する:

```bash
# Terraform / CDK でインフラを構築した後
# ECS タスク定義で takos の Docker イメージを指定して起動する
```

アプリ開発者がアプリをデプロイするときは、環境を問わず同じコマンド:

```bash
takos deploy-group --env production
```

## Cloudflare 固有機能の代替

| Cloudflare | AWS での代替 |
| --- | --- |
| Durable Objects | 未対応（control plane の DO 依存部分は使えない） |
| CF Containers | ECS Task / Fargate |
| Dispatch Namespace | 直接 dispatch（runtime-host 経由） |
| Analytics Engine | 未対応 |
| Browser Rendering | browser-service コンテナ（ECS Task） |

## 次に読むページ

- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [GCP](/hosting/gcp) --- GCP にデプロイする場合
- [セルフホスト](/hosting/self-hosted) --- Docker Compose でのセルフホスト
