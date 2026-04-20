# Kubernetes

このページは **Takos kernel を Kubernetes に Helm でホストする operator**
向けです。current OSS surface は `deploy/helm/takos` chart です。

Takos 上で group を deploy する方法は [Deploy](/deploy/) を参照してください。

::: warning current contract このページは Helm chart が表現している contract
だけを説明します。provider-neutral resource materialization matrix や、各 cloud
の managed service への自動 provisioning は current Helm contract
ではありません。:::

## Chart components

base chart は次の workload を Kubernetes 上に作ります:

| component          | kind                        | default role                                   |
| ------------------ | --------------------------- | ---------------------------------------------- |
| `control-web`      | Deployment + Service        | HTTP API / control UI                          |
| `control-dispatch` | Deployment + Service        | dispatch path                                  |
| `control-worker`   | Deployment                  | queue / scheduled worker                       |
| `runtime-host`     | Deployment + Service        | tenant runtime host                            |
| `executor-host`    | Deployment + Service        | executor host                                  |
| `oci-orchestrator` | Deployment + Service + RBAC | image-backed service / container orchestration |
| `runtime`          | Deployment + Service + HPA  | agent runtime workload                         |
| `executor`         | Deployment + Service + HPA  | code execution workload                        |

base chart の optional subcharts:

| subchart           | enabled by default | 用途                         |
| ------------------ | ------------------ | ---------------------------- |
| Bitnami PostgreSQL | yes                | control plane database       |
| Bitnami Redis      | yes                | queue / coordination backend |
| Bitnami MinIO      | yes                | S3-compatible object storage |

## Values contract

主な values:

| value                                | 説明                                                      |
| ------------------------------------ | --------------------------------------------------------- |
| `domains.admin`                      | admin / API host                                          |
| `domains.tenantBase`                 | tenant app base host                                      |
| `images.control.repository` / `tag`  | control image                                             |
| `images.runtime.repository` / `tag`  | runtime image                                             |
| `images.executor.repository` / `tag` | executor image                                            |
| `externalDatabase.url`               | `postgresql.enabled: false` のときに使う DB URL           |
| `externalRedis.url`                  | `redis.enabled: false` のときに使う Redis URL             |
| `externalS3.*`                       | `minio.enabled: false` のときに使う S3-compatible storage |
| `secrets.create`                     | chart が Secret を作るか、既存 Secret を参照するか        |
| `secrets.existingSecrets.*`          | 既存 Secret 名                                            |
| `ingress.*`                          | admin / tenant ingress                                    |
| `serviceAccount.annotations`         | IRSA / Workload Identity などの annotation                |

object storage は S3-compatible env として注入されます。base chart は
`AWS_S3_GIT_OBJECTS_BUCKET`, `AWS_S3_OFFLOAD_BUCKET`,
`AWS_S3_TENANT_SOURCE_BUCKET`, `AWS_S3_WORKER_BUNDLES_BUCKET`,
`AWS_S3_TENANT_BUILDS_BUCKET` と runtime-service 互換の `S3_*` env
を生成します。

## インストール

```bash
cd deploy/helm/takos
helm dependency update

helm upgrade --install takos . \
  --namespace takos \
  --create-namespace \
  -f values.yaml \
  --set postgresql.auth.password="change-me" \
  --set minio.auth.rootPassword="change-me"
```

production では Secret 値を `--set` で渡す代わりに External Secrets Operator /
Sealed Secrets / platform secret manager を使い、`secrets.create: false` と
`secrets.existingSecrets.*` を設定してください。

`secrets.existingSecrets.platform` で参照する platform secret には
`PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` / `ENCRYPTION_KEY` /
`EXECUTOR_PROXY_SECRET` / `TAKOS_INTERNAL_API_SECRET` を含めてください。
`secrets.ociOrchestratorToken` を使う場合は、同じ platform secret に
`OCI_ORCHESTRATOR_TOKEN` も含めてください。

## External services

bundled PostgreSQL / Redis / MinIO を使わない場合:

```yaml
postgresql:
  enabled: false
redis:
  enabled: false
minio:
  enabled: false

externalDatabase:
  url: postgresql://user:pass@postgres.example:5432/takos
externalRedis:
  url: redis://redis.example:6379
externalS3:
  endpoint: https://s3.example.com
  region: us-east-1
  bucket: takos-tenant-source
```

`externalS3.bucket` はデフォルトで全 storage
用途に使われます。用途別に分ける場合は `gitObjectsBucket`, `offloadBucket`,
`tenantSourceBucket`, `workerBundlesBucket`, `tenantBuildsBucket` を設定します。

## Workload runtime

Worker compute は Kubernetes Deployment として直接生成されません。current chart
では `runtime-host` が tenant worker runtime を担当し、image-backed `services` /
`containers` は `oci-orchestrator` を通して扱います。

`oci-orchestrator` は chart 内で Deployment / Service / RBAC として作られます。
認証付きで使う場合は `secrets.ociOrchestratorToken` を設定し、chart が作る
platform secret または `secrets.existingSecrets.platform` の
`OCI_ORCHESTRATOR_TOKEN` から渡します。

## chart contract に含まれないもの

- cloud ごとの app resource backend 自動 provisioning
- DynamoDB / Firestore / SQS / Pub/Sub / cloud secret manager の provider matrix
- manifest の abstract resource を各 provider service に必ず materialize
  する保証
- provider 固有 adapter 名を deploy manifest author 向け public surface
  として固定する contract

## 次に読むページ

- [AWS](/hosting/aws) --- EKS overlay
- [GCP](/hosting/gcp) --- GKE overlay
- [環境ごとの差異](/hosting/differences) --- current hosting surface の比較
