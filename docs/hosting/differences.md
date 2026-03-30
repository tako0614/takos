# 環境ごとの差異

Takos の public app contract は Cloudflare-native です。app.yml では `d1`、`r2`、`kv` のような Cloudflare-native 名を使い、他 provider では translation layer が対応する実装へ変換します。

## Resource Mapping

| public kind | Cloudflare | AWS | GCP | Self-hosted |
| --- | --- | --- | --- | --- |
| `d1` | D1 | PostgreSQL | PostgreSQL | PostgreSQL |
| `r2` | R2 | S3 | GCS | MinIO |
| `kv` | KV Namespace | DynamoDB | Firestore | Redis |
| `queue` | Queues | SQS | Pub/Sub | PostgreSQL / Redis |
| `vectorize` | Vectorize | pgvector | pgvector | pgvector |
| `analyticsEngine` | Analytics Engine | - | - | - |
| `secretRef` | Secrets / generated value | Secrets Manager | Secret Manager | local secret store |
| `workflow` | Workflows | partial | partial | partial |
| `durableObject` | Durable Objects | - | - | - |

Cloudflare-first の current surface が最も完成しています。他 provider は partial です。

## Workload Mapping

| manifest | Cloudflare | Other providers |
| --- | --- | --- |
| `workers` | Workers runtime | provider-dependent / adapter-based |
| `services` | OCI or provider-specific service hosting | provider-dependent |
| `containers` | CF Containers | Cloudflare-specific |

## 重要な境界

- public spec は Cloudflare-native 名を使う
- 他 provider は translation layer で concrete 実装を解決する
- `takos apply` は同じ manifest surface を使う
- 同じ `app.yml` を全環境で byte-for-byte 同一挙動にする保証はない

## 例

```yaml
resources:
  db:
    type: d1
    binding: DB
  storage:
    type: r2
    binding: STORAGE
  cache:
    type: kv
    binding: CACHE
```

Cloudflare では通常これがそのまま `D1 / R2 / KV Namespace` に解決され、他 provider では SQL / object storage / KV 相当の実装に翻訳されます。
