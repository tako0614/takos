# GCP

このページは **Takos kernel を Google Kubernetes Engine (GKE) に Helm
でホストする operator** 向けです。current OSS surface は
`deploy/helm/takos/values-gcp.yaml` overlay です。

::: warning current contract GCP ページの契約は Helm chart + GCP overlay
までです。Cloud Run へ Takos kernel を直接デプロイする手順、Firestore / Pub/Sub
/ Secret Manager を app resource backend として自動 materialize する
matrix、Terraform overlay は current docs contract ではありません。
:::

Takos 上で group を deploy する方法は [Deploy](/deploy/) を参照してください。
current contract に含まれない項目は
[Not A Current Contract](/hosting/differences#not-a-current-contract)
も参照してください。

## Helm overlay が行うこと

`values-gcp.yaml` は base chart に対して次を設定します:

| 項目            | current value                                                                            |
| --------------- | ---------------------------------------------------------------------------------------- |
| database        | bundled PostgreSQL を無効化し、`externalDatabase.url` を使う                             |
| redis           | bundled Redis を無効化し、`externalRedis.url` を使う                                     |
| object storage  | bundled MinIO を無効化し、GCS の S3 interoperability endpoint を `externalS3` として使う |
| ingress         | GCE ingress class と managed certificate annotation を使う                               |
| service account | Workload Identity 用 annotation を受け取る                                               |
| network policy  | runtime から public HTTPS object storage への egress を追加する                          |
| workloads       | control / runtime / executor / oci-orchestrator を Kubernetes Deployment として動かす    |

chart が生成する object storage env は `AWS_S3_*` と runtime-service 互換の
`S3_*` です。GCP overlay では `externalS3.endpoint` が
`https://storage.googleapis.com` になり、GCS interoperability を S3-compatible
storage として扱います。

## 必要な外部サービス

- GKE cluster
- PostgreSQL endpoint (例: Cloud SQL + proxy / connector)
- Redis endpoint (例: Memorystore)
- GCS bucket with S3 interoperability access, または S3-compatible object
  storage
- GCE Ingress
- External Secrets Operator などの secret 管理、または Helm values で secret
  を作成する運用

`values-gcp.yaml` は `secrets.create: false` を前提に、既定では chart の release
fullname 由来の Secret 名を参照します。`<release>` は Helm release
名から決まり、各 Secret は `<release>-platform` / `<release>-auth` /
`<release>-llm` / `<release>-database` / `<release>-redis` / `<release>-s3`
になります。外部 secret を使っていて 名前が異なる場合だけ
`secrets.existingSecrets.*` を設定してください。

外部 secret の `platform` には `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` /
`ENCRYPTION_KEY` / `EXECUTOR_PROXY_SECRET` / `TAKOS_INTERNAL_API_SECRET`
を含めてください。 外部 secret の `s3` には、GCS interoperability の HMAC
credential として `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` と
`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` を含めてください。current Helm path
は S3-compatible adapter を使うため、Workload Identity だけでは object storage
credential にはなりません。

runtime pod の NetworkPolicy は base chart で egress を絞ります。GCP overlay は
standard Kubernetes NetworkPolicy で DNS 名を指定できないため、private network
宛を除く public HTTPS egress を追加します。Private Service Connect や CNI の
FQDN policy を使う場合は `networkPolicy.runtime.extraEgress`
を環境に合わせて上書きしてください。

## インストール

```bash
cd deploy/helm/takos
helm dependency update

helm upgrade --install takos . \
  --namespace takos \
  --create-namespace \
  -f values.yaml \
  -f values-gcp.yaml \
  --set externalDatabase.url="postgresql://user:pass@cloud-sql-proxy:5432/takos" \
  --set externalRedis.url="redis://memorystore-endpoint:6379" \
  --set externalS3.bucket="takos-tenant-source" \
  --set serviceAccount.annotations."iam\\.gke\\.io/gcp-service-account"="takos@project.iam.gserviceaccount.com"
```

GCE Ingress の static IP は overlay の `ingress.annotations`
で指定します。ManagedCertificate は chart が `ingress.gcpManagedCertificate`
から作成し、既定では admin domain と tenant wildcard domain を入れます。既存の
ManagedCertificate を使う場合や domain 構成を変える場合は
`ingress.gcpManagedCertificate.name` / `ingress.gcpManagedCertificate.domains`
を上書きしてください。

## chart contract に含まれないもの

- Cloud Run への Takos kernel direct deploy
- Cloud Run は tenant image workload adapter として OCI orchestrator
  経由で使う対象であり、 kernel hosting surface ではない
- Firestore / Pub/Sub / Secret Manager を app resource backend として自動
  provisioning する contract
- Terraform による GCP resource 作成手順
- GCP 固有 adapter 名を deploy manifest author 向けの public surface として固定
  する contract

必要なら operator が追加 adapter / external service
を構成できますが、このページは Helm overlay で実際に表現されている範囲だけを
contract とします。

## 次に読むページ

- [Kubernetes](/hosting/kubernetes) --- base Helm chart
- [AWS](/hosting/aws) --- EKS overlay
- [環境ごとの差異](/hosting/differences) --- current hosting surface の比較
