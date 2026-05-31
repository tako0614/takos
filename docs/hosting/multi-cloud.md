# Multi-cloud

AppSpec examples in this page use short kind names such as `worker`, `gateway`,
`postgres`, and `object-store` as operator-profile aliases. URI kind values are
also valid. Gateway `listeners` and `routes` live inside the adopted gateway
descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: 複数クラウドにまたがる Takosumi kernel の運用方法。

Takosumi kernel の public concepts は AppSpec / Installation / Deployment
で、public Installer API は 5 endpoint です。target-specific provider
implementation は operator distribution が選びます。 build が必要な source は
build service / CI が prepared source archive にして Installer API へ渡します。

このページは **Takosumi kernel を複数クラウドにまたがって運用する operator**
向けの cross-cloud ランブックです。Cloudflare / AWS / GCP / Kubernetes /
self-hosted を横断して、境界条件と意思決定をまとめます。

ターゲット固有の手順は per-target ドキュメントを参照してください。本ページは **5
ターゲット横断の意思決定** と **境界をまたぐ手順** を整理します。

- [Cloudflare](/hosting/cloudflare) — Cloudflare Workers バックエンド
- [AWS](/hosting/aws) — EKS Helm overlay + AWS reference provider adapter
- [GCP](/hosting/gcp) — GKE Helm overlay + GCP reference provider adapter
- [Kubernetes](/hosting/kubernetes) —ベース Helm チャート + k8s provider
  プラグイン
- [Self-hosted](/hosting/self-hosted) — docker-compose + selfhosted provider
  プラグイン

provider の証跡 (proof) は opt-in です。credentials / cluster / account /
gateway を必要とする検証は operator が明示的に起動し、CI
に組み込む場合も専用ゲートとして実行します。デフォルトのドキュメントビルドと
kernel ゲートは、provider 実環境への
到達性を要求しません。ターゲットごとの現状は
[Distribution Target Parity](/hosting/target-parity) に集約しています。

## Terraform 構成

`takos/deploy/terraform/main.tf` が AWS / GCP
のマネージドリソースのルート構成です。 `target = "aws"` または `target = "gcp"`
を選ぶと対応モジュールだけが instantiate され、 `database_endpoint` /
`database_url` / `redis_url` / `queue_bindings` / `object_storage_buckets` /
`network` / `workload_identity` が共通の output として返ります。 Helm values
への橋渡しは `database_endpoint` と非機密のマネージドリソース ID だけを
入力にし、機密性のある `database_url` は Helm values に書き出しません。

環境バックエンドを使う場合は
`deploy/terraform/environments/{aws-prod,aws-staging,gcp-prod,gcp-staging}`
をルートとして実行します。各 env dir には `terraform.tfvars.example`
があり、実際のシークレット値は `takos-private` から operator
が注入します。バックエンドを使わない構成検証は secret
を使わない範囲に限定します。

```bash
cd takos/deploy/terraform
terraform init -backend=false
terraform validate
```

Terraform apply 後は `terraform output -json` から Helm overlay の values
を生成します。

```bash
cd takos
bun run terraform:helm-values \
  --target aws \
  --terraform-dir deploy/terraform/environments/aws-staging \
  --output deploy/helm/takos/values-aws-staging.generated.yaml
```

生成された values は `runtimeConfig.managedResources` として DB endpoint / Redis
URL / queue bindings / object storage バケット名 / ネットワーク / workload
identity を渡し、 chart は `TAKOS_MANAGED_RESOURCES_JSON`
として各サービスに配布します。 credentials や secret は `takos-private` または
external secrets から注入します。

root `CI` / `Release Gate` workflows と release owner は、Terraform 1.9.8 で
credential 不要の staging plan ゲートも実行します。

```bash
cd takos
bun run terraform:plan-gate
```

このゲートは `deploy/terraform/plan/{aws-staging,gcp-staging}.tfvars` と
`terraform_plan_mode = true` を使い、`terraform plan -refresh=false` の結果を
`.terraform-plan/summary.md` とフル plan のテキスト artifact に書き出します。
実環境の state backend / live credentials を使う plan は operator が
`takos-private` 側で実行します。secret 境界の詳細は
[Hosting Secret Policy](/hosting/secrets) を参照してください。

## マルチクラウドで kernel host target を選ぶ

Takos プロダクトのディストリビューション artifact は `takos/deploy/` にあり、
`takos-private/distribution.yml` は private operator のインスタンス設定です。
マルチクラウド構成では **kernel host target を 1 つ選び**、**tenant runtime
target を別 (または複数) にする** ことで、kernel と tenant workload
を別クラウドに分離できます。

```yaml
# takos-private/distribution.yml
distribution:
  kernel_host:
    target: cloudflare # kernel は edge に置く
    region: global

  tenant_runtime:
    targets: # tenant workload は AWS と GCP に置く
      - cloudflare # serverless tenants は CF Workers
      - aws # heavy tenants は AWS ECS Fargate
      - gcp # data-residency が GCP な tenants
```

`distribute:apply` は `kernel_host.target` 1 つだけをデプロイ対象として dispatch
します (他ターゲット用の Helm / compose は触りません)。`tenant_runtime.targets`
は **tenant runtime target の候補セット** として operator-private metadata
に登録されます。

### 代表的な multi-cloud 組み合わせ例

| 構成                                           | kernel_host.target | tenant_runtime.targets     |
| ---------------------------------------------- | ------------------ | -------------------------- |
| Cloudflare のみ                                | `cloudflare`       | `[cloudflare]`             |
| Cloudflare control + AWS tenant runtime        | `cloudflare`       | `[cloudflare, aws]`        |
| Cloudflare control + GCP tenant runtime        | `cloudflare`       | `[cloudflare, gcp]`        |
| Cloudflare control + Kubernetes tenant runtime | `cloudflare`       | `[cloudflare, kubernetes]` |
| AWS のみ                                       | `aws`              | `[aws]`                    |
| GCP のみ                                       | `gcp`              | `[gcp]`                    |
| AWS control + GCP tenant runtime (cross-cloud) | `aws`              | `[aws, gcp]`               |
| Selfhosted (bare metal / Docker)               | `selfhosted`       | `[selfhosted]`             |
| Selfhosted control + cloud burst               | `selfhosted`       | `[selfhosted, aws]`        |

選び方の指針:

- **Cloudflare のみ**: 最小コストで kernel + tenant 両方を edge で動かす。dev /
  small staging 向け。
- **Cloudflare control + AWS/GCP tenant**: kernel を edge に置きつつ、tenant
  workload に always-on container / 大容量 DB が必要なケース。
- **Cloudflare control + k8s tenant**: 既存 k8s 資産を活用しつつ kernel UX は
  edge にしたい場合。
- **AWS/GCP only**: cloud-native compliance / VPC-only access が必要なケース。
- **Selfhosted**: airgap / on-prem / 独自データセンター。
- **Cross-cloud kernel + tenant**: kernel を AWS / GCP に置きつつ tenant
  workload を別 cloud に置く構成も可能。data residency と compliance
  境界に応じて kernel host と tenant runtime を別 cloud に分離する。

## マルチクラウドトポロジーの前提

Takosumi public concepts は **AppSpec / Installation / Deployment** です。public
HTTP surface は dry-run / install / deploy dry-run / deploy / rollback の 5
Installer API endpoint です。operator-selected implementation binding は、その
contract を具体 runtime / resource に反映する reference/operator mechanism
です。

```
               +-------------------+
               |  Takosumi       |
               |  kernel           |  ← Cloudflare Worker
               |  (control plane)  |     (canonical hosting)
               +---------+---------+
                         | implementation binding
      +------------------+------------------+
      |                  |                  |
+-----v-----+      +-----v-----+      +-----v-----+
| provider  |      | provider  |      | provider  |
| adapter   |      | adapter   |      | adapter   |
| (CF)      |      | (AWS/GCP) |      | (k8s/sh)  |
+-----+-----+      +-----+-----+      +-----+-----+
      |                  |                  |
+-----v-----+      +-----v-----+      +-----v-----+
|  CF       |      |  AWS / GCP |     |  k8s API / |
|  edge     |      |  SDK / API |     |  bare metal|
+-----------+      +-----------+      +-----------+
```

operator が選ぶのは次の 4 点で、それぞれ独立に組み合わせられます。

1. **kernel 自体をどこに置くか** (Cloudflare / EKS / GKE / k8s / bare metal)
2. **どのクラウドのリソースを用意するか** (operator execution binding の選択)
3. **routing 層をどのクラウドに置くか** (CF dispatch / AWS ALB / GCP LB / k8s
   Ingress / Caddy)
4. **runtime-agent をどこに常駐させるか** (kernel と同じクラウドか別クラウドか)

## AppSpec の使い方

source root の `.takosumi.yml` が portable な AppSpec です。operator は
distribution profile / execution binding で
Cloudflare、AWS、GCP、Kubernetes、自前 runtime
のどれで実行するかを選びます。canonical path は Takosumi installer API の 5
endpoint で、dry-run / apply / rollback は Installation 中心で記録されます。

```text
POST /v1/installations/dry-run
POST /v1/installations
POST /v1/installations/{id}/deployments/dry-run
POST /v1/installations/{id}/deployments
POST /v1/installations/{id}/rollback
```

AppSpec は operator-supplied kind alias / URI、same-AppSpec `connect`、platform
service `listen`、root `publish` を使って、runtime、resource、ingress
の関係を構造的に宣言します。

```yaml
apiVersion: v1
metadata:
  id: example.api-with-db
  name: api-with-db
components:
  api:
    kind: worker
    spec:
      entrypoint: src/api.ts
    connect:
      db:
        output: db.connection
        inject: secret-env
        prefix: DB
  db:
    kind: postgres
    spec:
      class: standard
  public:
    kind: gateway
    connect:
      upstream:
        output: api.http
        inject: upstream
    spec:
      listeners:
        public:
          protocol: https
          host: api.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

installer は AppSpec を Deployment operation に展開し、provider selection は
profile のポリシーゲートが決定します。

::: tip provider-agnostic の原則 AppSpec は **形 (component graph)**
を固定します。 operator profile は、kind URI、material kind、`spec`
constraints、credential、 operator evidence が揃う範囲で Cloudflare Workers +
Hyperdrive Postgres や AWS Lambda + RDS Postgres のような implementation に map
できます。 :::

## provider adapter プロファイルの選び方

`distribution.yml` の `kernel_host.target` / `tenant_runtime.targets` は、
デプロイ入口を切り替えるトップレベルのスイッチです。kernel が tenant request の
materialization に使う **provider adapter profile** は distribution profile /
Helm values / operator config に展開され、
`pluginConfig.operator.takosumi.<profile>.clients.*` で各 Takosumi provider
client をどの substrate に向けるかを宣言します。

| profile                              | kernel                | tenant runtime     | tenant routing                | tenant DB                |
| ------------------------------------ | --------------------- | ------------------ | ----------------------------- | ------------------------ |
| `cloudflare.example.json`            | Cloudflare Workers    | Cloudflare Workers | Cloudflare dispatch           | D1 / Hyperdrive Postgres |
| `cloudflare-aws.example.json`        | Cloudflare Workers    | AWS ECS Fargate    | AWS ALB + Route53             | AWS RDS Postgres         |
| `cloudflare-gcp.example.json`        | Cloudflare Workers    | GCP Cloud Run      | GCP HTTP(S) LB + Cloud DNS    | GCP Cloud SQL            |
| `cloudflare-kubernetes.example.json` | Cloudflare Workers    | k8s Deployment     | k8s Ingress (nginx / traefik) | external Postgres        |
| `aws.example.json`                   | AWS (kernel + tenant) | AWS ECS Fargate    | AWS ALB + Route53             | AWS RDS Postgres         |
| `gcp.example.json`                   | GCP (kernel + tenant) | GCP Cloud Run      | GCP HTTP(S) LB + Cloud DNS    | GCP Cloud SQL            |
| `selfhosted.example.json`            | bare metal / Docker   | local container    | Caddy / nginx                 | local Postgres           |

profile の選び方は前節
[マルチクラウドで kernel host target を選ぶ](#マルチクラウドで-kernel-host-target-を選ぶ)
の組み合わせ表に従い、`distribution.yml` の構成と整合する profile
を選んでください。

## クレデンシャル注入のトポロジー

provider adapter への credential 経路は、profile 構成により 3 形態あります。

### 形態 A: Cloudflare Worker の secret (kernel が CF にある場合)

最もシンプルな形態です。Cloudflare Worker ランタイムの secret として注入します。

```bash
cd takos-private/src/worker

# AWS
echo "AKIA..." | deno task secrets put AWS_ACCESS_KEY_ID --env production
echo "..."     | deno task secrets put AWS_SECRET_ACCESS_KEY --env production

# GCP (service account JSON は base64)
base64 -w0 ~/takos-provider.json | deno task secrets put GCP_SERVICE_ACCOUNT_JSON --env production

# k8s (Bearer token + CA cert)
cat /tmp/takos-provider.token | deno task secrets put K8S_API_TOKEN --env production
kubectl get secret -n takos-system takos-provider-token -o json \
  | jq -r '.data["ca.crt"]' \
  | deno task secrets put K8S_API_CA_CERT --env production
```

reference provider adapter が SDK 互換クライアントを構築し、Cloudflare の egress
制限内で materialize します。Worker の CPU 時間制限 (50 ms / 30 s)
に収まる操作だけ直接呼び、長尺の操作は runtime-agent に handoff します
(`src/runtime-agent/handoff.ts`)。

### 形態 B: operator 管理のゲートウェイ URL

Cloudflare Worker から AWS / GCP / k8s API を直接呼べない場合
(リクエストサイズ、private network HTTPS endpoint、VPC-only API endpoint 等)
は、operator がゲートウェイを立てます。

```jsonc
{
  "pluginConfig": {
    "operator.takosumi.cloudflare-aws": {
      "clients": { "...": "..." },
      "gatewayUrl": "https://aws-gateway.internal.takos.example/v1/",
      "gatewayToken": "operator-issued-token"
    }
  }
}
```

ゲートウェイ自体のホスティング先:

| 配置先                        | 利点                     | 欠点                               |
| ----------------------------- | ------------------------ | ---------------------------------- |
| EC2 / GCE / VM                | シンプル、固定 IP        | operator の運用負担                |
| Cloud Run / Fargate           | オートスケール           | cold start、autoscale チューニング |
| k8s Deployment                | 既存クラスタで運用一元化 | k8s が必要                         |
| Cloudflare Worker (別 Worker) | エッジコロケーション     | egress 制限は同じ                  |

### 形態 C: runtime-agent (本番推奨)

reference provider adapter が **kernel から直接リソースを materialize
する代わりに**、 runtime-agent プロセスが kernel から work lease を pull
し、provider 操作を **agent が動作するクラウド内** で実行します。

```
kernel (CF) -- 1. enqueue work --> work queue (kernel state)
                                          ^
                                          | 2. lease pull
                                          v
agent (AWS EC2) -- 3. AWS SDK call --> AWS API
agent (AWS EC2) -- 4. report result --> kernel
```

利点:

- AWS / GCP の credentials が **agent プロセスだけ** に注入され、Cloudflare
  Worker の secret に乗らない (漏えい時の影響範囲を縮小)
- VPC 内のエンドポイント (RDS / Cloud SQL Private IP) に直接アクセスできる
- 長尺の操作 (RDS create 5 分等) も timeout なしで実行可能

欠点:

- agent ホストの運用 (systemd / パッチ / 再起動) は operator の責任

## runtime-agent の配置

agent は kernel への enroll → heartbeat → lease pull →実行→ report
のループで動作します。配置の目安は次のとおりです。

| 構成                                      | agent 推奨配置                                 |
| ----------------------------------------- | ---------------------------------------------- |
| Cloudflare control + AWS tenant           | AWS EC2 (t3.small) または ECS Fargate          |
| Cloudflare control + GCP tenant           | GCP Cloud Run (min instances=1) または GKE pod |
| Cloudflare control + k8s tenant           | k8s pod (in-cluster ServiceAccount)            |
| Cloudflare control + self-hosted リソース | bare metal の systemd                          |
| AWS / GCP のみ                            | 同じクラウド内 (kernel と同じ pod)             |
| Self-hosted                               | bare metal の systemd                          |

agent プロセスの最小構成:

```ts
// runtime-agent.ts
import {
  RuntimeAgentHttpClient,
  RuntimeAgentLoop,
} from "@takos/takosumi-plugins/runtime-agent";

const client = new RuntimeAgentHttpClient({
  baseUrl: process.env.TAKOS_KERNEL_URL!,
  enrollmentToken: process.env.TAKOS_RUNTIME_AGENT_TOKEN!,
});

const loop = new RuntimeAgentLoop({
  client,
  agentId: process.env.HOSTNAME ?? "runtime-agent",
  provider: "aws", // or "gcp" / "k8s" / "selfhosted"
  capabilities: { kinds: ["aws.ecs.deploy", "aws.rds.materialize"] },
  executors: {
    "aws.ecs.deploy": awsEcsExecutor,
    "aws.rds.materialize": awsRdsExecutor,
  },
});
await loop.run();
```

各クラウド固有のドキュメントに、systemd / Cloud Run / k8s Deployment の YAML
サンプルがあります。

- [AWS](/hosting/aws#runtime-agent-phase-17b-を-aws-に置く)
- [GCP](/hosting/gcp#runtime-agent-phase-17b-を-gcp-に置く)
- [Kubernetes](/hosting/kubernetes#runtime-agent-phase-17b-を-k8s-に置く)
- [Self-hosted](/hosting/self-hosted#runtime-agent-on-bare-metal)

### lease のセマンティクス

- agent は `idleBackoffMs` (デフォルト 1000) でポーリング
- lease TTL (デフォルト 60 秒) を超えると kernel が再 enqueue
- agent が長尺操作を実行中は `reportProgress({ extendUntil })` で延長
- `failed` で `retry: true` を返すと kernel が再 enqueue (max retry まで)
- `failed` で `retry: false` を返すと dead-letter

## ルーティング層の選択

ルーティングは、kernel が tenant のリクエストを tenant
ワークロードに届ける層です。 profile ごとに次のように異なります。

| profile                 | ルーティング              | DNS            | 証明書                       |
| ----------------------- | ------------------------- | -------------- | ---------------------------- |
| `cloudflare`            | unified Worker + Containers | Cloudflare DNS | universal SSL                |
| `cloudflare-aws`        | unified Worker + AWS ALB    | Route53        | ACM cert                     |
| `cloudflare-gcp`        | unified Worker + GCP HTTP(S) LB | Cloud DNS      | Google-managed cert          |
| `cloudflare-kubernetes` | unified Worker + k8s Ingress | external-dns   | cert-manager (Let's Encrypt) |
| `aws`                   | ALB + Route53             | Route53        | ACM cert                     |
| `gcp`                   | HTTP(S) LB + Cloud DNS    | Cloud DNS      | Google-managed cert          |
| `selfhosted`            | Caddy / nginx             | 外部           | Let's Encrypt + certbot      |

operator が手動で行う作業 (クラウド共通):

1. DNS ゾーンの作成と委任 (`takos.example.com` の NS をクラウド DNS に向ける)
2. ワイルドカード証明書の発行 (`*.app.takos.example.com`)、または DNS-01
   チャレンジの設定
3. ルーティング層 (ALB / HTTP(S) LB / Ingress) を operator が事前にインストール
4. profile の `routerConfig` セクションに ARN / zone ID / Ingress class を注入

operator-selected implementation binding が行う作業:

- tenant 単位の route block / target group / URL map / Ingress rule の同期
- DNS の A / ALIAS / CNAME レコードの作成・更新・削除 (DNS provider adapter)
- ドリフト検出 (実 route 状態と望ましい状態の比較)

## クラウド横断のドリフト検出とロールバック

provider のルーティング観測と provider
プラグインは、**ドリフト検出とロールバック** を `Deployment.observation`
レコードに統一して emit します。

### ドリフト検出

| 検出されるドリフト                                | 検出元 provider client     | 検出方法                             |
| ------------------------------------------------- | -------------------------- | ------------------------------------ |
| ECS service の desired count が manifest と異なる | `aws-control-plane`        | DescribeServices ポーリング          |
| ALB target group の target が抜けている           | `aws-alb-route53-router`   | DescribeTargetHealth ポーリング      |
| Cloud Run revision の traffic split が想定外      | `gcp-control-plane`        | services.get ポーリング              |
| URL map の hostRule が手動で書き換えられた        | `gcp-load-balancer-router` | urlMaps.get ポーリング               |
| k8s Deployment の replicas が手動スケールされた   | `k8s-deployment`           | watch イベント                       |
| Ingress の TLS Secret が cert-manager 外で変更    | `k8s-ingress-router`       | watch イベント + cert-manager status |
| Caddyfile が外から書き換えられた                  | `selfhosted-router-config` | ファイルハッシュのポーリング         |

クラウド横断のドリフトは kernel の `provider_observations` テーブルに統一形式で
書き込まれます。観測周期はデフォルト 60 秒で、profile の
`pluginConfig.*.observationIntervalMs` で調整できます。

### ロールバックのセマンティクス

Installation の rollback は
`takosumi rollback <installation-id> <deployment-id>` で、retained `succeeded`
Deployment を current pointer として選び直す操作です。kernel は新しい Deployment
を作らず、mutable ref を再解決せず、過去 Deployment に記録された source pin /
manifest digest / activation evidence を authority とします。

provider-specific な ingress / traffic / runtime の反映は operator
implementation の reconciliation です。Cloud Run の traffic split、Kubernetes
Gateway / Ingress、Caddy、Route53 / Cloud DNS などは、同じ current pointer
に収束するよう operator が処理します。Takos product shell はこの処理を
standalone deploy command として持ちません。

クラウド横断のロールバックに関する制約:

- **DB スキーママイグレーションが forward-only なリソースは自動で戻らない** (例:
  カラム削除)。data restore や migration resume は operator / app の
  data-protection workflow で扱います
- **DNS TTL の伝播はクラウド依存**: Route53 / Cloud DNS は 30 ~ 300
  秒、Cloudflare DNS は数秒で伝播します。マルチクラウドのロールバックでは最大
  TTL を考慮してください
- **ACM / Google-managed cert の更新はロールバック対象外**: cert リソースは
  kernel が直接管理しません (operator が事前発行)

ロールバックの詳細は [Rollback](/deploy/rollback) を参照してください。

## エンドツーエンドのランブック (Cloudflare control + AWS tenant)

実例として **Cloudflare で kernel を動かしつつ、tenant ランタイムと DB を AWS
に置く** 構成のエンドツーエンドのランブックを示します。

```bash
# 1. distribution.yml を編集
#    kernel_host.target: cloudflare
#    tenant_runtime.targets: [cloudflare, aws]
cd takos-private
$EDITOR distribution.yml

# 2. operator/Takosumi runtime secret + per-cloud key を発行
deno task generate:keys:production --per-cloud

# 3. AWS side: IAM role + credentials 発行
aws iam create-user --user-name takos-provider
aws iam attach-user-policy --user-name takos-provider \
  --policy-arn arn:aws:iam::123456789012:policy/TakosProvider
aws iam create-access-key --user-name takos-provider > /tmp/aws-keys.json

# 4. AWS credentials を CF Worker secret に inject
ACCESS_KEY=$(jq -r '.AccessKey.AccessKeyId' /tmp/aws-keys.json)
SECRET_KEY=$(jq -r '.AccessKey.SecretAccessKey' /tmp/aws-keys.json)
cd src/worker
echo "$ACCESS_KEY" | deno task secrets put AWS_ACCESS_KEY_ID --env production
echo "$SECRET_KEY" | deno task secrets put AWS_SECRET_ACCESS_KEY --env production
cd ../..

# 5. provider adapter profile を cloudflare-aws に切替
cd ../takosumi
cp profiles/cloudflare-aws.example.json deploy/cloudflare/profiles/production.json
# accountId / region / artifactBucket を実値に編集
deno task profile:apply --env production
cd ../takos-private

# 6. AWS 側: ALB + Route53 + ACM cert を pre-provision
aws elbv2 create-load-balancer --name takos-tenant-alb ...
aws route53 create-hosted-zone --name app.takos.example.com ...
aws acm request-certificate --domain-name '*.app.takos.example.com' \
  --validation-method DNS

# 7. kernel を unified distribution で deploy
deno task distribute:dry-run --confirm production
deno task distribute:apply --confirm production

# 8. runtime-agent を AWS EC2 に deploy
ssh ec2-user@runtime-agent.takos.example.com \
  'sudo systemctl enable --now takos-runtime-agent'

# 9. Takosumi Accounts seed plan を生成
cd ../takosumi-cloud
bun packages/cli/src/main.ts accounts seed \
  --issuer https://accounts.takos.example.com \
  --subject tsub_admin \
  --client-id takos-admin \
  --redirect-uri https://admin.takos.example.com/auth/oidc/callback \
  > accounts-seed-plan.json

# 10. 動作確認
# Installation lifecycle smoke
takosumi install dry-run --source . --space "$TAKOSUMI_SPACE_ID" --json
takosumi install --source . --space "$TAKOSUMI_SPACE_ID"
curl https://my-app.app.takos.example.com  # AWS ALB 経由で ECS Fargate に到達
```

GCP / k8s / selfhosted も同様の流れです (各ターゲット固有のドキュメントを参照)。

## シークレットパーティションとローテーションのランブック

マルチクラウド構成では **1
つのクラウドの鍵が漏えいしても他のクラウドに影響しない**
ことが境界条件になります。Takosumi kernel
のシークレットストアはクラウドパーティションごとに **独立した暗号鍵**
を保持し、AES-GCM の AAD にパーティションラベルを bind することで
パーティションをまたいだ open を失敗させます。

### per-cloud 鍵の発行 (H14)

operator は `generate-platform-keys` を `--per-cloud` 付きで実行し、per-cloud の
暗号鍵を発行します。

```bash
cd takos-private
deno run --allow-read --allow-write --allow-env \
  scripts/generate-platform-keys.ts --env=production --per-cloud
```

これにより `ENCRYPTION_KEY_CLOUDFLARE` / `ENCRYPTION_KEY_AWS` /
`ENCRYPTION_KEY_GCP` / `ENCRYPTION_KEY_K8S` / `ENCRYPTION_KEY_SELFHOSTED` の 5
ファイルが追加で出力されます。 kernel 起動時には次のように解決されます。

| 環境変数                                                                 | パーティション |
| ------------------------------------------------------------------------ | -------------- |
| `TAKOS_SECRET_STORE_PASSPHRASE` (またはフォールバック)                   | `global`       |
| `TAKOS_SECRET_STORE_PASSPHRASE_AWS` / `ENCRYPTION_KEY_AWS`               | `aws`          |
| `TAKOS_SECRET_STORE_PASSPHRASE_GCP` / `ENCRYPTION_KEY_GCP`               | `gcp`          |
| `TAKOS_SECRET_STORE_PASSPHRASE_CLOUDFLARE` / `ENCRYPTION_KEY_CLOUDFLARE` | `cloudflare`   |
| `TAKOS_SECRET_STORE_PASSPHRASE_K8S` / `ENCRYPTION_KEY_K8S`               | `k8s`          |
| `TAKOS_SECRET_STORE_PASSPHRASE_SELFHOSTED` / `ENCRYPTION_KEY_SELFHOSTED` | `selfhosted`   |

未設定のパーティションは、`global` 鍵をパーティションラベルと HKDF 風に混合した
derived passphrase でシールされます。本番では明示的に override
する運用を推奨します。

### 漏えい時のインシデント対応

| 漏えいした鍵              | 影響範囲                   | 対応                                                       |
| ------------------------- | -------------------------- | ---------------------------------------------------------- |
| `ENCRYPTION_KEY_AWS`      | aws パーティションのみ     | AWS パーティションのシークレットをローテーション           |
| `ENCRYPTION_KEY_GCP`      | gcp パーティションのみ     | GCP パーティションのシークレットをローテーション           |
| `ENCRYPTION_KEY` (global) | 派生元のパーティション全て | 全パーティションのローテーション + per-cloud override 切替 |

クロスパーティションへの漏えいが起きないことは、
`MultiCloudSecretBoundaryCrypto: aws key compromise does not unlock other partitions`
のテストでプロパティ風に保証されています。

### ローテーションポリシーとバージョン GC (H15)

各シークレットに `rotation_policy: { intervalDays, gracePeriodDays }`
を付与すると、バックグラウンドジョブ (`SecretRotationService.checkRotation`)
が次のように動きます。

1. `intervalDays` 経過で `state=due` に遷移し、operator 通知用の audit イベント
   (`secret.rotation.notice`, severity=warning) を emit
2. `intervalDays + gracePeriodDays` 経過で `state=expired` (severity=critical)
   に遷移
3. `withGc=true` で実行すると同時にバージョン GC を走らせ、`latest 5` または
   `last accessed within 90d` 以外のバージョンを削除 (削除分は
   `secret.version.gc` audit イベントに記録)

operator が手動でローテーションする場合は Web UI または admin API から
`SecretRotationService.rotateSecret`
を実行します。新しいバージョンを書き込みつつ `secret.rotation.executed` の audit
イベント (actor と reason 付き) を残します。 前バージョンはバージョン GC
まで保持されるので、直前へのロールバックも問題ありません。

### operator メンテナンスジョブの例 (Cloudflare scheduled event)

```ts
export default {
  async scheduled(_event, env, _ctx) {
    const service = await bootstrapSecretRotationService(env);
    const report = await service.checkRotation({ withGc: true });
    if (report.notices.length > 0) {
      console.warn(
        `[secret-rotation] ${report.notices.length} secrets due/expired`,
      );
    }
  },
};
```

(scheduled event は wrangler.toml の `[triggers] crons = ["0 3 * * *"]` で毎日
03:00 UTC)

## 監査ログのリテンションポリシー (PCI-DSS / HIPAA / SOX)

Takosumi kernel は `audit_events` テーブルを tamper-evident にするため、SHA-256
のハッシュチェーンで append-only 運用しています。regulated なワークロード
(PCI-DSS / HIPAA / SOX) 向けにリテンションポリシーを正式化しています。

### ポリシー構成

`AuditRetentionPolicy`
(`takosumi/packages/kernel/src/services/audit-replication/policy.ts`)
は環境変数で解決されます。

| 環境変数                           | 役割                                                  | 例                        |
| ---------------------------------- | ----------------------------------------------------- | ------------------------- |
| `TAKOS_AUDIT_RETENTION_REGIME`     | `default` / `pci-dss` / `hipaa` / `sox` / `regulated` | `hipaa`                   |
| `TAKOS_AUDIT_RETENTION_DAYS`       | リテンションの上書き (日数)                           | `2555` (= 7 年、SOX 想定) |
| `TAKOS_AUDIT_DELETE_AFTER_ARCHIVE` | レプリケーション確認後に primary store から削除する   | `false` (デフォルト)      |
| `TAKOS_AUDIT_ARCHIVE_GRACE_DAYS`   | アーカイブと削除の grace window (日数)                | `30` (デフォルト)         |

regulated バンド (`pci-dss` / `hipaa` / `sox` / `regulated`) を選ぶと
`regulatedDays = 2555 (7 年)` がデフォルトになります。`default` 体制では
`defaultDays = 365 (1 年)` です。`TAKOS_AUDIT_RETENTION_DAYS`
を明示すればバンドを上書きできますが、PCI-DSS の 1 年 / HIPAA の 6 年 / SOX の 7
年といった最低保持期間は operator 側で確認してください。

### archive と delete

`audit_events` は **append-only** がデフォルトです。

1. リテンションカットオフ (`now - retentionDays`) より古いレコードは
   `archived = true` をフラグ
2. `deleteAfterArchive = false` (デフォルト):
   アーカイブされた行はそのまま残ります (フルハッシュチェーンは永続的に検証可能)
3. `deleteAfterArchive = true` を opt-in
   した場合のみ、`now - retentionDays - archiveGracePeriodDays`
   より古いアーカイブ済み行が削除されます。これはダウンストリームのレプリケーション
   (Sumo / Datadog / S3) を主たる保管先とする運用が前提で、grace 期間中に
   レプリケーション失敗を検知できる必要があります。

### 外部レプリケーション sink

`AuditReplicationSink` インターフェース
(`takosumi/packages/kernel/src/services/audit-replication/sink.ts`)
を実装すると、 `SqlObservabilitySink.appendAudit` 後に各 sink へチェーン化された
audit レコードをファンアウトできます。

```ts
import {
  AuditReplicationDriver,
  InMemoryAuditReplicationSink,
  resolveAuditRetention,
} from "../services/audit-replication/mod.ts";
import { SqlObservabilitySink } from "../services/observability/mod.ts";

const replication = new AuditReplicationDriver({
  sinks: [
    new SumoLogicReplicationSink({/* … */}),
    new DatadogReplicationSink({/* … */}),
  ],
  onFailure: (failure) => alertOpsTeam(failure),
});

const sink = new SqlObservabilitySink({
  client,
  retentionPolicy: resolveAuditRetention({ env: process.env }),
  replication,
});
```

Sink の契約は **append-only かつイベント ID による冪等** です。下流のシステム
(Sumo / Datadog / S3 Object Lock / Splunk / SIEM)
で独立したリテンションを持たせると、リージョン内 DB
が侵害された場合でも、コンプライアンス向けの独立した記録先として機能します。

`InMemoryAuditReplicationSink` はテスト・ローカル開発用のリファレンス実装で、
`replicate(record)` の dedupe / バッチ動作を模倣します。

WORM 相当のイミュータブルレプリケーション (S3 Object Lock COMPLIANCE モード) は
`AuditExternalReplicationSink` (`external_log.ts`) を使います。これは起動時に
プライマリチェーンと外部レプリカを `(sequence, hash)` 単位で照合し、DB 改ざんを
検出するための独立した階層です。

### リテンションのランブック

operator のメンテナンス GC は `SqlObservabilitySink.applyRetentionPolicy`
を毎日呼びます。 `TAKOS_AUDIT_RETENTION_DAYS` (または `retentionPolicy`)
が設定されていれば、起動時にも一度実行されます
(`takosumi/packages/kernel/src/index.ts` の `maybeApplyAuditRetention`)。

```ts
// example: regulated env (HIPAA) の scheduled maintenance
export default {
  async scheduled(_event, env, _ctx) {
    const policy = resolveAuditRetention({ env });
    const sink = new SqlObservabilitySink({
      client: await openSqlClient(env),
      retentionPolicy: policy,
      replication: await openReplicationDriver(env),
    });
    const result = await sink.applyRetentionPolicy();
    console.log(
      `[audit-retention] regime=${policy.regime} retention=${policy.retentionDays}d ` +
        `archived=${result.archived} deleted=${result.deleted}`,
    );
  },
};
```

(Cloudflare の scheduled event は `[triggers] crons = ["15 3 * * *"]` を audit
retention 専用 worker に設定。secret-rotation
メンテナンスと分離することで、失敗の影響を切り離します)

### provider observation のリテンション

`provider_observations` / `runtime_provider_observations` テーブルは
`ObservationRetentionService`
(`takosumi/packages/kernel/src/services/observation-retention/service.ts`) で
日次 GC を行います。

| 段階     | window           | 動作                             |
| -------- | ---------------- | -------------------------------- |
| recent   | `now - 30d` 以内 | live (ドリフトクエリに即時応答)  |
| archived | `30d - 90d`      | `archived = true` に切り替え     |
| deleted  | `90d` 超過       | DELETE (cold-line export が必要) |

current Deployment に紐づく observation は、経過時間にかかわらず archive
対象外です。ドリフト検出の正確性を保つため、current Deployment の live
スナップショットは常に保持されます。

`startObservationRetentionJob({ service, intervalMs: 24*60*60*1000 })` を boot
path から呼ぶと、日次の GC ループに入ります。`onReport` コールバックから
`{archivedDeploy, archivedRuntime, deletedDeploy, deletedRuntime}`
のメトリクスを emit すれば、ダッシュボードで観測できます。

## DB at-rest 暗号化の強制

Takosumi は production / staging 起動時に **DB 接続の at-rest 暗号化フラグ**
を強制チェックします。認識されるシグナルは次のとおりです。

| バックエンド         | 認識されるシグナル                                                  |
| -------------------- | ------------------------------------------------------------------- |
| Postgres             | `?sslmode=require` / `verify-ca` / `verify-full` または `?ssl=true` |
| Cloudflare D1        | `d1://...` URL (provider 側で常に at-rest 暗号化)                   |
| SQLCipher            | `sqlcipher://...`                                                   |
| encrypted SQLite     | `sqlite://path?key=...` (PRAGMA key 経由)                           |
| 汎用 override フラグ | `?encrypted=true` を URL に付与                                     |
| postgres TLS scheme  | `postgres+tls://` / `postgresql+tls://`                             |

クラウド別の推奨設定:

- **Cloudflare D1**: `d1://<binding-name>` を `DATABASE_URL` に設定するだけで OK
- **AWS RDS / Aurora**: URL に `?sslmode=require` を追加し、CA bundle を信頼
- **GCP Cloud SQL**: Cloud SQL Auth Proxy + `?sslmode=verify-ca` で CA を pin
- **Kubernetes (自管理 Postgres)**: cert-manager で発行した証明書を
  `sslmode=verify-full` で接続。 pgcrypto / TDE / 暗号化 PV は operator が選択
- **Self-hosted**: SQLCipher、または LUKS 等のディスク暗号化を operator が強制

ローカル / 開発環境で暗号化のない DB を使う場合は `TAKOS_ALLOW_UNENCRYPTED_DB=1`
で明示的に opt-in が必要です (production / staging では opt-in 不可で、起動時に
`process exit 1` で fail-closed)。

## audit-replication の外部 sink

`audit_events` テーブルの SHA-256 ハッシュチェーンはアプリ層で計算されますが、
DBA が DB 上でチェーンを再計算しながらレコードを改ざんするシナリオでは、 **DB
外のイミュータブルレプリカ** が独立した改ざん検知の記録先になります。 Takosumi
は production / staging 起動時に `AuditExternalReplicationSink` を必須化します。

| `TAKOS_AUDIT_REPLICATION_KIND` | 実装                            | 用途                               |
| ------------------------------ | ------------------------------- | ---------------------------------- |
| `s3`                           | `S3ImmutableLogReplicationSink` | 本番。S3 versioning + Object Lock  |
| `stdout`                       | `StdoutReplicationSink`         | テスト / smoke。append-only stdout |

S3 sink は `<prefix>/<10-digit-zero-padded-sequence>-<hash[:16]>.json` の key で
1 イベント = 1 オブジェクトとしてアップロードし、Object Lock のリテンションを
`TAKOS_AUDIT_REPLICATION_S3_RETENTION_DAYS` (デフォルト 2555 = 7 年、COMPLIANCE
モード) で固定します。`s3:BypassGovernanceRetention` を持たない IAM
プリンシパルで運用すれば、 DBA が侵害された場合でもレプリカには触れません。

クラウド別の推奨組み合わせ:

| kernel が動くクラウド | 推奨レプリカ先                                                     |
| --------------------- | ------------------------------------------------------------------ |
| Cloudflare            | AWS S3 (クロスクラウドのイミュータブルアーカイブ) または R2 + lock |
| AWS                   | S3 + Object Lock COMPLIANCE                                        |
| GCP                   | GCS Bucket Lock 経由の S3 互換層、またはクロスクラウドの S3        |
| Kubernetes / self     | Object Lock 付きの MinIO、または off-cluster の S3                 |

起動時には `verifyAuditReplicationConsistency` が SQL チェーンと外部チェーンを
`(sequence, hash)` で照合し、divergence (DB 削除 / ハッシュ不一致)
を検出した場合 production / staging では fail-closed します。catch-up 状態
(プライマリが外部より進んでいる場合) は OK として扱われ、定期 GC ジョブが lag
を解消します。

環境変数:

| キー                                        | 用途                                                               |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `TAKOS_AUDIT_REPLICATION_KIND`              | `s3` / `stdout`                                                    |
| `TAKOS_AUDIT_REPLICATION_S3_BUCKET`         | S3 バケット名 (s3 sink 必須)                                       |
| `TAKOS_AUDIT_REPLICATION_S3_PREFIX`         | オブジェクトキーの prefix (デフォルト `audit-replication`)         |
| `TAKOS_AUDIT_REPLICATION_S3_RETENTION_MODE` | `COMPLIANCE` (デフォルト) / `GOVERNANCE`                           |
| `TAKOS_AUDIT_REPLICATION_S3_RETENTION_DAYS` | retain-until-date を起動時刻 + N 日に設定 (デフォルト 2555 = 7 年) |

## 関連ドキュメント

- [Cloudflare](/hosting/cloudflare) — Cloudflare Workers バックエンド
- [AWS](/hosting/aws) — AWS provider adapter と Helm overlay
- [GCP](/hosting/gcp) — GCP provider adapter と Helm overlay
- [Kubernetes](/hosting/kubernetes) — k8s provider adapter とベース Helm
  チャート
- [Self-hosted](/hosting/self-hosted) — selfhosted provider adapter と bare
  metal ランブック
- [Deploy](/deploy/) — AppSpec author 向け
- [Rollback](/deploy/rollback) —ロールバックのセマンティクス
- [環境ごとの差異](/hosting/differences) —ホスティング表面の比較
- [Distribution Target Parity](/hosting/target-parity) —
  ターゲット別の現状マトリクス
