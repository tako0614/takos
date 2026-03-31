# 環境ごとの差異

Takos の public app contract は Cloudflare-native です。`.takos/app.yml` では `d1`、`r2`、`kv` のような Cloudflare-native 名を使い、Takos runtime がその spec を各 backend 上で実現します。Cloudflare backend は基準 backend、AWS/GCP/k8s/local は互換 backend です。

## Resource Mapping

| public kind | Cloudflare | AWS | GCP | Self-hosted |
| --- | --- | --- | --- | --- |
| `d1` | D1 | PostgreSQL | PostgreSQL | PostgreSQL |
| `r2` | R2 | S3 | GCS | MinIO |
| `kv` | KV Namespace | DynamoDB or Takos KV runtime | Firestore or Takos KV runtime | Takos KV runtime |
| `queue` | Queues | SQS | Pub/Sub | Redis-backed queue |
| `vectorize` | Vectorize | pgvector-backed vector store | pgvector-backed vector store | pgvector-backed vector store |
| `analyticsEngine` | Analytics Engine | Takos analytics runtime | Takos analytics runtime | Takos analytics runtime |
| `secretRef` | Secrets / generated value | AWS Secrets Manager | GCP Secret Manager | Kubernetes Secret |
| `workflow` | Workflows | Takos workflow runtime | Takos workflow runtime | Takos workflow runtime |
| `durableObject` | Durable Objects | Takos durable runtime | Takos durable runtime | Takos durable runtime |

Cloudflare-native の public surface は維持しつつ、互換 backend では `provider-backed` なものと Takos-managed runtime で吸収するものに分かれます。

## Workload Mapping

| manifest | Cloudflare | Other providers |
| --- | --- | --- |
| `workers` | Workers runtime | provider-dependent / adapter-based |
| `services` | OCI or provider-specific service hosting | provider-dependent |
| `containers` | CF Containers | Cloudflare-specific |

## 重要な境界

- public spec は Cloudflare-native 名を使う
- Takos runtime は Cloudflare backend では spec を直接実現し、互換 backend では `provider-backed` か Takos-managed runtime に解決する
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

Cloudflare backend では通常これがそのまま `D1 / R2 / KV Namespace` に解決され、互換 backend では Takos runtime が SQL / object storage / KV 相当の実装へ解決します。
