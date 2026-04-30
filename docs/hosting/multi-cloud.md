# Multi-cloud

このページは **Takos kernel を複数 cloud にまたがって運用する operator**
向けの cross-cloud runbook です。Phase 17 (provider plugin / runtime-agent /
routing layer / 21 ignored test re-enable) の完了を前提とし、Cloudflare /
AWS / GCP / Kubernetes / self-hosted の境界を一望します。

cloud-specific な手順は次の per-cloud docs を参照してください。本ページは
**4 cloud 横断の意思決定** と **境界に出る instruction** を整理します:

- [Cloudflare](/hosting/cloudflare) ― tracked reference Workers backend
- [AWS](/hosting/aws) ― Helm overlay + AWS provider plugin
- [GCP](/hosting/gcp) ― Helm overlay + GCP provider plugin
- [Kubernetes](/hosting/kubernetes) ― base Helm chart + k8s provider plugin
- [Self-hosted](/hosting/self-hosted) ― bare metal + selfhosted provider plugin

## Multi-cloud topology の前提

Takos PaaS kernel は **kernel と provider plugin** に分かれた two-layer
architecture です:

```
                       +-------------------+
                       |  Takos PaaS       |
                       |  kernel           |  ← Cloudflare Worker
                       |  (control plane)  |     (canonical hosting)
                       +---------+---------+
                                 | provider 契約
              +------------------+------------------+
              |                  |                  |
        +-----v-----+      +-----v-----+      +-----v-----+
        | provider  |      | provider  |      | provider  |
        | plugin    |      | plugin    |      | plugin    |
        | (CF)      |      | (AWS/GCP) |      | (k8s/sh)  |
        +-----+-----+      +-----+-----+      +-----+-----+
              |                  |                  |
        +-----v-----+      +-----v-----+      +-----v-----+
        |  CF       |      |  AWS / GCP |     |  k8s API / |
        |  edge     |      |  SDK / API |     |  bare metal|
        +-----------+      +-----------+      +-----------+
```

operator が選ぶのは:

1. **kernel 自体をどこに置くか** (Cloudflare / EKS / GKE / k8s / bare metal)
2. **どの cloud の resource を materialize するか** (provider plugin の選択)
3. **routing layer をどの cloud に置くか** (CF dispatch / AWS ALB / GCP LB /
   k8s Ingress / Caddy)
4. **runtime-agent をどこに常駐させるか** (kernel と同じ cloud か別 cloud か)

この 4 つは独立に組み合わせられます。

## composite descriptor の使い方

Phase 13 で導入した composite descriptor は **runtime + resource + publication
+ route の組** を 1 つの authoring alias として manifest に書けるようにします。
canonical な 4 個 (`takos-paas-plugins/src/profiles/composite/mod.ts`) を
operator が deploy manifest 上で参照します。

| alias                                       | 構成                                                |
| ------------------------------------------- | --------------------------------------------------- |
| `composite.serverless-with-postgres@v1`     | runtime.js-worker + resource.sql.postgres           |
| `composite.web-app-with-cdn@v1`             | runtime.js-worker + resource.object-store.s3 + CDN  |
| `composite.cf-control-aws-tenant@v1`        | runtime.oci-container + AWS tenant routing          |
| `composite.cf-control-gcp-tenant@v1`        | runtime.oci-container + GCP tenant routing          |

deploy manifest 例:

```yaml
# takos.yaml
apiVersion: takos/v1
kind: Group
spec:
  components:
    - name: api
      type: composite.serverless-with-postgres@v1
      env:
        LOG_LEVEL: info
```

compiler が `runtime.js-worker@v1` の component 1 個と
`resource.sql.postgres@v1` resource (binding env `DATABASE_URL`) 1 個に展開し、
canonical descriptor digest を `Deployment.resolution.descriptor_closure` に
pin します。展開結果の materialization は profile の provider-selection policy
gate が決めます。

::: tip provider-agnostic 原則 composite descriptor は **shape を fix する** だけで、
provider materialization は profile が決めます。同じ manifest を Cloudflare
profile に当てれば Workers + Hyperdrive Postgres、AWS profile に当てれば
Lambda + RDS Postgres に展開されます (provider-selection policy が決定)。
:::

## profile の選び方

profile JSON は `takos-paas-plugins/profiles/*.example.json` にあり、
`pluginConfig.operator.takos.<profile>.clients.*` で各 PaaS plugin slot を
どの provider client に向けるかを宣言します。

| profile                                          | kernel              | tenant runtime        | tenant routing                      | tenant DB                  |
| ------------------------------------------------ | ------------------- | --------------------- | ----------------------------------- | -------------------------- |
| `cloudflare.example.json`                        | Cloudflare Workers  | Cloudflare Workers    | Cloudflare dispatch                 | D1 / Hyperdrive Postgres   |
| `cloudflare-aws.example.json`                    | Cloudflare Workers  | AWS ECS Fargate       | AWS ALB + Route53                   | AWS RDS Postgres           |
| `cloudflare-gcp.example.json`                    | Cloudflare Workers  | GCP Cloud Run         | GCP HTTP(S) LB + Cloud DNS          | GCP Cloud SQL              |
| `cloudflare-kubernetes.example.json`             | Cloudflare Workers  | k8s Deployment        | k8s Ingress (nginx / traefik)       | external Postgres          |
| `aws.example.json`                               | AWS (kernel + tenant)| AWS ECS Fargate      | AWS ALB + Route53                   | AWS RDS Postgres           |
| `gcp.example.json`                               | GCP (kernel + tenant)| GCP Cloud Run        | GCP HTTP(S) LB + Cloud DNS          | GCP Cloud SQL              |
| `selfhosted.example.json`                        | bare metal / Docker | local container      | Caddy / nginx                       | local Postgres             |

選び方の指針:

- **Cloudflare のみ**: 最小コストで kernel + tenant 両方を edge で動かす。dev /
  small staging 向け。
- **Cloudflare control + AWS/GCP tenant**: kernel を edge に置きつつ、tenant
  workload に always-on container / 大容量 DB が必要なケース。
- **Cloudflare control + k8s tenant**: 既存 k8s 資産を活用しつつ kernel UX
  は edge にしたい場合。
- **AWS/GCP only**: cloud-native compliance / VPC-only access が必要なケース。
- **Selfhosted**: airgap / on-prem / 独自データセンター。

## credential injection の topology

provider plugin への credential 経路は profile 構成によって 3 形態あります:

### 形態 A: Cloudflare Worker secret (kernel が CF にある場合)

最もシンプル。Cloudflare Worker runtime の secret として inject:

```bash
cd takos-private/apps/control

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

provider plugin が SDK 互換 client を構築し、Cloudflare の egress 制限内で
materialize します。Worker の CPU 時間制限 (50ms / 30s) で収まる ops のみ
直接呼び、長尺 ops は runtime-agent に handoff します
(`src/runtime-agent/handoff.ts`)。

### 形態 B: operator-managed gateway URL

Cloudflare Worker から AWS / GCP / k8s API を直接呼べない場合 (request size /
mTLS / VPC-only API endpoint) は operator が gateway を立てます:

```jsonc
{
  "pluginConfig": {
    "operator.takos.cloudflare-aws": {
      "clients": { "...": "..." },
      "gatewayUrl": "https://aws-gateway.internal.takos.example/v1/",
      "gatewayToken": "operator-issued-token"
    }
  }
}
```

gateway 自体の hosting topology:

| gateway 配置場所     | 利点                                     | 欠点                                   |
| -------------------- | ---------------------------------------- | -------------------------------------- |
| EC2 / GCE / VM       | 単純、fix IP                             | operator の ops 負担                   |
| Cloud Run / Fargate  | autoscale                                | cold start, autoscale tuning           |
| k8s Deployment       | 既存 cluster で運用一元化                | k8s が必要                             |
| Cloudflare Worker (別 Worker) | edge コロケーション             | egress 制限は同じ                      |

### 形態 C: runtime-agent (推奨 production)

provider plugin が **kernel から resource を直接 materialize する代わりに**、
runtime-agent process が kernel から work lease を pull して、provider 操作を
**agent の存在する cloud 内** で実行します:

```
kernel (CF) -- 1. enqueue work --> work queue (kernel state)
                                          ^
                                          | 2. lease pull
                                          v
agent (AWS EC2) -- 3. AWS SDK call --> AWS API
agent (AWS EC2) -- 4. report result --> kernel
```

利点:

- AWS / GCP credentials が **agent process だけ** に inject され、Cloudflare
  Worker secret には乗らない (blast radius 縮小)
- VPC 内 endpoint (RDS / Cloud SQL Private IP) に直接アクセスできる
- 長尺 ops (RDS create 5 分など) も timeout なしで実行可能

欠点:

- agent host の運用 (systemd / patches / restart) が operator 責任

## runtime-agent の placement

agent は kernel に enroll → heartbeat → lease pull → 実行 → report
というループです。配置の決め方:

| 構成                                      | agent 推奨配置                        |
| ----------------------------------------- | ------------------------------------- |
| Cloudflare control + AWS tenant           | AWS EC2 (t3.small) または ECS Fargate |
| Cloudflare control + GCP tenant           | GCP Cloud Run (min instances=1) or GKE pod |
| Cloudflare control + k8s tenant           | k8s pod (in-cluster ServiceAccount)   |
| Cloudflare control + selfhosted resource  | bare metal systemd                    |
| AWS/GCP only                              | 同じ cloud 内 (kernel と同じ pod)     |
| Selfhosted                                | bare metal systemd                    |

agent process の最小構成:

```ts
// runtime-agent.ts
import { RuntimeAgentHttpClient, RuntimeAgentLoop } from "takos-paas-plugins/runtime-agent";

const client = new RuntimeAgentHttpClient({
  baseUrl: Deno.env.get("TAKOS_KERNEL_URL")!,
  enrollmentToken: Deno.env.get("TAKOS_RUNTIME_AGENT_TOKEN")!,
});

const loop = new RuntimeAgentLoop({
  client,
  agentId: Deno.hostname(),
  provider: "aws",  // or "gcp" / "k8s" / "selfhosted"
  capabilities: { kinds: ["aws.ecs.deploy", "aws.rds.materialize"] },
  executors: {
    "aws.ecs.deploy": awsEcsExecutor,
    "aws.rds.materialize": awsRdsExecutor,
  },
});
await loop.run();
```

各 cloud-specific docs に systemd / Cloud Run / k8s Deployment の YAML
サンプルがあります:

- [AWS](/hosting/aws#runtime-agent-phase-17b-を-aws-に置く)
- [GCP](/hosting/gcp#runtime-agent-phase-17b-を-gcp-に置く)
- [Kubernetes](/hosting/kubernetes#runtime-agent-phase-17b-を-k8s-に置く)
- [Self-hosted](/hosting/self-hosted#runtime-agent-on-bare-metal)

### lease semantics

- agent は `idleBackoffMs` (default 1000) でポーリング
- lease TTL (default 60s) を超えると kernel が再 enqueue
- agent が長尺 ops を実行中は `reportProgress({ extendUntil })` で延長
- `failed` で `retry: true` を返すと kernel が再 enqueue (max retry まで)
- `failed` で `retry: false` を返すと dead-letter

## routing layer の選択

routing は kernel が tenant request を tenant workload に届ける layer です。
profile ごとに異なります:

| profile                  | routing primary           | DNS                | cert                    |
| ------------------------ | ------------------------- | ------------------ | ----------------------- |
| `cloudflare`             | dispatch namespace        | Cloudflare DNS     | universal SSL           |
| `cloudflare-aws`         | dispatch + AWS ALB        | Route53            | ACM cert                |
| `cloudflare-gcp`         | dispatch + GCP HTTP(S) LB | Cloud DNS          | Google-managed cert     |
| `cloudflare-kubernetes`  | dispatch + k8s Ingress    | external-dns       | cert-manager (Let's Enc.)|
| `aws`                    | ALB + Route53             | Route53            | ACM cert                |
| `gcp`                    | HTTP(S) LB + Cloud DNS    | Cloud DNS          | Google-managed cert     |
| `selfhosted`             | Caddy / nginx             | external           | Let's Encrypt + certbot |

operator が手動でやること (cross-cloud 共通):

1. DNS zone の作成と委任 (`takos.example.com` の NS を cloud DNS に向ける)
2. wildcard cert の発行 (`*.app.takos.example.com`) または DNS-01 challenge
   設定
3. routing layer (ALB / HTTP(S) LB / Ingress) を operator が事前 install
4. profile の `routerConfig` セクションに ARN / zone ID / Ingress class を
   注入

kernel が plugin 経由でやること:

- per-tenant route block / target group / URL map / Ingress rule の同期
- DNS A / ALIAS / CNAME record の create / update / delete (DNS provider plugin)
- drift 検出 (actual route state vs desired)

## drift detection / rollback の cross-cloud semantics

Phase 17C で実装した routing observation と Phase 17A の各 provider plugin
は **drift 検出と rollback** を `Deployment.observation` レコードに統一して
emit します。

### drift 検出

| 検出される drift                                   | 検出元 provider client    | 検出方法                              |
| -------------------------------------------------- | ------------------------- | ------------------------------------- |
| ECS service desired count が manifest と異なる     | `aws-control-plane`       | DescribeServices polling              |
| ALB target group の target が抜けている            | `aws-alb-route53-router`  | DescribeTargetHealth polling          |
| Cloud Run revision の traffic split が想定外       | `gcp-control-plane`       | services.get polling                  |
| URL map の hostRule が手動編集されている           | `gcp-load-balancer-router`| urlMaps.get polling                   |
| k8s Deployment の replicas が manual scale された  | `k8s-deployment`          | watch event                           |
| Ingress の TLS Secret が cert-manager 外で変更    | `k8s-ingress-router`      | watch event + cert-manager status     |
| Caddyfile が外から書き換えられた                   | `selfhosted-router-config`| file hash polling                     |

cross-cloud の drift は kernel の `provider_observations` テーブルに統一形式
で書き込まれます。観測周期は default 60s で、profile の
`pluginConfig.*.observationIntervalMs` で調整できます。

### rollback semantics

`takos rollback --group <name>` を実行すると:

1. kernel は **previous Deployment の `descriptor_closure` を retain
   している前提** で resolved_graph を復元
2. 各 provider plugin に「previous state に戻せ」work を enqueue
3. agent / plugin が cloud-specific な rollback ops を実行:
   - **AWS**: ECS service `desiredCount` を previous task definition revision に戻す
   - **GCP**: Cloud Run service の traffic split を previous revision に戻す
   - **k8s**: Deployment の `spec.replicas` / image tag を previous に戻す
   - **selfhosted**: Caddyfile / docker-compose を previous version に書き戻す
4. routing record (Route53 / Cloud DNS / Ingress) も previous state に戻す
5. group head ref を previous Deployment に切替

cross-cloud で rollback する場合の制約:

- **DB schema migration が forward-only な resource は rollback できない**
  (例: column drop)。manifest 側で migration を separate component に切り出し、
  rollback policy を `destructive: false` に設定する
- **DNS TTL の伝播は cloud 依存**: Route53 / Cloud DNS は 30s-300s で伝播、
  Cloudflare DNS は数秒。マルチ cloud rollback では最大 TTL を考慮する
- **ACM / Google-managed cert の renewal は rollback 対象外**: cert
  resource は kernel が直接 manage しない (operator pre-issued)

詳細な rollback semantics は [Rollback](/deploy/rollback) を参照。

## end-to-end runbook (Cloudflare control + AWS tenant)

実例として **Cloudflare で kernel を動かしつつ tenant runtime / DB を AWS
に置く** 構成の e2e runbook を示します。

```bash
# 1. Cloudflare side: kernel 本体を deploy (既存 4-step runbook)
cd takos-private/apps/control
deno task secrets:sync:production
deno task deploy:production --confirm production

# 2. AWS side: IAM role + credentials 発行
aws iam create-user --user-name takos-provider
aws iam attach-user-policy --user-name takos-provider \
  --policy-arn arn:aws:iam::123456789012:policy/TakosProvider
aws iam create-access-key --user-name takos-provider > /tmp/aws-keys.json

# 3. AWS credentials を CF Worker secret に inject
ACCESS_KEY=$(jq -r '.AccessKey.AccessKeyId' /tmp/aws-keys.json)
SECRET_KEY=$(jq -r '.AccessKey.SecretAccessKey' /tmp/aws-keys.json)
echo "$ACCESS_KEY" | deno task secrets put AWS_ACCESS_KEY_ID --env production
echo "$SECRET_KEY" | deno task secrets put AWS_SECRET_ACCESS_KEY --env production

# 4. profile を cloudflare-aws に切替
cd ../../../takos-paas-plugins
cp profiles/cloudflare-aws.example.json deploy/cloudflare/profiles/production.json
# accountId / region / artifactBucket を実値に編集
deno task profile:apply --env production

# 5. AWS 側: ALB + Route53 + ACM cert を pre-provision
aws elbv2 create-load-balancer --name takos-tenant-alb ...
aws route53 create-hosted-zone --name app.takos.example.com ...
aws acm request-certificate --domain-name '*.app.takos.example.com' \
  --validation-method DNS

# 6. runtime-agent を AWS EC2 に deploy
ssh ec2-user@runtime-agent.takos.example.com \
  'sudo systemctl enable --now takos-runtime-agent'

# 7. 動作確認
takos login --api-url=https://admin.takos.example.com
takos deploy --env production --space SPACE_ID --group my-app
curl https://my-app.app.takos.example.com  # AWS ALB 経由で ECS Fargate に到達
```

GCP / k8s / selfhosted も同様の流れです (cloud-specific docs を参照)。

## 関連ドキュメント

- [Cloudflare](/hosting/cloudflare) ― tracked reference Workers backend
- [AWS](/hosting/aws) ― AWS provider plugin と Helm overlay
- [GCP](/hosting/gcp) ― GCP provider plugin と Helm overlay
- [Kubernetes](/hosting/kubernetes) ― k8s provider plugin と base Helm chart
- [Self-hosted](/hosting/self-hosted) ― selfhosted provider plugin と
  bare metal runbook
- [Deploy](/deploy/) ― deploy manifest author 向け
- [Rollback](/deploy/rollback) ― rollback semantics
- [環境ごとの差異](/hosting/differences) ― hosting surface 比較
