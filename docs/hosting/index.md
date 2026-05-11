# Hosting

このセクションは **Takosumi kernel をホストする operator** 向けです。Takos 上で
**group を deploy する開発者** は [Deploy](/deploy/) を参照してください。

Takosumi kernel は **5 つの kernel host target** を持ちます。Takos product
distribution artifact の正本は `takos/deploy/` にあり、operator は
`takos-private/distribution.yml` を private instance config として使って
`kernel_host.target` を 1 つ選び、共通の `deno task distribute:apply` を実行すると、target 固有の backend (wrangler /
Helm / docker-compose) に dispatch されます。Cloudflare は tracked reference
Workers backend、AWS / GCP / Kubernetes は Helm packaging、 selfhosted は
docker-compose packaging として扱います。

## 想定読者

| 読者                                      | 読むページ                           |
| ----------------------------------------- | ------------------------------------ |
| Takosumi kernel を managed (takos.jp) で使う | このセクションは不要                 |
| Takosumi kernel を自分でホストする operator  | このセクション全体                   |
| Takos 上で group を作る developer         | [Deploy](/deploy/) と [Apps](/apps/) |

## 5 つの kernel host target

`distribution.yml` の `kernel_host.target` に指定する id は次の 5 つです。

| target       | hosting page                        | backend                               | 想定 use case                                     |
| ------------ | ----------------------------------- | ------------------------------------- | ------------------------------------------------- |
| `cloudflare` | [Cloudflare](/hosting/cloudflare)   | Cloudflare Workers + D1 / R2 / KV     | edge-first, low-ops, takos.jp default             |
| `aws`        | [AWS](/hosting/aws)                 | EKS Helm overlay (`values-aws.yaml`)  | AWS native, VPC-only access, RDS / S3 を統合      |
| `gcp`        | [GCP](/hosting/gcp)                 | GKE Helm overlay (`values-gcp.yaml`)  | GCP native, Cloud SQL / GCS を統合                |
| `kubernetes` | [Kubernetes](/hosting/kubernetes)   | base Helm chart (`values-k8s.yaml`)   | 既存 k8s クラスタ / on-prem / 他 cloud manage k8s |
| `selfhosted` | [Self-hosted](/hosting/self-hosted) | docker-compose (`compose.server.yml`) | bare metal / VM / airgap / on-prem                |

ローカル開発は target ではなく独立した dev runtime です:
[ローカル開発](/hosting/local) を参照してください。

multi-cloud / hybrid 構成 (例: kernel host を 1 target、tenant runtime を別
target にする) は [Multi-cloud](/hosting/multi-cloud) を参照してください。

## 共通 quick deploy runbook

5 target いずれでも手順は同じです。target ごとの差は `distribution.yml` の
`kernel_host.target` だけです:

```bash
# 1. platform secret 5 個 + per-cloud encryption key を発行
cd takos-private
deno task generate:keys:production --per-cloud

# 2. distribution.yml を編集 (kernel_host.target を決める)
cp distribution.yml.example distribution.yml
$EDITOR distribution.yml

# 3. dry-run で plan を確認
deno task distribute:dry-run --confirm production

# 4. 本番へ apply (wrangler / Helm / compose のいずれかに dispatch される)
deno task distribute:apply --confirm production

# 5. Takosumi Accounts seed plan を生成 (identity / billing / AppInstallation owner)
cd ../takosumi-cloud
deno run --config deno.json --allow-all packages/cli/src/main.ts accounts seed \
  --issuer https://accounts.example.com \
  --subject tsub_admin \
  --client-id takos-admin \
  --redirect-uri https://admin.takos.example.com/auth/oidc/callback \
  > accounts-seed-plan.json
```

target 固有の prerequisites (Cloudflare account / IAM role / kubeconfig / Docker
host など) は各 target page の "target-specific 設定" セクションを
参照してください。

secret 値、provider credentials、Terraform live tfvars は `takos-private` が
正本です。`takos/` 側の Terraform / Helm は non-secret managed resource id と
Secret 名だけを扱います。詳細は [Hosting Secret Policy](/hosting/secrets)
を参照してください。

## Backend の差分

current hosting surface の比較と current contract に含まれない項目は
[環境ごとの差異](/hosting/differences) と
[Not A Current Contract](/hosting/differences#not-a-current-contract) を参照。
target ごとの GA / beta / smoke-only / unsupported status は
[Distribution Target Parity](/hosting/target-parity) を正本にします。

## 多クラウド対応のクイック参照

`distribution.yml` の `kernel_host.target` (1 target) と
`tenant_runtime.targets` (複数可) を別々に設定することで multi-cloud
構成を作れます:

| 構成                                           | kernel_host.target | tenant_runtime.targets     |
| ---------------------------------------------- | ------------------ | -------------------------- |
| Cloudflare のみ                                | `cloudflare`       | `[cloudflare]`             |
| Cloudflare control + AWS tenant runtime        | `cloudflare`       | `[cloudflare, aws]`        |
| Cloudflare control + GCP tenant runtime        | `cloudflare`       | `[cloudflare, gcp]`        |
| Cloudflare control + Kubernetes tenant runtime | `cloudflare`       | `[cloudflare, kubernetes]` |
| AWS のみ                                       | `aws`              | `[aws]`                    |
| GCP のみ                                       | `gcp`              | `[gcp]`                    |
| Selfhosted (bare metal / Docker)               | `selfhosted`       | `[selfhosted]`             |

## Parity / Gate Matrix

| area                         | gate / proof                                                   | default gate |
| ---------------------------- | -------------------------------------------------------------- | ------------ |
| Manifest parsing / dispatch  | `takos-private` `deno task distribute:test`                    | yes          |
| Cloudflare reference backend | private `distribute:dry-run` + Cloudflare deploy dry-run       | opt-in       |
| AWS / GCP / Kubernetes Helm  | private `distribute:dry-run` preflight + Helm chart validation | opt-in       |
| Selfhosted compose packaging | private `distribute:dry-run` preflight + compose config        | opt-in       |
| Provider materialization     | provider-plugin dry-runs / live smoke scripts                  | opt-in       |

Provider proof は operator が明示的に実行する opt-in proof です。CI / release
gate に入れる場合も、各 provider の credential / cluster / account
が揃った環境で gate-backed に実行してください。default docs build や kernel gate
は provider 実環境の proof を要求しません。

選び方ガイドと credential injection の topology は
[Multi-cloud](/hosting/multi-cloud#kernel-host-target-を-multi-cloud-で選ぶ) を
参照してください。

## 次に読むページ

次に読む target page:

- [Cloudflare](/hosting/cloudflare) --- Cloudflare Workers backend
- [AWS](/hosting/aws) --- EKS Helm overlay + AWS provider plugin
- [GCP](/hosting/gcp) --- GKE Helm overlay + GCP provider plugin
- [Kubernetes](/hosting/kubernetes) --- base Helm chart + k8s provider plugin
- [Self-hosted](/hosting/self-hosted) --- docker-compose + selfhosted plugin
- [Multi-cloud](/hosting/multi-cloud) --- 5 target 横断 runbook
- [Target Parity](/hosting/target-parity) --- target ごとの readiness status
- [Secret Policy](/hosting/secrets) --- Terraform / Helm / takos-private の
  secret 境界
- [ローカル開発](/hosting/local) --- 開発用 dev runtime
