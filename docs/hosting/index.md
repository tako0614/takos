# ホスティング

> このページでわかること: Takosumi kernel を自分のサーバーにホストする方法。

このセクションは Takosumi kernel をセルフホストするオペレーター向けです。アプリをデプロイする開発者は
[Deploy](/deploy/) を参照してください。

Takos product/operator distribution は 5 つのホスティング target runbook を持ちます。 `takos-private/distribution.yml`
でターゲットを選び、`bun run distribute:apply` を実行すると対応するバックエンド (wrangler / Helm / docker-compose)
にディスパッチされます。target ごとの production parity は operator evidence で確認する必要があります。このページの
runbook だけで全 target の live readiness を保証しません。

## 想定読者

| 読者                                              | 読むページ                           |
| ------------------------------------------------- | ------------------------------------ |
| Takosumi kernel を managed (takos.jp) で使う      | このセクションは不要                 |
| Takosumi kernel を自分でホストする operator       | このセクション全体                   |
| Takosumi 上で app / Installation を作る developer | [Deploy](/deploy/) と [Apps](/apps/) |

## 5 つの operator host target

`distribution.yml` の `kernel_host.target` に指定する id は次の 5 つです。

| target       | hosting page                        | backend                               | 想定 use case                                     |
| ------------ | ----------------------------------- | ------------------------------------- | ------------------------------------------------- |
| `cloudflare` | [Cloudflare](/hosting/cloudflare)   | Cloudflare Workers + D1 / R2 / KV     | edge-first, low-ops, takos.jp default             |
| `aws`        | [AWS](/hosting/aws)                 | EKS Helm overlay (`values-aws.yaml`)  | AWS native, VPC-only access, RDS / S3 を統合      |
| `gcp`        | [GCP](/hosting/gcp)                 | GKE Helm overlay (`values-gcp.yaml`)  | GCP native, Cloud SQL / GCS を統合                |
| `kubernetes` | [Kubernetes](/hosting/kubernetes)   | base Helm chart (`values-k8s.yaml`)   | 既存 k8s クラスタ / on-prem / 他 cloud manage k8s |
| `selfhosted` | [Self-hosted](/hosting/self-hosted) | docker-compose (`compose.server.yml`) | bare metal / VM / airgap / on-prem                |

ローカル開発は target ではなく独立した dev runtime です: [ローカル開発](/hosting/local) を参照してください。

multi-cloud / hybrid 構成 (例: kernel host を 1 target、tenant runtime を別 target にする) は
[Multi-cloud](/hosting/multi-cloud) を参照してください。

## 共通 quick deploy runbook

5 target は共通の distribution contract を使います。target ごとの差は主に `distribution.yml` の `kernel_host.target` と
target 固有 prerequisites / live evidence です:

```bash
# 1. operator/Takosumi runtime secret 5 個 + per-cloud encryption key を発行
cd takos-private
bun run generate:keys:production --per-cloud

# 2. distribution.yml を編集 (kernel_host.target を決める)
cp distribution.yml.example distribution.yml
$EDITOR distribution.yml

# 3. dry-run で plan を確認
bun run distribute:dry-run --confirm production

# 4. 本番へ apply (wrangler / Helm / compose のいずれかに dispatch される)
bun run distribute:apply --confirm production

# 5. Operator account-plane seed plan を生成 (identity / billing / Installation owner)
cd ../takosumi
bun packages/cli/src/main.ts accounts seed \
  --issuer https://accounts.example.com \
  --subject tsub_admin \
  --client-id takos-admin \
  --redirect-uri https://admin.takos.example.com/auth/oidc/callback \
  > accounts-seed-plan.json
```

target 固有の prerequisites (Cloudflare account / IAM role / kubeconfig / Docker host など) は各 target page の
"target-specific 設定" セクションを参照してください。

secret 値、provider credentials、OpenTofu live tfvars は `takos-private` が管理します。`takos/` 側の OpenTofu /
Helm は non-secret managed resource id と Secret 名だけを扱います。詳細は [Hosting Secret Policy](/hosting/secrets)
を参照してください。

## Backend の差分

ホスティング先ごとの比較と扱わない項目の一覧は [環境ごとの差異](/hosting/differences) を参照してください。target ごとの
GA / beta / smoke-only / unsupported ステータスは [Distribution Target Parity](/hosting/target-parity)
を参照してください。

## 多クラウド対応のクイック参照

`distribution.yml` の `kernel_host.target` (1 target) と `tenant_runtime.targets` (複数可) を別々に設定することで
multi-cloud 構成を作れます:

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
| Source distribution dispatch  | `takos-private` `bun run distribute:test`                    | yes          |
| Cloudflare reference backend | private `distribute:dry-run` + Cloudflare deploy dry-run       | opt-in       |
| AWS / GCP / Kubernetes Helm  | private `distribute:dry-run` preflight + Helm chart validation | opt-in       |
| Selfhosted compose packaging | private `distribute:dry-run` preflight + compose config        | opt-in       |
| Operator infrastructure lifecycle | PlatformService binding dry-runs / live smoke scripts      | opt-in       |

Provider proof は operator が明示的に実行する opt-in proof です。CI / release gate に入れる場合も、各 provider の
credential / cluster / account が揃った環境で gate-backed に実行してください。default docs build や kernel gate は
provider 実環境の proof を要求しません。

選び方ガイドと credential injection の topology は
[Multi-cloud](/hosting/multi-cloud#kernel-host-target-を-multi-cloud-で選ぶ) を参照してください。

## 次に読むページ

次に読む target page:

- [Cloudflare](/hosting/cloudflare) --- Cloudflare Workers backend
- [AWS](/hosting/aws) --- EKS Helm overlay + AWS operator binding profile
- [GCP](/hosting/gcp) --- GKE Helm overlay + GCP operator binding profile
- [Kubernetes](/hosting/kubernetes) --- base Helm chart + k8s runtime-agent connector
- [Self-hosted](/hosting/self-hosted) --- docker-compose + selfhosted reference adapter
- [Multi-cloud](/hosting/multi-cloud) --- 5 target 横断 runbook
- [Target Parity](/hosting/target-parity) --- target ごとの readiness status
- [Secret Policy](/hosting/secrets) --- OpenTofu / Helm / takos-private の secret 境界
- [ローカル開発](/hosting/local) --- 開発用 dev runtime
