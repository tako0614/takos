# 環境ごとの差異

Takos は app contract をできるだけ共通化する設計ですが、現行実装では全環境で同じ `app.yml` がそのまま動くわけではありません。Cloudflare の current surface が最も完成度が高く、AWS / GCP / k8s は provider-dependent かつ partial です。

## リソースマッピング

app.yml で `type: d1` と書くと、デプロイ先に応じて適切なバックエンドにマッピングされることを目指しています。ただし、現時点の実装は provider ごとに差があります。

| app.yml | Cloudflare | AWS | GCP | セルフホスト |
| --- | --- | --- | --- | --- |
| `d1` | D1 | PostgreSQL (RDS) | PostgreSQL (Cloud SQL) | PostgreSQL |
| `r2` | R2 | S3 | GCS | MinIO |
| `kv` | KV Namespace | DynamoDB | Firestore | Redis |
| `queue` | CF Queue | SQS | Pub/Sub | PostgreSQL |
| `vectorize` | Vectorize | pgvector | pgvector | pgvector |
| `analyticsEngine` | Analytics Engine | --- | --- | --- |
| `durableObject` | Durable Object | --- | --- | --- |
| `workflow` | CF Workflows | --- | --- | --- |

`---` は現時点で対応するマッピングがないことを示す。Cloudflare 固有のリソース（Analytics Engine, Durable Object, Workflows）は他環境では未対応です。

## ワークロードマッピング

| app.yml | Cloudflare | AWS | GCP | k8s | セルフホスト |
| --- | --- | --- | --- | --- | --- |
| `workers` | CF Workers | provider-dependent | provider-dependent | provider-dependent | Node.js |
| `containers` (CF) | CF Containers | --- | --- | --- | Docker |
| `services` (常設) | partial | partial | partial | partial | Docker Compose |

::: info workers のランタイム
Workers のコードは Workers-compatible な JavaScript/TypeScript。Cloudflare 以外の環境では Node.js の local-platform adapter 上で同じ worker-bundle を実行する。V8 isolate ではなく Node.js プロセスとして動くけど、worker-bundle contract は同一。
:::

## 環境固有の制限

### Cloudflare のみ

以下は Cloudflare 環境でしか使えない:

- **Durable Objects** --- セッション管理、レートリミッタ、ルーティングなどの control plane 機能
- **CF Containers** --- Workers の `containers` フィールド。Durable Object として動くコンテナ
- **Analytics Engine** --- 構造化ログ・メトリクス
- **Workflows** --- CF Workflows ベースのワークフロー実行
- **Dispatch Namespace** --- テナント Worker の論理分離
- **Browser Rendering** --- Puppeteer binding
- **AI binding** --- `@cloudflare/ai` のネイティブバインディング

### AWS

- `d1` は PostgreSQL (RDS) にマッピングする想定
- Durable Objects 未対応
- CF Containers 未対応 → ECS / Fargate で代替
- ただし repo 内の current deploy-group は Cloudflare path を主経路としており、AWS は operator-managed / experimental 扱い

### GCP

- `d1` は PostgreSQL (Cloud SQL) にマッピングする想定
- Durable Objects 未対応
- CF Containers 未対応 → Cloud Run で代替
- ただし repo 内の current deploy-group は Cloudflare path を主経路としており、GCP は operator-managed / experimental 扱い

### k8s

- takos オペレーターが k8s マニフェストで takos をデプロイする
- 全リソースを k8s ネイティブにマッピングするのは目標だが、現行 docs では experimental 扱い
- KV → Redis (StatefulSet)
- R2 → S3 互換 (MinIO)
- Queue → SQS / Redis Streams / PostgreSQL
- Workers → Pod (Node.js)
- Services → Pod (Docker)

::: warning Helm chart
Helm chart (`deploy/helm/takos/`) は計画中。現時点では手動で k8s マニフェストを構成する必要がある。
:::

### セルフホスト (Docker Compose)

- PostgreSQL --- d1 + queue + vectorize のバックエンド
- Redis --- kv のバックエンド
- MinIO --- r2 のバックエンド
- Node.js --- workers の実行環境
- Docker --- containers + services の実行環境

## app.yml は同一ではない

以下は Cloudflare / local の current surface に合わせた最小例です。AWS / GCP / k8s では provider-side の差分や未実装が残ります。

```yaml
name: my-app
workers:
  api:
    main: src/worker.ts
resources:
  db:
    type: d1
    binding: DB
    migrations:
      up: .takos/migrations/db/up
      down: .takos/migrations/db/down
  storage:
    type: r2
    binding: STORAGE
  cache:
    type: kv
    binding: CACHE
```

アプリ開発者のデプロイコマンドはどの環境でも同じ:

```bash
takos deploy-group --env production
```

takos がどのクラウドで動いているかは、takos オペレーターのインストール時の設定（環境変数、wrangler.toml 等）で決まります。アプリ開発者向けの current surface は `takos deploy-group` ですが、全環境で同じ意味になるとは限りません。

## アダプタの実装状況

各アダプタの実装状況。Takos のコードベースに実際に存在するもの:

| アダプタ | パッケージ | ステータス |
| --- | --- | --- |
| S3 Object Store | `@takos/control/bindings/s3-object-store` | stable |
| GCS Object Store | `@takos/control/bindings/gcs-object-store` | stable |
| DynamoDB KV Store | `@takos/control/bindings/dynamo-kv-store` | stable |
| Firestore KV Store | `@takos/control/bindings/firestore-kv-store` | stable |
| SQS Queue | `@takos/control/bindings/sqs-queue` | stable |
| Pub/Sub Queue | `@takos/control/bindings/pubsub-queue` | stable |
| pgvector Store | `@takos/control/bindings/pgvector-store` | stable |
| Node.js Platform | `@takos/control/platform/adapters/node` | stable |
| Workers Platform | `@takos/control/platform/adapters/workers` | stable |

## ランタイム構成の違い

| コンポーネント | Cloudflare | AWS / GCP / k8s | セルフホスト |
| --- | --- | --- | --- |
| Control Web | CF Worker | Node.js (ECS / Cloud Run / Pod) | Node.js |
| Dispatch | CF Worker | Node.js | Node.js |
| Background Worker | CF Worker (Queue consumer) | Node.js (ポーリング) | Node.js (ポーリング) |
| Runtime Host | CF Container | Node.js (ECS / Cloud Run / Pod) | Node.js |
| DB | D1 (SQLite) | PostgreSQL | PostgreSQL |
| Storage | R2 | S3 / GCS | MinIO |
| KV | KV Namespace | DynamoDB / Firestore | Redis |
| Queue | CF Queues | SQS / Pub/Sub | PostgreSQL |
| Vector | Vectorize | pgvector | pgvector |
| Container 管理 | CF Containers (DO) | ECS / Cloud Run / k8s | OCI Orchestrator + Docker |

## 意図的に残している差分

### ランタイムの実行モデル

- Cloudflare: V8 isolate 上で Workers API を直接利用
- その他: Node.js プロセス上で Workers-compatible adapter を使用

Workers-compatible だけど、Cloudflare backend と byte-for-byte 同一ではない。これは設計上の意図的な差分。

### Durable Objects

Cloudflare 環境でのみ動作する。control plane が使う DO（SessionDO, RunNotifierDO, RateLimiterDO, RoutingDO, GitPushLockDO, NotificationNotifierDO）は他環境では代替メカニズムが使われるか、未実装。

### Dispatch Namespace

テナント Worker の論理分離は Cloudflare Dispatch Namespace で行われる。他の環境ではテナント Worker は直接 runtime-host に dispatch される。

## サポートマトリクス

| 環境 | ステータス | 備考 |
| --- | --- | --- |
| Cloudflare Workers + CF Containers | `stable` | current primary deploy surface |
| AWS (ECS + S3 + DynamoDB + SQS) | `experimental` | provider-dependent / partial |
| GCP (Cloud Run + GCS + Firestore + Pub/Sub) | `experimental` | provider-dependent / partial |
| k8s | `experimental` | provider-dependent / partial |
| セルフホスト (Docker Compose) | `stable` | `.env.local.example` + `compose.local.yml` |
| ローカル開発 | `stable` | 開発・テスト用 |

## ホスティング環境ごとのセットアップ

takos オペレーター向け。takos 自体をどのクラウドにホストするかの設定ガイド:

- [Cloudflare](/hosting/cloudflare) --- Cloudflare Workers に takos をホストする
- [AWS](/hosting/aws) --- AWS (ECS + S3 + DynamoDB + SQS) に takos をホストする
- [GCP](/hosting/gcp) --- GCP (Cloud Run + GCS + Firestore + Pub/Sub) に takos をホストする
- [Kubernetes](/hosting/kubernetes) --- k8s クラスタに takos をホストする
- [セルフホスト](/hosting/self-hosted) --- Docker Compose でセルフホストする
- [ローカル開発](/hosting/local) --- 開発用のローカル環境
