# 環境ごとの差異

> このページでわかること: Cloudflare / AWS / GCP / Kubernetes /
> セルフホストの対応状況の比較。

Takosumi 上で Takos の OpenTofu module を install し、Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment の run ledger を管理する方法は [Deploy](/deploy/) を参照してください。

`distribution.yml` の `kernel_host.target` で選べるのは `cloudflare` / `aws` /
`gcp` / `kubernetes` / `selfhosted` の 5 種類です。Cloudflare は Takos operation
の tracked reference deployment/backend です。Takosumi の public concept は Installation /
Deployment / typed Runs / Connection / ProviderBinding / policy / OutputSnapshot に閉じ、infrastructure proof は operator
evidence として扱います。AWS / GCP / Kubernetes は Helm overlay、selfhosted は
docker-compose で扱い、いずれも Takosumi が apply する同一 OpenTofu module topology の interim materialization です。

このページでの compatible は schema / translation parity を指し、全 provider
で同じ runtime behavior や resource existence を保証する意味ではありません。
target ごとの readiness status は
[Distribution Target Parity](/hosting/target-parity) を参照してください。

## ホスティング対応一覧

| page                                | `kernel_host.target` | 内容                                                                                | バンドル / 想定バックエンド                           |
| ----------------------------------- | -------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [Cloudflare](/hosting/cloudflare)   | `cloudflare`         | Cloudflare Workers / D1 / R2 / KV / Queues を使う tracked reference Workers backend | Cloudflare resources                                  |
| [AWS](/hosting/aws)                 | `aws`                | EKS 向け Helm overlay (`values-aws.yaml`)                                           | external PostgreSQL / Redis / S3-compatible storage   |
| [GCP](/hosting/gcp)                 | `gcp`                | GKE 向け Helm overlay (`values-gcp.yaml`)                                           | external PostgreSQL / Redis / GCS S3 interoperability |
| [Kubernetes](/hosting/kubernetes)   | `kubernetes`         | `takos/deploy/helm/takos` base chart                                                | Bitnami PostgreSQL / Redis / MinIO by default         |
| [Self-hosted](/hosting/self-hosted) | `selfhosted`         | docker-compose (`compose.server.yml`)                                               | PostgreSQL / Redis / S3-compatible storage            |
| [Local](/hosting/local)             | -                    | local development runtime (target ではなく独立 dev runtime)                         | local services                                        |

## Parity / Gate マトリクス

| surface                  | parity の主張                                                             | proof / gate                                       |
| ------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Distribution artifacts   | 同じ schema と dispatch contract を全 target で共有                       | Takosumi docs / OpenTofu module contract / リリースゲート |
| Dispatch target id       | コマンド構築前に canonical id を検証                                      | `takos-private` の `distribute:test`               |
| Cloudflare hosting       | 公開 contract のリファレンス Workers backend                              | opt-in な Cloudflare dry-run / deploy gate         |
| AWS / GCP hosting        | EKS / GKE 向け Helm パッケージング (ECS / Cloud Run kernel host は対象外) | opt-in な Helm / preflight gate                    |
| Kubernetes / selfhosted  | operator 所有のクラスタ / Docker host 向けパッケージング                  | opt-in な Helm / compose preflight gate            |
| Operator infrastructure lifecycle | operator 固有の振る舞い (kernel リリースの default parity ではない) | opt-in な policy-scoped `apply` type Run smoke / live proof |

infrastructure proof は opt-in です。provider credential / cluster / account / remote
gateway を必要とする proof は、operator が用意した環境で gate
ベースに実行します。 docs build と kernel リリースゲートは、provider
実環境への到達性や resource existence parity を要求しません。

## ワークロード一覧

| ワークロード                          | Kubernetes / AWS / GCP のサービス名            |
| ------------------------------------- | ---------------------------------------------- |
| Takos Web / public API gateway        | `takos-worker` ワークロード                       |
| Installation / Deployment run ledger | `takosumi` ワークロード                        |
| Takos Git ホスティング                | `takos-git` ワークロード                       |
| Takos エージェント実行                | `takos-agent` ワークロード                     |
| Takosumi Accounts / install UI        | `takosumi` ワークロード (operator plane) |

## 本ドキュメントの範囲外

次は本ドキュメントの対象外です:

- AWS ECS / Fargate / GCP Cloud Run への Takosumi kernel 直接 deploy 手順
- ECS / Cloud Run を Takosumi kernel hosting target として扱う構成
- DynamoDB / Firestore / SQS / Pub/Sub / cloud secret manager を OpenTofu
  module の外から自動 provisioning すること
- 全 provider で byte-for-byte 同じ runtime behavior の保証
- compatible レポートが resource existence や runtime behavior parity を
  保証する保証
- provider 固有 adapter 名を module author 向け public surface として固定すること

ECS / Cloud Run は tenant image workload adapter として OCI orchestrator
経由で使うことはありますが、Takosumi kernel
自体のホスティング対象ではありません。 provider 固有の adapter や external
service は operator が追加構成できますが、本ドキュメントでは Helm chart /
overlay に存在する設定のみを扱います。
