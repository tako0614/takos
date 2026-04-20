# 環境ごとの差異

このページは **current docs contract として公開している hosting surface**
を比較します。provider-neutral resource materialization matrix ではありません。

Takos 上で group を deploy する方法は [Deploy](/deploy/) を参照してください。

## Current Hosting Surface

| page                                | current contract                                                    | bundled / expected backing services                   |
| ----------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| [Cloudflare](/hosting/cloudflare)   | Cloudflare Workers / D1 / R2 / KV / Queues を使う reference backend | Cloudflare resources                                  |
| [Local](/hosting/local)             | local development runtime                                           | local services                                        |
| [Self-hosted](/hosting/self-hosted) | VM / Docker Compose / Helm packaging guidance                       | PostgreSQL / Redis / S3-compatible storage            |
| [Kubernetes](/hosting/kubernetes)   | `deploy/helm/takos` base chart                                      | Bitnami PostgreSQL / Redis / MinIO by default         |
| [AWS](/hosting/aws)                 | EKS 向け Helm overlay (`values-aws.yaml`)                           | external PostgreSQL / Redis / S3-compatible storage   |
| [GCP](/hosting/gcp)                 | GKE 向け Helm overlay (`values-gcp.yaml`)                           | external PostgreSQL / Redis / GCS S3 interoperability |

## Workload Surface

| workload                           | Kubernetes / AWS / GCP Helm surface            |
| ---------------------------------- | ---------------------------------------------- |
| control API / UI                   | `control-web` Deployment                       |
| dispatch                           | `control-dispatch` Deployment                  |
| background jobs                    | `control-worker` Deployment                    |
| tenant worker runtime              | `runtime-host` Deployment                      |
| executor host                      | `executor-host` Deployment                     |
| image-backed services / containers | `oci-orchestrator` Deployment + Service + RBAC |
| agent runtime                      | `runtime` Deployment                           |
| code executor                      | `executor` Deployment                          |

## Not A Current Contract

次は current hosting docs の contract ではありません:

- AWS ECS / Fargate へ Takos kernel を直接 deploy する手順
- GCP Cloud Run へ Takos kernel を直接 deploy する手順
- DynamoDB / Firestore / SQS / Pub/Sub / cloud secret manager を manifest
  resource から自動 provisioning する provider matrix
- 同じ deploy manifest が全 provider で byte-for-byte 同じ runtime behavior
  になる保証
- provider 固有 adapter 名を deploy manifest author 向け public surface
  として固定する contract

provider 固有の adapter や external service は operator
が追加構成できますが、docs では Helm chart / overlay に存在する設定だけを
current contract とします。
