# セルフホスト

> このページでわかること: Takosumi kernel をセルフホスト環境で実行する方法。

このページは **Takosumi kernel
をセルフホスト環境で実行する方法**を説明します。takos オペレーター向けです。

Takosumi 上に AppSpec を install し、Installation / Deployment を管理する方法は [Deploy](/deploy/)
を参照してください。

::: danger このページのサンプルはローカル開発向けデフォルトを含みます
このページに掲載されている
`compose.local.yml`、`.env.local.example`、`takos-dev-secret` などはすべて
**ローカル開発を前提としたデフォルト**
です。本番環境にそのまま流用しないでください。本番運用では下記のすべてを満たす必要があります:

- `.env.local` ではなく `.env.production` を作成し、独自の値で全項目を埋める
- `S3_SECRET_ACCESS_KEY` / `MINIO_ROOT_PASSWORD` / `ENCRYPTION_KEY` /
  `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` / `EXECUTOR_PROXY_SECRET` /
  `TAKOS_INTERNAL_API_SECRET` を含む secret を **絶対に `takos-dev-secret`
  のままにしない**。32 byte 以上のランダム値を生成して差し替える
- `compose.local.yml` ではなく `takos-private/compose.server.yml`
  を使う。private server stack を起動する場合は
  `takos-private/.env.server.example` を元に `takos-private/.env.server`
  を作成し、`takos-private` で `deno task server:up` を実行する
- backing services (PostgreSQL / Redis / オブジェクトストレージ)
  はホスト上の単独 container ではなく managed service もしくは production-grade
  な構成に置き換える
- 公開ドメインは `*.localhost` ではなく実ドメインに変更し、TLS 終端 /
  リバースプロキシを前段に置く
- operator/Takosumi runtime secret (`PLATFORM_PRIVATE_KEY` /
  `PLATFORM_PUBLIC_KEY` / `ENCRYPTION_KEY` / `EXECUTOR_PROXY_SECRET` /
  `TAKOS_INTERNAL_API_SECRET`) は鍵ローテーション計画と一緒に管理する

詳細な production checklist は [Kubernetes](/hosting/kubernetes) と各
cloud-specific ページを参照してください。 :::

セルフホストは検証専用ではありません。PostgreSQL / Redis / S3-compatible object
storage / TLS / secret management を production-grade な backing service に
置き換えた構成は production packaging として扱えます。本ドキュメントの範囲外
の項目は [範囲外](/hosting/differences#本ドキュメントの範囲外)
を参照してください。

## 統合 distribution からこの target を選ぶ

Takos product distribution artifact は `takos/deploy/` にあり、
`takos-private/distribution.yml` は private operator が target を選ぶ instance
config です。Self-hosted (docker-compose) を kernel host に選ぶには:

```yaml
# takos-private/distribution.yml
distribution:
  kernel_host:
    target: selfhosted
    region: local
    compose_file: compose.server.yml
```

## target-specific 設定

Self-hosted (docker-compose) target に固有の prerequisites:

- Docker + Docker Compose V2
- PostgreSQL 16+ (pgvector 対応が望ましい)
- Redis 7+
- MinIO または他の S3 互換ストレージ
- TLS 終端 / リバースプロキシ (Caddy / nginx / Traefik) を前段に配置
- Let's Encrypt / 内部 CA で発行した cert (operator 管理)
- 公開ドメインは `*.localhost` ではなく実ドメインに変更

詳細な env / compose 設定は [セットアップ](#セットアップ) と
[サービス構成](#サービス構成) を参照。

## deploy 実行

5 target 共通の quick runbook です。target ごとの差は `distribution.yml` の
`kernel_host.target` だけで、`distribute:apply` が target 固有 backend (wrangler
/ Helm / docker-compose) に dispatch します:

```bash
# 共通手順 (5 target で同じ)
cd takos-private
deno task generate:keys:production --per-cloud
# distribution.yml を編集 (kernel_host.target = selfhosted)
deno task distribute:dry-run --confirm production
deno task distribute:apply --confirm production
cd ../takosumi-cloud
deno run --config deno.json --allow-all packages/cli/src/main.ts accounts seed \
  --issuer https://accounts.selfhosted.example.com \
  --subject tsub_admin \
  --client-id takos-admin \
  --redirect-uri https://admin.takos.example.com/auth/oidc/callback \
  > accounts-seed-plan.json
```

`distribute:apply` は `kernel_host.target=selfhosted` を見て内部で
`docker compose -f compose.server.yml up -d` を呼び出します。

## 必要なもの

- Docker + Docker Compose V2
- PostgreSQL 16+（pgvector 対応が望ましい）
- Redis 7+
- MinIO（S3 互換ストレージ）

## セットアップ

### 1. 環境変数を準備

ローカル開発・動作確認用:

```bash
cp .env.local.example .env.local
```

private server stack を使う場合は `takos-private/.env.server.example` を元に
`takos-private/.env.server` を作成し、`PLATFORM_PRIVATE_KEY` /
`PLATFORM_PUBLIC_KEY` / `ENCRYPTION_KEY` / `S3_SECRET_ACCESS_KEY` /
`MINIO_ROOT_PASSWORD` などのすべての secret を `takos-dev-secret`
のようなプレースホルダから差し替えてください:

```bash
cd takos-private
cp .env.server.example .env.server
# .env.server を編集し、secret 系をすべて本番用の値に置き換える
```

`takos-private/compose.server.yml` で起動する場合は `takos-private` の Deno task
を使ってください:

```bash
cd takos-private
deno task server:up
```

この stack の定義は `takos-private/compose.server.yml`
にあります。`takos-private/.env.server.example` を元に private server stack
の値を揃えてください。

### 2. 環境変数の全リスト

#### ドメイン・ポート設定

| 変数                          | デフォルト        | 用途                                                     |
| ----------------------------- | ----------------- | -------------------------------------------------------- |
| `TAKOS_ADMIN_DOMAIN`          | `admin.localhost` | 管理画面のドメイン                                       |
| `TAKOS_TENANT_BASE_DOMAIN`    | `app.localhost`   | テナント用ベースドメイン                                 |
| `TAKOS_WORKER_PORT`           | `8787`            | Takos Worker の公開ポート                                |
| `TAKOS_DISPATCH_PORT`         | `8788`            | Dispatch の公開ポート                                    |
| `TAKOS_RUNTIME_HOST_PORT`     | `8789`            | Runtime Host のポート                                    |
| `TAKOS_EXECUTOR_HOST_PORT`    | `8790`            | Executor Host のポート                                   |
| `TAKOS_RUNTIME_PORT`          | `8081`            | Runtime のホスト側公開ポート（container `8080` に map）  |
| `TAKOS_EXECUTOR_PORT`         | `8082`            | Executor のホスト側公開ポート（container `8080` に map） |

`takos-private/compose.server.yml` では `TAKOS_ADMIN_DOMAIN` /
`TAKOS_TENANT_BASE_DOMAIN` を受け取り、takos-worker プロセスには `ADMIN_DOMAIN` /
`TENANT_BASE_DOMAIN` として渡す。compose を使わずに起動する場合は `ADMIN_DOMAIN`
/ `TENANT_BASE_DOMAIN` を直接設定する。

#### インフラ接続

| 変数           | デフォルト                                     | 用途                |
| -------------- | ---------------------------------------------- | ------------------- |
| `DATABASE_URL` | `postgresql://takos:takos@postgres:5432/takos` | PostgreSQL 接続 URL |
| `REDIS_URL`    | `redis://redis:6379`                           | Redis 接続 URL      |

private stack の `takos-private/compose.server.yml` は PostgreSQL を host
`5432`、Redis を host `6379` に公開します。OSS local stack の
`TAKOS_POSTGRES_PORT` / `TAKOS_REDIS_PORT` override とは別の運用面です。

#### オブジェクトストレージ（control plane 用）

control の Node resolver は `AWS_S3_*` 系が設定されていれば S3/MinIO
を使います。現在の `takos-private/.env.server.example` は minimal private stack
として `TAKOS_LOCAL_DATA_DIR` を設定し、control-plane の bucket は local
persistent storage に落とします。control-plane も MinIO / S3 に向ける場合だけ、
以下の `AWS_S3_*` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` を追加します。

| 変数                           | 例                            | 用途                              |
| ------------------------------ | ----------------------------- | --------------------------------- |
| `AWS_REGION`                   | `us-east-1`                   | S3 リージョン                     |
| `AWS_S3_ENDPOINT`              | `http://minio:9000`           | S3 エンドポイント（MinIO 互換可） |
| `AWS_S3_GIT_OBJECTS_BUCKET`    | `takos-private-tenant-source` | Git objects バケット              |
| `AWS_S3_OFFLOAD_BUCKET`        | `takos-private-tenant-source` | offload バケット                  |
| `AWS_S3_TENANT_SOURCE_BUCKET`  | `takos-private-tenant-source` | tenant source バケット            |
| `AWS_S3_WORKER_BUNDLES_BUCKET` | `takos-private-tenant-source` | worker bundles バケット           |
| `AWS_S3_TENANT_BUILDS_BUCKET`  | `takos-private-tenant-source` | tenant builds バケット            |
| `AWS_ACCESS_KEY_ID`            | `takos`                       | アクセスキー                      |
| `AWS_SECRET_ACCESS_KEY`        | `takos-dev-secret`            | シークレットキー                  |

#### オブジェクトストレージ（runtime-service 用）

runtime-service は `S3_*` 系を読みます。

| 変数                   | デフォルト                    | 用途                   |
| ---------------------- | ----------------------------- | ---------------------- |
| `S3_ENDPOINT`          | `http://minio:9000`           | S3 エンドポイント      |
| `S3_REGION`            | `us-east-1`                   | S3 リージョン          |
| `S3_ACCESS_KEY_ID`     | `takos`                       | アクセスキー           |
| `S3_SECRET_ACCESS_KEY` | `takos-dev-secret`            | シークレットキー       |
| `S3_BUCKET`            | `takos-private-tenant-source` | Runtime が使うバケット |
| `MINIO_ROOT_USER`      | `takos`                       | MinIO 管理ユーザー     |
| `MINIO_ROOT_PASSWORD`  | `takos-dev-secret`            | MinIO 管理パスワード   |

private stack の `takos-private/compose.server.yml` は MinIO を host `9000` /
`9001` に固定公開します。OSS local stack の `TAKOS_MINIO_PORT` /
`TAKOS_MINIO_CONSOLE_PORT` override とは別の運用面です。

#### 認証・暗号化

| 変数                            | 用途                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `PLATFORM_PRIVATE_KEY`          | Takos product-internal runtime signing 用の PKCS#8 RSA 秘密鍵 PEM (`-----BEGIN PRIVATE KEY-----`) |
| `PLATFORM_PUBLIC_KEY`           | Takos product-internal runtime signing 用の RSA 公開鍵                                            |
| `ENCRYPTION_KEY`                | データ暗号化キー（Base64 エンコード済み 32 バイト）                                               |
| `TAKOS_SECRET_STORE_PASSPHRASE` | secret store at-rest 暗号化 passphrase (production / staging で **必須**)                         |
| `OIDC_ISSUER_URL`               | Takosumi Accounts issuer URL                                                                      |
| `OIDC_CLIENT_ID`                | Takosumi Accounts が installation 単位に発行する OIDC client id                                   |
| `OIDC_CLIENT_SECRET`            | 同 OIDC client secret                                                                             |
| `OIDC_REDIRECT_URI`             | `/auth/oidc/callback` の絶対 URL                                                                  |
| `TAKOS_INTERNAL_API_SECRET`     | trusted edge / internal API bridge secret                                                         |

::: danger production / staging では secret-store encryption key が必須
`TAKOS_ENVIRONMENT=production` または `staging` で takosumi を起動するとき、
`TAKOS_SECRET_STORE_PASSPHRASE` / `TAKOS_SECRET_STORE_KEY` /
`TAKOS_SECRET_ENCRYPTION_KEY` / `ENCRYPTION_KEY` のいずれか 1 つは **必須** で、
未設定だと boot 時に fail-closed (`process exit 1`) します。これにより
`PlaceholderSecretBoundaryCrypto` (base64 のみで暗号化されない) への暗黙の
フォールバックを防ぎ、DB に **平文で secret が保存される事故** を遮断します。

ローカル開発で encryption key を意図的に省略したい場合は、明示的に
`TAKOS_ALLOW_PLAINTEXT_SECRETS=1` を設定してください (production / staging は
opt-in を渡しても fail-closed のままです)。 :::

#### AI プロバイダ

| 変数                 | 用途                                  |
| -------------------- | ------------------------------------- |
| `OPENAI_API_KEY`     | OpenAI API キー                       |
| `ANTHROPIC_API_KEY`  | Anthropic API キー（任意）            |
| `GOOGLE_API_KEY`     | Google AI API キー（任意）            |
| `TAKOS_ALLOW_NO_LLM` | `1` にすると LLM キーなしでも起動可能 |

#### OCI Orchestrator

| 変数                          | デフォルト                                        | 用途                                                    |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `TAKOS_OCI_ORCHESTRATOR_PORT` | `9002`                                            | OCI Orchestrator のポート                               |
| `OCI_ORCHESTRATOR_URL`        | `http://oci-orchestrator:9002/`                   | OCI Orchestrator の URL                                 |
| `OCI_ORCHESTRATOR_TOKEN`      |                                                   | OCI Orchestrator 認証トークン（任意）                   |
| `OCI_ORCHESTRATOR_DATA_DIR`   | `/var/lib/takos-private/control/oci-orchestrator` | データディレクトリ                                      |
| `TAKOS_DOCKER_NETWORK`        | `takos-containers`                                | Docker backend が workload container を接続する network |
| `DOCKER_SOCKET_PATH`          | `/var/run/docker.sock`                            | Docker backend が使う Docker socket                     |

#### Worker loop 設定

| 変数                                         | デフォルト                                             | 用途                                 |
| -------------------------------------------- | ------------------------------------------------------ | ------------------------------------ |
| `TAKOS_WORKER_POLL_INTERVAL_MS`              | `250`                                                  | ジョブポーリング間隔（ms）           |
| `TAKOS_WORKER_SCHEDULED_INTERVAL_MS`         | `60000`                                                | スケジュールジョブ実行間隔（ms）     |
| `TAKOS_WORKER_HEARTBEAT_FILE`                | `/var/lib/takos-private/takos-worker-heartbeat.json`   | ヘルスチェック用ハートビートファイル |
| `TAKOS_WORKER_HEARTBEAT_TTL_MS`              | `120000`                                               | ハートビート TTL（ms）               |

#### Vectorize（pgvector）

| 変数               | 用途                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `PGVECTOR_ENABLED` | `true` にすると pgvector を使った semantic search が有効になる          |
| `POSTGRES_URL`     | pgvector が入った PostgreSQL の接続 URL（`DATABASE_URL` と同じでも OK） |

### 3. compose を使わない場合

`takos-private/.env.server.example` と `takos-private/compose.server.yml`
を参考にする。

```bash
cp takos-private/.env.server.example takos-private/.env.server
```

## 起動

### Docker Compose

```bash
cd takos-private
deno task server:up
```

バックグラウンドで起動する場合:

```bash
cd takos-private
docker compose --env-file .env.server -f compose.server.yml up --build -d
```

## サービス構成

`takos-private/compose.server.yml` で定義されるサービスの全容:

### インフラ backing services

#### PostgreSQL

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
```

- **イメージ**: `postgres:16-alpine`
- **ホストポート**: `5432` →コンテナポート `5432`
- **初期設定**: DB 名 `takos`、ユーザー `takos`、パスワード `takos`
- **ボリューム**: `takos-private-postgres`（永続化）
- **ヘルスチェック**: `pg_isready -U takos -d takos`（10 秒間隔）

#### Redis

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```

- **イメージ**: `redis:7-alpine`
- **ホストポート**: `6379` →コンテナポート `6379`
- **ボリューム**: `takos-private-redis`（永続化）
- **ヘルスチェック**: `redis-cli ping`（10 秒間隔）
- **用途**: queue / coordination backend

hostname routing 用の KV namespace は Redis ではなく、専用の persistent KV
resolver で解決されます。

#### MinIO

```yaml
services:
  minio:
    image: minio/minio:latest
    command: server /data --console-address :9001
    ports:
      - "9000:9000"
      - "9001:9001"
```

- **イメージ**: `minio/minio:latest`
- **ホストポート**: API `9000` / コンソール `9001`
- **ボリューム**: `takos-private-minio`（永続化）
- **コンソール**: `http://localhost:9001` でブラウザから操作可能
- **用途**: S3-compatible object store

`minio-init` サービスが起動後に `mc mb` でバケットを自動作成する。

### Runtime stack services

| Service          | 役割                                                        |
| ---------------- | ----------------------------------------------------------- |
| `takos-worker`      | OIDC consumer / Web UI / public API gateway                 |
| `takosumi`       | AppSpec install / Deployment apply engine                   |
| `takosumi-cloud` | Takosumi Accounts / Installation ledger / billing dashboard |
| `takos-git`      | Git Smart HTTP / refs / objects / source resolution         |
| `takos-agent`    | Takos agent execution service                               |

AppSpec の source fetch、`publish` / `listen` resolution、Deployment apply は
`takosumi`、build は build service / CI、Installation / OIDC / billing は
self-host operator の Takosumi Accounts (`takosumi-cloud`) が担当します。

### ネットワーク構成

| ネットワーク       | 用途                                        |
| ------------------ | ------------------------------------------- |
| `default`          | control plane サービス間通信                |
| `takos-containers` | OCI Orchestrator が管理するコンテナとの通信 |

### ボリューム

| ボリューム                   | 用途                           |
| ---------------------------- | ------------------------------ |
| `takos-private-postgres`     | PostgreSQL データ永続化        |
| `takos-private-redis`        | Redis データ永続化             |
| `takos-private-minio`        | MinIO オブジェクトストア永続化 |
| `takos-private-control-data` | Control Plane 共有データ       |

## PostgreSQL + pgvector のセットアップ

セマンティック検索を使うには pgvector が必要。

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

PostgreSQL backend は takos-worker 起動時に
`takos/db/migrations-control/migrations` を self-host migration runner で自動適用
する。Wrangler の local D1 backend を単体で使う場合だけ、
`db/migrations-control/migrations` を migration source として Wrangler 側から適用する。

## 停止

```bash
cd takos-private
deno task server:down
```

## ログ確認

```bash
cd takos-private
deno task server:logs
```

## スモークテスト

```bash
cd takos-private
deno task server:smoke
```

## Kubernetes

k8s クラスタにデプロイする場合は [Kubernetes](/hosting/kubernetes) を参照。

## selfhosted reference provider adapter client

bare metal / Docker Compose / VM 上の resource を Takosumi kernel から
takosumi.com reference implementation の配線として呼び出したい場合は
**selfhosted reference provider adapter client**
を使います。`profiles/selfhosted.example.json` で
`clients.provider: "local-container-provider"` を選ぶ構成です。

### 構成

| provider client                    | 用途                                    | 参照クラス                                   |
| ---------------------------------- | --------------------------------------- | -------------------------------------------- |
| `local-container-provider`         | Docker / OCI container deploy           | `src/providers/selfhosted/process.ts`        |
| `local-runtime-agent-registry`     | runtime-agent enrolment store           | `src/providers/selfhosted/provider.ts`       |
| `selfhosted-postgres`              | Postgres lifecycle (psql)               | `src/providers/selfhosted/postgres.ts`       |
| `selfhosted-postgres-coordination` | coordination via Postgres advisory lock | `src/providers/selfhosted/sql.ts`            |
| `filesystem-artifacts`             | filesystem object-storage               | `src/providers/selfhosted/object_storage.ts` |
| `selfhosted-queue`                 | Postgres / file-backed queue            | `src/providers/selfhosted/queue.ts`          |
| `local-secret-store`               | filesystem secret rotation              | `src/providers/selfhosted/secrets.ts`        |
| `selfhosted-router-config`         | reverse proxy config (Caddy / nginx)    | `src/providers/selfhosted/router.ts`         |

### Operator が手動でやること / reference binding が行うこと

| step                                                                | operator             | reference binding |
| ------------------------------------------------------------------- | -------------------- | --------------- |
| Postgres / MinIO / Docker host / reverse proxy 用意                 | yes                  | no              |
| systemd service / supervisor 設定                                   | yes                  | no              |
| `DATABASE_URL` / `S3_*` / `DOCKER_SOCKET_PATH` などを kernel に提供 | yes                  | no              |
| psql 経由の database / schema lifecycle                             | no                   | yes (provider)  |
| filesystem / MinIO bucket lifecycle                                 | no                   | yes (provider)  |
| Docker container deploy / restart                                   | no                   | yes (provider)  |
| reverse proxy config 同期 (Caddyfile / nginx.conf)                  | no                   | yes (provider)  |
| runtime-agent enrolment + work lease                                | yes (process deploy) | yes (work pull) |
| drift 検出 / rollback                                               | no                   | yes (provider)  |

### runtime-agent on bare metal

selfhosted reference provider adapter と一緒に runtime-agent を bare metal
に置く例 (systemd):

```ini
# /etc/systemd/system/takos-runtime-agent.service
[Unit]
Description=Takos runtime-agent (selfhosted)
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
EnvironmentFile=/etc/takos/runtime-agent.env
ExecStart=/usr/local/bin/deno run \
  --allow-net --allow-env --allow-read --allow-write \
  --allow-run=docker,psql,createdb \
  /opt/takos/runtime-agent.ts
Restart=always
User=takos
Group=docker

[Install]
WantedBy=multi-user.target
```

`/etc/takos/runtime-agent.env`:

```bash
TAKOS_KERNEL_URL=https://admin.takos.example.com
TAKOS_RUNTIME_AGENT_TOKEN=...
DATABASE_URL=postgresql://takos:...@localhost:5432/takos
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
DOCKER_SOCKET_PATH=/var/run/docker.sock
```

agent は kernel に enroll → heartbeat → lease pull → psql / docker / file ops
を実行→結果を report します。Docker socket access は Docker group
経由で許可します。

### routing layer (selfhosted) の設定

`selfhosted-router-config` provider client は Caddy / nginx の config file を
materialize します。operator がやること:

- Caddy or nginx を install / systemd service として常駐
- TLS cert (Let's Encrypt + certbot) を自動更新する仕組みを設定
- profile の `pluginConfig.operator.takosumi.selfhosted.routerConfig` に
  `configPath` (例: `/etc/caddy/Caddyfile.d/takos.conf`) と `reloadCommand` (例:
  `systemctl reload caddy`) を設定

kernel がやること:

- per-tenant route block (host header → upstream) の同期
- TLS site directive 同期 (Let's Encrypt はそれ自体が renew する)
- drift 検出 (config file の actual content vs desired)

詳細な runbook と credential injection の topology は
[Multi-cloud](/hosting/multi-cloud) を参照してください。

## 次に読むページ

- [ローカル開発](/hosting/local) --- 開発用のローカル環境
- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [Cloudflare](/hosting/cloudflare) --- Cloudflare にデプロイする場合
- [AWS](/hosting/aws) --- AWS にデプロイする場合
- [GCP](/hosting/gcp) --- GCP にデプロイする場合
- [Kubernetes](/hosting/kubernetes) --- k8s クラスタへのデプロイ
