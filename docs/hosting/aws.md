# AWS

このページは **Takos kernel を AWS 上の Kubernetes (EKS) に Helm でホストする
operator** 向けです。current OSS surface は `deploy/helm/takos/values-aws.yaml`
overlay です。

::: warning current contract AWS ページの契約は Helm chart + AWS overlay
までです。ECS / Fargate へ Takos kernel を直接デプロイする手順、DynamoDB / SQS /
Secrets Manager を app resource backend として自動 materialize する
matrix、Terraform / CDK overlay は current docs contract ではありません。
:::

Takos 上で group を deploy する方法は [Deploy](/deploy/) を参照してください。
current contract に含まれない項目は
[Not A Current Contract](/hosting/differences#not-a-current-contract)
も参照してください。

## Helm overlay が行うこと

`values-aws.yaml` は base chart に対して次を設定します:

| 項目            | current value                                                                         |
| --------------- | ------------------------------------------------------------------------------------- |
| database        | bundled PostgreSQL を無効化し、`externalDatabase.url` を使う                          |
| redis           | bundled Redis を無効化し、`externalRedis.url` を使う                                  |
| object storage  | bundled MinIO を無効化し、S3-compatible `externalS3` を使う                           |
| ingress         | ALB ingress class と ALB annotation を使う                                            |
| service account | IRSA 用 annotation を受け取る                                                         |
| network policy  | runtime から public HTTPS object storage への egress を追加する                       |
| workloads       | control / runtime / executor / oci-orchestrator を Kubernetes Deployment として動かす |

chart が生成する S3 env は `AWS_S3_*` と runtime-service 互換の `S3_*`
です。デフォルトでは `externalS3.bucket` を各用途に再利用します。用途別 bucket
を分ける場合は `externalS3.gitObjectsBucket` / `offloadBucket` /
`tenantSourceBucket` / `workerBundlesBucket` / `tenantBuildsBucket`
を明示してください。

## 必要な外部サービス

- EKS cluster
- PostgreSQL endpoint (例: RDS)
- Redis endpoint (例: ElastiCache)
- S3 bucket または S3-compatible object storage
- ALB Ingress Controller
- External Secrets Operator / Sealed Secrets などの secret 管理、または Helm
  values で secret を作成する運用

`values-aws.yaml` は `secrets.create: false` を前提に、既定では chart の release
fullname 由来の Secret 名を参照します。`<release>` は Helm release
名から決まり、各 Secret は `<release>-platform` / `<release>-auth` /
`<release>-llm` / `<release>-database` / `<release>-redis` / `<release>-s3`
になります。外部 secret を使っていて 名前が異なる場合だけ
`secrets.existingSecrets.*` を設定してください。

外部 secret の `platform` には `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` /
`ENCRYPTION_KEY` / `EXECUTOR_PROXY_SECRET` / `TAKOS_INTERNAL_API_SECRET`
を含めてください。 外部 secret の `s3` には、IRSA ではなくアクセスキーで使う場合
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` と `S3_ACCESS_KEY_ID` /
`S3_SECRET_ACCESS_KEY` を含めてください。

runtime pod の NetworkPolicy は base chart で egress を絞ります。AWS overlay は
standard Kubernetes NetworkPolicy で DNS 名を指定できないため、private network
宛を除く public HTTPS egress を追加します。VPC endpoint や CNI の FQDN policy
を使う場合は `networkPolicy.runtime.extraEgress`
を環境に合わせて上書きしてください。

## インストール

```bash
cd deploy/helm/takos
helm dependency update

helm upgrade --install takos . \
  --namespace takos \
  --create-namespace \
  -f values.yaml \
  -f values-aws.yaml \
  --set externalDatabase.url="postgresql://user:pass@rds-endpoint:5432/takos" \
  --set externalRedis.url="redis://elasticache-endpoint:6379" \
  --set externalS3.bucket="takos-tenant-source" \
  --set serviceAccount.annotations."eks\\.amazonaws\\.com/role-arn"="arn:aws:iam::123456789012:role/takos"
```

ALB TLS は overlay の
`ingress.annotations.alb.ingress.kubernetes.io/certificate-arn` に ACM
certificate ARN を設定します。

## chart contract に含まれないもの

- ECS / Fargate への Takos kernel direct deploy
- ECS は tenant image workload adapter として OCI orchestrator
  経由で使う対象であり、 kernel hosting surface ではない
- DynamoDB / SQS / Secrets Manager を app resource backend として自動
  provisioning する contract
- Terraform / CDK による AWS resource 作成手順
- AWS 固有 adapter 名を deploy manifest author 向けの public surface として固定
  する contract

必要なら operator が追加 adapter / external service
を構成できますが、このページは Helm overlay で実際に表現されている範囲だけを
contract とします。

## 次に読むページ

- [Kubernetes](/hosting/kubernetes) --- base Helm chart
- [GCP](/hosting/gcp) --- GKE overlay
- [環境ごとの差異](/hosting/differences) --- current hosting surface の比較
