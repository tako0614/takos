# 環境ごとの差異

このページは **Takos kernel をどのホスト環境に置いたときに何が変わるか**を説明します。Takos manifest は provider-neutral で、abstract type (`sql`, `object-store`, `key-value`, etc.) で書きます。Cloudflare はリファレンス backend、他は互換 backend です。

Takos 上で app を deploy する方法は [Deploy](/deploy/) を参照してください。

## Provider status の用語

provider ごとの実装状態を説明する際、次の 3 つの用語を使います。

| 用語 | 意味 |
| --- | --- |
| `native` | Cloudflare の native 実装（D1, R2, KV, Queues, Vectorize, Workflows, Durable Objects など） |
| `compatible` | Takos-managed runtime または provider-backed な互換 backend で同じ spec を実現する |
| `unsupported` | 現在未対応 |

## Resource Mapping

| abstract type | Cloudflare | AWS | GCP | Self-hosted |
| --- | --- | --- | --- | --- |
| `sql` | native (D1) | compatible (PostgreSQL) | compatible (PostgreSQL) | compatible (PostgreSQL) |
| `object-store` | native (R2) | compatible (S3) | compatible (GCS) | compatible (MinIO) |
| `key-value` | native (KV Namespace) | compatible (DynamoDB or Takos KV runtime) | compatible (Firestore or Takos KV runtime) | compatible (Takos KV runtime) |
| `queue` | native (Queues) | compatible (SQS) | compatible (Pub/Sub) | compatible (Redis-backed queue) |
| `vector-index` | native (Vectorize) | compatible (pgvector) | compatible (pgvector) | compatible (pgvector) |
| `analytics-engine` | native (Analytics Engine) | compatible (Takos analytics runtime) | compatible (Takos analytics runtime) | compatible (Takos analytics runtime) |
| `secret` | native (Secrets / generated value) | compatible (AWS Secrets Manager) | compatible (GCP Secret Manager) | compatible (Kubernetes Secret) |
| `workflow` | native (Workflows) | compatible (Takos workflow runtime) | compatible (Takos workflow runtime) | compatible (Takos workflow runtime) |
| `durable-object` | native (Durable Objects) | compatible (Takos durable runtime) | compatible (Takos durable runtime) | compatible (Takos durable runtime) |

Cloudflare-native の public surface は維持しつつ、互換 backend では provider-backed なものと Takos-managed runtime で吸収するものに分かれます。

## Workload Mapping

| manifest | Cloudflare | Other providers |
| --- | --- | --- |
| Worker compute (`build` あり) | native (Workers runtime) | compatible (provider-dependent / adapter-based) |
| Service compute (`image` あり, `build` なし) | native (OCI or provider-specific service hosting) | compatible (provider-dependent) |
| Attached Container (`containers:`) | compatible (OCI deployment adapter) | compatible (provider-dependent worker-attached container workload) |

## 重要な境界

- public spec は provider-neutral な abstract type を使う
- Cloudflare backend では spec を `native` 実装に解決する
- 互換 backend では `compatible` な provider-backed か Takos-managed runtime に解決する
- 現時点で `unsupported` な機能はなし（すべての abstract type は何らかの形で解決される）
- `takos deploy` は同じ manifest surface を使う
- 同じ `app.yml` を全環境で byte-for-byte 同一挙動にする保証はない

## 例

```yaml
storage:
  db:
    type: sql
    bind: DB
  assets:
    type: object-store
    bind: STORAGE
  cache:
    type: key-value
    bind: CACHE
```

Cloudflare backend では通常これがそのまま `D1 / R2 / KV Namespace` に `native` 解決され、互換 backend では Takos runtime が SQL / object storage / KV 相当の実装へ `compatible` 解決します。
