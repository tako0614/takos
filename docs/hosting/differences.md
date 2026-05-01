# 環境ごとの差異

このページは **current docs contract として公開している hosting surface**
を比較します。provider-neutral resource materialization matrix ではありません。

Takos 上で group を deploy する方法は [Deploy](/deploy/) を参照してください。

`distribution.yml` の `kernel_host.target` で 1 つを選ぶ canonical target は
`cloudflare` / `aws` / `gcp` / `kubernetes` / `selfhosted` です。Cloudflare は
tracked reference Workers backend で公開 spec の 参照実装の役割も持ちます。AWS /
GCP / Kubernetes は Helm overlay、 selfhosted は docker-compose packaging
として扱います。

このページでの compatible は schema / translation parity を指し、全 provider
で同じ runtime behavior や resource existence を保証する意味ではありません。

## Current Hosting Surface

| page                                | `kernel_host.target` | current contract                                                                    | bundled / expected backing services                   |
| ----------------------------------- | -------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [Cloudflare](/hosting/cloudflare)   | `cloudflare`         | Cloudflare Workers / D1 / R2 / KV / Queues を使う tracked reference Workers backend | Cloudflare resources                                  |
| [AWS](/hosting/aws)                 | `aws`                | EKS 向け Helm overlay (`values-aws.yaml`)                                           | external PostgreSQL / Redis / S3-compatible storage   |
| [GCP](/hosting/gcp)                 | `gcp`                | GKE 向け Helm overlay (`values-gcp.yaml`)                                           | external PostgreSQL / Redis / GCS S3 interoperability |
| [Kubernetes](/hosting/kubernetes)   | `kubernetes`         | `takos/paas/deploy/helm/takos` base chart                                           | Bitnami PostgreSQL / Redis / MinIO by default         |
| [Self-hosted](/hosting/self-hosted) | `selfhosted`         | docker-compose (`compose.server.yml`)                                               | PostgreSQL / Redis / S3-compatible storage            |
| [Local](/hosting/local)             | -                    | local development runtime (target ではなく独立 dev runtime)                         | local services                                        |

## Parity / Gate Matrix

| surface                  | parity claim                                                  | proof / gate                              |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------- |
| Deploy manifest schema   | Same schema and resolution contract across targets            | PaaS docs / contract / release gates      |
| Dispatch target ids      | Canonical ids are validated before command construction       | `takos-private` `distribute:test`         |
| Cloudflare hosting       | Reference Workers backend for the public contract             | opt-in Cloudflare dry-run / deploy gate   |
| AWS / GCP hosting        | Helm packaging for EKS / GKE, not ECS / Cloud Run kernel host | opt-in Helm/preflight gate                |
| Kubernetes / selfhosted  | Packaging for operator-owned cluster / Docker host            | opt-in Helm or compose preflight gate     |
| Provider materialization | Provider-specific behavior, not default kernel release parity | opt-in provider-plugin smoke / live proof |

Provider proof は opt-in です。provider credentials、cluster、account、remote
gateway を必要とする proof は、operator がそれらを用意した環境で gate-backed
に実行します。default docs build / PaaS kernel release gate は provider 実環境の
到達性や resource existence parity を要求しません。

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
- ECS / Cloud Run を Takos kernel hosting target として扱う contract
- DynamoDB / Firestore / SQS / Pub/Sub / cloud secret manager を manifest
  resource から自動 provisioning する provider matrix
- 同じ deploy manifest が全 provider で byte-for-byte 同じ runtime behavior
  になる保証
- compatible report が resource existence や runtime behavior parity を保証する
  contract
- provider 固有 adapter 名を deploy manifest author 向け public surface
  として固定する contract

ECS / Cloud Run は tenant image workload adapter として OCI orchestrator
経由で使うことがありますが、Takos kernel 自体の hosting guide ではありません。
provider 固有の adapter や external service は operator が追加構成できますが、
docs では Helm chart / overlay に存在する設定だけを current contract とします。
