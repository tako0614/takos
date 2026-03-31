# セルフホスト

Takos をセルフホスト環境で実行する方法。

## 必要なもの

- Docker + Docker Compose V2
- PostgreSQL 16+（pgvector 対応が望ましい）
- Redis 7+
- MinIO（S3 互換ストレージ）

## セットアップ

### 1. 環境変数を準備

```bash
cp .env.local.example .env.local
```

### 2. 環境変数の全リスト

#### ドメイン・ポート設定

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `TAKOS_ADMIN_DOMAIN` | `admin.localhost` | 管理画面のドメイン |
| `TAKOS_TENANT_BASE_DOMAIN` | `app.localhost` | テナント用ベースドメイン |
| `TAKOS_CONTROL_WEB_PORT` | `8787` | Control Web の公開ポート |
| `TAKOS_CONTROL_DISPATCH_PORT` | `8788` | Dispatch の公開ポート |
| `TAKOS_RUNTIME_HOST_PORT` | `8789` | Runtime Host のポート |
| `TAKOS_EXECUTOR_HOST_PORT` | `8790` | Executor Host のポート |
| `TAKOS_BROWSER_HOST_PORT` | `8791` | Browser Host のポート |
| `TAKOS_RUNTIME_PORT` | `8081` | Runtime コンテナのポート |
| `TAKOS_EXECUTOR_PORT` | `8082` | Executor コンテナのポート |
| `TAKOS_BROWSER_PORT` | `8083` | Browser コンテナのポート |

#### インフラ接続

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://takos:takos@postgres:5432/takos` | PostgreSQL 接続 URL |
| `REDIS_URL` | `redis://redis:6379` | Redis 接続 URL |
| `TAKOS_POSTGRES_PORT` | `15432` | ホスト側の PostgreSQL ポート |
| `TAKOS_REDIS_PORT` | `16379` | ホスト側の Redis ポート |

#### S3 互換ストレージ（MinIO）

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://minio:9000` | S3 エンドポイント |
| `S3_REGION` | `us-east-1` | S3 リージョン |
| `S3_ACCESS_KEY_ID` | `takos` | アクセスキー |
| `S3_SECRET_ACCESS_KEY` | `takos-dev-secret` | シークレットキー |
| `S3_BUCKET` | `takos-tenant-source` | ソースコード保存バケット |
| `MINIO_ROOT_USER` | `takos` | MinIO 管理ユーザー |
| `MINIO_ROOT_PASSWORD` | `takos-dev-secret` | MinIO 管理パスワード |
| `TAKOS_MINIO_PORT` | `19000` | MinIO API ポート |
| `TAKOS_MINIO_CONSOLE_PORT` | `19001` | MinIO コンソールポート |

#### 認証・暗号化

| 変数 | 用途 |
| --- | --- |
| `PLATFORM_PRIVATE_KEY` | プラットフォーム署名用の RSA 秘密鍵 |
| `PLATFORM_PUBLIC_KEY` | プラットフォーム署名用の RSA 公開鍵 |
| `JWT_PUBLIC_KEY` | JWT 検証用公開鍵 |
| `ENCRYPTION_KEY` | データ暗号化キー（Base64 エンコード済み 32 バイト） |
| `GOOGLE_CLIENT_ID` | Google OAuth クライアント ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth クライアントシークレット |

#### AI プロバイダ

| 変数 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI API キー |
| `ANTHROPIC_API_KEY` | Anthropic API キー（任意） |
| `GOOGLE_API_KEY` | Google AI API キー（任意） |
| `TAKOS_ALLOW_NO_LLM` | `1` にすると LLM キーなしでも起動可能 |

#### OCI Orchestrator

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `TAKOS_OCI_ORCHESTRATOR_PORT` | `9002` | OCI Orchestrator のポート |
| `OCI_ORCHESTRATOR_URL` | `http://oci-orchestrator:9002/` | OCI Orchestrator の URL |
| `OCI_ORCHESTRATOR_DATA_DIR` | `/var/lib/takos/control/oci-orchestrator` | データディレクトリ |

#### Worker 設定

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `TAKOS_CONTROL_WORKER_POLL_INTERVAL_MS` | `250` | ジョブポーリング間隔（ms） |
| `TAKOS_CONTROL_WORKER_SCHEDULED_INTERVAL_MS` | `60000` | スケジュールジョブ実行間隔（ms） |
| `TAKOS_CONTROL_WORKER_HEARTBEAT_FILE` | `/var/lib/takos/control/worker-heartbeat.json` | ヘルスチェック用ハートビートファイル |
| `TAKOS_CONTROL_WORKER_HEARTBEAT_TTL_MS` | `120000` | ハートビート TTL（ms） |

#### Vectorize（pgvector）

| 変数 | 用途 |
| --- | --- |
| `PGVECTOR_ENABLED` | `true` にすると pgvector を使った Vectorize 互換が有効になる |
| `POSTGRES_URL` | pgvector が入った PostgreSQL の接続 URL（`DATABASE_URL` と同じでも OK） |

### 3. compose を使わない場合

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

## サービス構成

`compose.local.yml` で定義されるサービスの全容:

### インフラ backing services

#### PostgreSQL

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports: ["${TAKOS_POSTGRES_PORT:-15432}:5432"]
```

- **イメージ**: `postgres:16-alpine`
- **ホストポート**: `TAKOS_POSTGRES_PORT`（デフォルト `15432`）→ コンテナポート `5432`
- **初期設定**: DB 名 `takos`、ユーザー `takos`、パスワード `takos`
- **ボリューム**: `takos-postgres`（永続化）
- **ヘルスチェック**: `pg_isready -U takos -d takos`（10 秒間隔）

#### Redis

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ["${TAKOS_REDIS_PORT:-16379}:6379"]
```

- **イメージ**: `redis:7-alpine`
- **ホストポート**: `TAKOS_REDIS_PORT`（デフォルト `16379`）→ コンテナポート `6379`
- **ボリューム**: `takos-redis`（永続化）
- **ヘルスチェック**: `redis-cli ping`（10 秒間隔）
- **用途**: Cloudflare KV の互換レイヤー

#### MinIO

```yaml
services:
  minio:
    image: minio/minio:latest
    command: server /data --console-address :9001
    ports:
      - "${TAKOS_MINIO_PORT:-19000}:9000"
      - "${TAKOS_MINIO_CONSOLE_PORT:-19001}:9001"
```

- **イメージ**: `minio/minio:latest`
- **ホストポート**: API `TAKOS_MINIO_PORT`（デフォルト `19000`）/ コンソール `TAKOS_MINIO_CONSOLE_PORT`（デフォルト `19001`）
- **ボリューム**: `takos-minio`（永続化）
- **コンソール**: `http://localhost:19001` でブラウザから操作可能
- **用途**: Cloudflare R2 の互換レイヤー

`minio-init` サービスが起動後に `mc mb` でバケットを自動作成する。

### Control Plane サービス

#### Control Web

- **コマンド**: `pnpm local:web`
- **ポート**: `TAKOS_CONTROL_WEB_PORT`（デフォルト `8787`）
- **役割**: Web UI + API サーバー。Cloudflare の Worker に相当するメインサービス
- **依存**: `minio-init` 完了後に起動

#### Control Dispatch

- **コマンド**: `pnpm local:dispatch`
- **ポート**: `TAKOS_CONTROL_DISPATCH_PORT`（デフォルト `8788`）
- **役割**: テナントへのリクエストルーティング。Cloudflare Dispatch Namespace の代替
- **依存**: `control-web` が healthy になってから起動

#### Control Worker

- **コマンド**: `pnpm local:worker`
- **ポート**: なし（バックグラウンドジョブ処理）
- **役割**: Run 実行、Queue 処理、Scheduled ジョブなどのバックグラウンド処理
- **依存**: `control-web` + `runtime-host` + `executor-host` + `oci-orchestrator`
- **ヘルスチェック**: ハートビートファイルの更新時刻で判定

### Runtime & Executor サービス

#### Runtime Host

- **コマンド**: `pnpm local:runtime-host`
- **ポート**: `TAKOS_RUNTIME_HOST_PORT`（デフォルト `8789`）
- **役割**: テナント Worker を materialize して実行する host プロセス

#### Runtime

- **イメージ**: `apps/runtime/Dockerfile` からビルド
- **ポート**: `TAKOS_RUNTIME_PORT`（デフォルト `8081`）→ コンテナポート `8080`
- **役割**: テナントランタイムコンテナ

#### Executor Host

- **コマンド**: `pnpm local:executor-host`
- **ポート**: `TAKOS_EXECUTOR_HOST_PORT`（デフォルト `8790`）
- **役割**: エージェント実行の host プロセス

#### Rust Agent

- **イメージ**: `apps/rust-agent/Dockerfile` からビルド
- **ポート**: `TAKOS_EXECUTOR_PORT`（デフォルト `8082`）→ コンテナポート `8080`
- **役割**: Rust 製のエージェント実行コンテナ
- **構成**: `packages/rust-agent-engine` を core とし、`apps/rust-agent` が Takos control RPC / remote tools / skill prompt bridge を提供
- **データ**: `takos-rust-agent-data` volume に object memory を保持

### Browser サービス

#### Browser Host

- **コマンド**: `pnpm local:browser-host`
- **ポート**: `TAKOS_BROWSER_HOST_PORT`（デフォルト `8791`）
- **役割**: ブラウザ自動化の host プロセス

#### Browser

- **イメージ**: `packages/browser-service/Dockerfile` からビルド
- **ポート**: `TAKOS_BROWSER_PORT`（デフォルト `8083`）→ コンテナポート `8080`
- **役割**: ブラウザ自動化コンテナ

### OCI Orchestrator

- **コマンド**: `pnpm local:oci-orchestrator`
- **ポート**: `TAKOS_OCI_ORCHESTRATOR_PORT`（デフォルト `9002`）
- **役割**: provider-aware な container runtime。CF Containers のローカル代替で、既定では Docker を使い、`k8s` / `cloud-run` / `ecs` provider は native backend を使う
- **特殊設定**: Docker fallback を使う場合は `/var/run/docker.sock` をマウントしてホストの Docker を操作
- **ネットワーク**: `default` + `takos-containers`（コンテナ間通信用）

provider-native backend を使う場合の追加 env:

- `k8s`: `K8S_NAMESPACE`, `K8S_DEPLOYMENT_NAME`, `K8S_IMAGE_REGISTRY`
- `cloud-run`: `GCP_PROJECT_ID`, `GCP_CLOUD_RUN_REGION`, `GCP_CLOUD_RUN_SERVICE_ID`, `GCP_CLOUD_RUN_SERVICE_ACCOUNT`, `GCP_CLOUD_RUN_INGRESS`, `GCP_CLOUD_RUN_ALLOW_UNAUTHENTICATED`
- `ecs`: `AWS_ECS_CLUSTER_ARN`, `AWS_ECS_TASK_DEFINITION_FAMILY`, `AWS_ECS_SERVICE_ARN` or `AWS_ECS_SERVICE_NAME`, `AWS_ECS_SUBNET_IDS`, `AWS_ECS_SECURITY_GROUP_IDS`, `AWS_ECS_BASE_URL`

### ネットワーク構成

| ネットワーク | 用途 |
| --- | --- |
| `default` | control plane サービス間通信 |
| `takos-containers` | OCI Orchestrator が管理するコンテナとの通信 |

### ボリューム

| ボリューム | 用途 |
| --- | --- |
| `takos-postgres` | PostgreSQL データ永続化 |
| `takos-redis` | Redis データ永続化 |
| `takos-minio` | MinIO オブジェクトストア永続化 |
| `takos-control-data` | Control Plane 共有データ |

## PostgreSQL + pgvector のセットアップ

セマンティック検索（Vectorize 互換）を使うには pgvector が必要。

### pgvector 拡張のインストール

PostgreSQL に pgvector がインストールされていない場合:

```bash
# Ubuntu / Debian
sudo apt install postgresql-16-pgvector

# macOS (Homebrew)
brew install pgvector
```

Docker の場合は pgvector 対応イメージを使う:

```bash
# compose.local.yml の postgres を差し替え
image: pgvector/pgvector:pg16
```

### 拡張の有効化

```sql
-- PostgreSQL に接続して実行
CREATE EXTENSION IF NOT EXISTS vector;
```

### 環境変数の設定

```bash
POSTGRES_URL=postgresql://takos:takos@postgres:5432/takos
PGVECTOR_ENABLED=true
```

未設定の場合、vectorize binding を使う Worker の起動時にエラーになる。

## 初回マイグレーション

```bash
pnpm db:migrate:local
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

## Kubernetes

k8s クラスタにデプロイする場合は [Kubernetes](/hosting/kubernetes) を参照。

## 次に読むページ

- [ローカル開発](/hosting/local) --- 開発用のローカル環境
- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [Cloudflare](/hosting/cloudflare) --- Cloudflare にデプロイする場合
- [AWS](/hosting/aws) --- AWS にデプロイする場合
- [GCP](/hosting/gcp) --- GCP にデプロイする場合
- [Kubernetes](/hosting/kubernetes) --- k8s クラスタへのデプロイ
