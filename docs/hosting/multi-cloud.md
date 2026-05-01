# Multi-cloud

このページは **Takos kernel を複数 cloud にまたがって運用する operator** 向けの
cross-cloud runbook です。Phase 17 (provider plugin / runtime-agent / routing
layer / 21 ignored test re-enable) の完了を前提とし、Cloudflare / AWS / GCP /
Kubernetes / self-hosted の境界を一望します。

target-specific な手順は次の per-target docs を参照してください。本ページは **5
target 横断の意思決定** と **境界に出る instruction** を整理します:

- [Cloudflare](/hosting/cloudflare) ― Cloudflare Workers backend
- [AWS](/hosting/aws) ― EKS Helm overlay + AWS provider plugin
- [GCP](/hosting/gcp) ― GKE Helm overlay + GCP provider plugin
- [Kubernetes](/hosting/kubernetes) ― base Helm chart + k8s provider plugin
- [Self-hosted](/hosting/self-hosted) ― docker-compose + selfhosted provider
  plugin

Provider proof は opt-in です。provider credentials、cluster、account、gateway
を必要とする proof は operator が明示的に起動し、CI に入れる場合も専用の gate
として実行します。default docs build / PaaS kernel gate は provider
実環境の到達性を要求しません。

## kernel host target を multi-cloud で選ぶ

Takos kernel の deploy 正本は `takos-private/distribution.yml` です。
multi-cloud 構成では **kernel host target を 1 つ** 選び、**tenant runtime
target を別 (または複数)** にすることで、kernel と tenant workload を 別 cloud
に分離できます:

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

`distribute:apply` は `kernel_host.target` 1 つだけを deploy 対象として dispatch
し (このとき他 target 用の Helm / compose は触らない)、 `tenant_runtime.targets`
は **tenant が `takos deploy` 時に選択できる候補 セット** として kernel
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
3. **routing layer をどの cloud に置くか** (CF dispatch / AWS ALB / GCP LB / k8s
   Ingress / Caddy)
4. **runtime-agent をどこに常駐させるか** (kernel と同じ cloud か別 cloud か)

この 4 つは独立に組み合わせられます。

## composite descriptor の使い方

Phase 13 で導入した composite descriptor は **runtime + resource + publication

- route の組** を 1 つの authoring alias として manifest に書けるようにします。
  canonical な 4 個 (`takos-paas-plugins/src/profiles/composite/mod.ts`) を
  operator が deploy manifest 上で参照します。

| alias                                   | 構成                                               |
| --------------------------------------- | -------------------------------------------------- |
| `composite.serverless-with-postgres@v1` | runtime.js-worker + resource.sql.postgres          |
| `composite.web-app-with-cdn@v1`         | runtime.js-worker + resource.object-store.s3 + CDN |
| `composite.cf-control-aws-tenant@v1`    | runtime.oci-container + AWS tenant routing         |
| `composite.cf-control-gcp-tenant@v1`    | runtime.oci-container + GCP tenant routing         |

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
canonical descriptor digest を `Deployment.resolution.descriptor_closure` に pin
します。展開結果の materialization は profile の provider-selection policy gate
が決めます。

::: tip provider-agnostic 原則 composite descriptor は **shape を fix する**
だけで、 provider materialization は profile が決めます。同じ manifest を
Cloudflare profile に当てれば Workers + Hyperdrive Postgres、AWS profile
に当てれば Lambda + RDS Postgres に展開されます (provider-selection policy
が決定)。 :::

## provider plugin profile の選び方

`distribution.yml` の `kernel_host.target` / `tenant_runtime.targets` は deploy
入口を切り替える top-level switch です。kernel が tenant request の
materialization に使う **provider plugin profile** は、その下で profile JSON
(`takos-paas-plugins/profiles/*.example.json`) に展開され、
`pluginConfig.operator.takos.<profile>.clients.*` で各 PaaS plugin slot を どの
provider client に向けるかを宣言します。

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
[kernel host target を multi-cloud で選ぶ](#kernel-host-target-を-multi-cloud-で選ぶ)
の組み合わせ表に従い、`distribution.yml` の組み合わせと整合する profile
を選択してください。

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

| gateway 配置場所              | 利点                      | 欠点                         |
| ----------------------------- | ------------------------- | ---------------------------- |
| EC2 / GCE / VM                | 単純、fix IP              | operator の ops 負担         |
| Cloud Run / Fargate           | autoscale                 | cold start, autoscale tuning |
| k8s Deployment                | 既存 cluster で運用一元化 | k8s が必要                   |
| Cloudflare Worker (別 Worker) | edge コロケーション       | egress 制限は同じ            |

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

| 構成                                     | agent 推奨配置                             |
| ---------------------------------------- | ------------------------------------------ |
| Cloudflare control + AWS tenant          | AWS EC2 (t3.small) または ECS Fargate      |
| Cloudflare control + GCP tenant          | GCP Cloud Run (min instances=1) or GKE pod |
| Cloudflare control + k8s tenant          | k8s pod (in-cluster ServiceAccount)        |
| Cloudflare control + selfhosted resource | bare metal systemd                         |
| AWS/GCP only                             | 同じ cloud 内 (kernel と同じ pod)          |
| Selfhosted                               | bare metal systemd                         |

agent process の最小構成:

```ts
// runtime-agent.ts
import {
  RuntimeAgentHttpClient,
  RuntimeAgentLoop,
} from "takos-paas-plugins/runtime-agent";

const client = new RuntimeAgentHttpClient({
  baseUrl: Deno.env.get("TAKOS_KERNEL_URL")!,
  enrollmentToken: Deno.env.get("TAKOS_RUNTIME_AGENT_TOKEN")!,
});

const loop = new RuntimeAgentLoop({
  client,
  agentId: Deno.hostname(),
  provider: "aws", // or "gcp" / "k8s" / "selfhosted"
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

| profile                 | routing primary           | DNS            | cert                      |
| ----------------------- | ------------------------- | -------------- | ------------------------- |
| `cloudflare`            | dispatch namespace        | Cloudflare DNS | universal SSL             |
| `cloudflare-aws`        | dispatch + AWS ALB        | Route53        | ACM cert                  |
| `cloudflare-gcp`        | dispatch + GCP HTTP(S) LB | Cloud DNS      | Google-managed cert       |
| `cloudflare-kubernetes` | dispatch + k8s Ingress    | external-dns   | cert-manager (Let's Enc.) |
| `aws`                   | ALB + Route53             | Route53        | ACM cert                  |
| `gcp`                   | HTTP(S) LB + Cloud DNS    | Cloud DNS      | Google-managed cert       |
| `selfhosted`            | Caddy / nginx             | external       | Let's Encrypt + certbot   |

operator が手動でやること (cross-cloud 共通):

1. DNS zone の作成と委任 (`takos.example.com` の NS を cloud DNS に向ける)
2. wildcard cert の発行 (`*.app.takos.example.com`) または DNS-01 challenge 設定
3. routing layer (ALB / HTTP(S) LB / Ingress) を operator が事前 install
4. profile の `routerConfig` セクションに ARN / zone ID / Ingress class を 注入

kernel が plugin 経由でやること:

- per-tenant route block / target group / URL map / Ingress rule の同期
- DNS A / ALIAS / CNAME record の create / update / delete (DNS provider plugin)
- drift 検出 (actual route state vs desired)

## drift detection / rollback の cross-cloud semantics

Phase 17C で実装した routing observation と Phase 17A の各 provider plugin は
**drift 検出と rollback** を `Deployment.observation` レコードに統一して emit
します。

### drift 検出

| 検出される drift                                  | 検出元 provider client     | 検出方法                          |
| ------------------------------------------------- | -------------------------- | --------------------------------- |
| ECS service desired count が manifest と異なる    | `aws-control-plane`        | DescribeServices polling          |
| ALB target group の target が抜けている           | `aws-alb-route53-router`   | DescribeTargetHealth polling      |
| Cloud Run revision の traffic split が想定外      | `gcp-control-plane`        | services.get polling              |
| URL map の hostRule が手動編集されている          | `gcp-load-balancer-router` | urlMaps.get polling               |
| k8s Deployment の replicas が manual scale された | `k8s-deployment`           | watch event                       |
| Ingress の TLS Secret が cert-manager 外で変更    | `k8s-ingress-router`       | watch event + cert-manager status |
| Caddyfile が外から書き換えられた                  | `selfhosted-router-config` | file hash polling                 |

cross-cloud の drift は kernel の `provider_observations` テーブルに統一形式
で書き込まれます。観測周期は default 60s で、profile の
`pluginConfig.*.observationIntervalMs` で調整できます。

### rollback semantics

`takos rollback --group <name>` を実行すると:

1. kernel は **previous Deployment の `descriptor_closure` を retain
   している前提** で resolved_graph を復元
2. 各 provider plugin に「previous state に戻せ」work を enqueue
3. agent / plugin が cloud-specific な rollback ops を実行:
   - **AWS**: ECS service `desiredCount` を previous task definition revision
     に戻す
   - **GCP**: Cloud Run service の traffic split を previous revision に戻す
   - **k8s**: Deployment の `spec.replicas` / image tag を previous に戻す
   - **selfhosted**: Caddyfile / docker-compose を previous version に書き戻す
4. routing record (Route53 / Cloud DNS / Ingress) も previous state に戻す
5. group head ref を previous Deployment に切替

cross-cloud で rollback する場合の制約:

- **DB schema migration が forward-only な resource は rollback できない** (例:
  column drop)。manifest 側で migration を separate component に切り出し、
  rollback policy を `destructive: false` に設定する
- **DNS TTL の伝播は cloud 依存**: Route53 / Cloud DNS は 30s-300s で伝播、
  Cloudflare DNS は数秒。マルチ cloud rollback では最大 TTL を考慮する
- **ACM / Google-managed cert の renewal は rollback 対象外**: cert resource は
  kernel が直接 manage しない (operator pre-issued)

詳細な rollback semantics は [Rollback](/deploy/rollback) を参照。

## end-to-end runbook (Cloudflare control + AWS tenant)

実例として **Cloudflare で kernel を動かしつつ tenant runtime / DB を AWS
に置く** 構成の e2e runbook を示します。

```bash
# 1. distribution.yml を編集
#    kernel_host.target: cloudflare
#    tenant_runtime.targets: [cloudflare, aws]
cd takos-private
$EDITOR distribution.yml

# 2. platform secret + per-cloud key を発行
deno task generate:keys:production --per-cloud

# 3. AWS side: IAM role + credentials 発行
aws iam create-user --user-name takos-provider
aws iam attach-user-policy --user-name takos-provider \
  --policy-arn arn:aws:iam::123456789012:policy/TakosProvider
aws iam create-access-key --user-name takos-provider > /tmp/aws-keys.json

# 4. AWS credentials を CF Worker secret に inject
ACCESS_KEY=$(jq -r '.AccessKey.AccessKeyId' /tmp/aws-keys.json)
SECRET_KEY=$(jq -r '.AccessKey.SecretAccessKey' /tmp/aws-keys.json)
cd apps/control
echo "$ACCESS_KEY" | deno task secrets put AWS_ACCESS_KEY_ID --env production
echo "$SECRET_KEY" | deno task secrets put AWS_SECRET_ACCESS_KEY --env production
cd ../..

# 5. provider plugin profile を cloudflare-aws に切替
cd ../takos-paas-plugins
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

# 9. 初期 admin / tenant / registry trust roots を seed
cd ../takos/paas
deno task --cwd apps/paas bootstrap:initial -- --admin-email=admin@takos.jp

# 10. 動作確認
takos login --api-url=https://admin.takos.example.com
takos deploy --env production --space SPACE_ID --group my-app
curl https://my-app.app.takos.example.com  # AWS ALB 経由で ECS Fargate に到達
```

GCP / k8s / selfhosted も同様の流れです (target-specific docs を参照)。

## secret partition と rotation runbook (Phase 18.2 H14 + H15)

multi-cloud 構成では **1 つの cloud key が漏れた場合に他 cloud に影響しない**
ことが境界条件になります。Takos kernel の secret store は cloud partition ごとに
**独立した encryption key** を保持し、AES-GCM の AAD に partition ラベルを bind
することで cross-partition open を fail させます。

### per-cloud key 発行 (H14)

operator は `generate-platform-keys` を `--per-cloud` 付きで実行して per-cloud
encryption key を発行します:

```bash
cd takos-private
deno run --allow-read --allow-write --allow-env \
  scripts/generate-platform-keys.ts --env=production --per-cloud
```

これにより `ENCRYPTION_KEY_CLOUDFLARE` / `ENCRYPTION_KEY_AWS` /
`ENCRYPTION_KEY_GCP` / `ENCRYPTION_KEY_K8S` / `ENCRYPTION_KEY_SELFHOSTED` の 5
ファイルが追加で出力されます。kernel boot 時には:

| env key                                                                  | partition    |
| ------------------------------------------------------------------------ | ------------ |
| `TAKOS_SECRET_STORE_PASSPHRASE` (or fallback)                            | `global`     |
| `TAKOS_SECRET_STORE_PASSPHRASE_AWS` / `ENCRYPTION_KEY_AWS`               | `aws`        |
| `TAKOS_SECRET_STORE_PASSPHRASE_GCP` / `ENCRYPTION_KEY_GCP`               | `gcp`        |
| `TAKOS_SECRET_STORE_PASSPHRASE_CLOUDFLARE` / `ENCRYPTION_KEY_CLOUDFLARE` | `cloudflare` |
| `TAKOS_SECRET_STORE_PASSPHRASE_K8S` / `ENCRYPTION_KEY_K8S`               | `k8s`        |
| `TAKOS_SECRET_STORE_PASSPHRASE_SELFHOSTED` / `ENCRYPTION_KEY_SELFHOSTED` | `selfhosted` |

unset の partition は `global` key を partition label と HKDF-style に 混合した
derived passphrase で sealed されます。production では override を
明示する運用が推奨です。

### compromise 時の incident response

| 漏洩した key              | 影響範囲                   | 対応                                            |
| ------------------------- | -------------------------- | ----------------------------------------------- |
| `ENCRYPTION_KEY_AWS`      | aws partition のみ         | AWS partition の secret を rotate               |
| `ENCRYPTION_KEY_GCP`      | gcp partition のみ         | GCP partition の secret を rotate               |
| `ENCRYPTION_KEY` (global) | derive 元の partition 全て | 全 partition rotation + per-cloud override 切替 |

cross-partition leak が発生しないことは
`MultiCloudSecretBoundaryCrypto: aws key compromise does not unlock other
partitions`
test で property-style に保証されています。

### rotation policy + version GC (H15)

各 secret に `rotation_policy: { intervalDays, gracePeriodDays }` を付与
すると、background job (`SecretRotationService.checkRotation`) が:

1. `intervalDays` 経過で `state=due` に遷移し、operator notification 用 audit
   event (`secret.rotation.notice`, severity=warning) を emit
2. `intervalDays + gracePeriodDays` 経過で `state=expired` (severity=critical)
3. `withGc=true` で実行すると同時に version GC を走らせ、`latest 5` +
   `last accessed within 90d` 以外の version を削除 (削除分は
   `secret.version.gc` audit event に記録)

operator が手動で rotate する場合は CLI を使います:

```bash
takos rotate-secret AWS_SECRET_ACCESS_KEY \
  --cloud-partition aws --reason "scheduled rotation"
```

CLI は `SecretRotationService.rotateSecret` を経由し、新しい version を write
しつつ `secret.rotation.executed` audit event (actor + reason 付き)
を残します。previous version は version GC まで retain されるため、 直前
rollback には支障ありません。

### scheduled job 例 (Cloudflare cron trigger)

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

(cron は wrangler.toml の `[triggers] crons = ["0 3 * * *"]` で daily 03:00 UTC)

## Audit retention policy (PCI-DSS / HIPAA / SOX)

Takos kernel は `audit_events` table を tamper-evident 化するために SHA-256 hash
chain で append-only 運用しています。Phase 18.3 / M9 では regulated workload
(PCI-DSS / HIPAA / SOX) 向けに retention policy を formalize しました:

### policy 構成

`AuditRetentionPolicy` (`apps/paas/src/services/audit-replication/policy.ts`) は
env-aware に解決されます:

| env                                | 役割                                                  | 例                |
| ---------------------------------- | ----------------------------------------------------- | ----------------- |
| `TAKOS_AUDIT_RETENTION_REGIME`     | `default` / `pci-dss` / `hipaa` / `sox` / `regulated` | `hipaa`           |
| `TAKOS_AUDIT_RETENTION_DAYS`       | retention 上書き (days)                               | `2555` (= 7y SOX) |
| `TAKOS_AUDIT_DELETE_AFTER_ARCHIVE` | replicate 確認後に primary store から delete する     | `false` (default) |
| `TAKOS_AUDIT_ARCHIVE_GRACE_DAYS`   | archive と delete の grace window (days)              | `30` (default)    |

regulated band (`pci-dss` / `hipaa` / `sox` / `regulated`) を選ぶと
`regulatedDays = 2555 (7y)` が default になります。`default` regime は
`defaultDays = 365 (1y)`。`TAKOS_AUDIT_RETENTION_DAYS` を明示すると band を
override できますが、PCI-DSS の 1y minimum / HIPAA の 6y minimum / SOX の 7y
minimum を operator 自身で確認する必要があります。

### archive vs delete

`audit_events` は **append-only** が default です:

1. retention cutoff (`now - retentionDays`) より古い row は `archived = true` に
   flag
2. `deleteAfterArchive = false` (default): archived row はそのまま残る (full
   hash chain は永続的に検証可能)
3. `deleteAfterArchive = true` を opt-in した場合のみ、`now - retentionDays
   - archiveGracePeriodDays` より古い archived row が delete される。これは
     downstream replication (Sumo / Datadog / S3) を canonical store と
     みなす運用で、grace 内に replication 失敗を検知できる前提

### external replication hook

`AuditReplicationSink` interface
(`apps/paas/src/services/audit-replication/sink.ts`) を実装すると、
`SqlObservabilitySink.appendAudit` 後に各 sink へ chained audit record を
fan-out できます:

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
  retentionPolicy: resolveAuditRetention({ env: Deno.env.toObject() }),
  replication,
});
```

Sink は **append-only / idempotent-by-event-id** が contract です。 downstream
system (Sumo / Datadog / S3 Object Lock / Splunk / SIEM) で 独立した retention
を持たせると、in-region DB が compromise されても canonical compliance store
として機能します。

`InMemoryAuditReplicationSink` は test / local development 用の reference
実装で、`replicate(record)` の dedupe / batch 動作を模倣します。

immutable WORM-grade replication (S3 Object Lock COMPLIANCE mode) は
`AuditExternalReplicationSink` (`external_log.ts`) を使います。これは boot-time
に primary chain と external replica を `(sequence, hash)` 単位で 照合し、DB
改ざん検出に使うための separate 階層です。

### retention runbook

scheduled GC は `SqlObservabilitySink.applyRetentionPolicy` を daily で
呼びます。`TAKOS_AUDIT_RETENTION_DAYS` (or `retentionPolicy`) が設定されて
いれば boot 時にも一度走ります (`apps/paas/src/index.ts` の
`maybeApplyAuditRetention`)。

```ts
// example: regulated env (HIPAA) の cron
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

(Cloudflare cron は `[triggers] crons = ["15 3 * * *"]` を audit retention 専用
worker に設定。secret-rotation cron と分離することで失敗 isolation を 得る)

### Provider observation retention (Phase 18.3 / M3)

`provider_observations` / `runtime_provider_observations` table は
`ObservationRetentionService`
(`apps/paas/src/services/observation-retention/service.ts`) で daily GC します:

| 段階     | window           | 動作                           |
| -------- | ---------------- | ------------------------------ |
| recent   | `now - 30d` 以内 | live (drift query 即時応答)    |
| archived | `30d - 90d`      | `archived = true` に flag 切替 |
| deleted  | `90d` 超過       | DELETE (cold-line export 必要) |

current deployment (`group_heads.current_deployment_id`) に紐づく observation は
age に関係なく archive 対象外です。drift detection の 正確性を保つため、head
に対する live snapshot は常に保持されます。

`startObservationRetentionJob({ service, intervalMs: 24*60*60*1000 })` を boot
path から呼ぶと daily の GC ループに入ります。`onReport` callback で
`{archivedDeploy, archivedRuntime, deletedDeploy, deletedRuntime}` の metric を
emit すると dashboards で観測できます。

## DB at-rest encryption の enforce (Phase 18.3 M7)

Takos PaaS は production / staging boot で **DB connection の at-rest encryption
flag** を強制チェックします。recognised signals は次のとおりです:

| backend             | recognised signal                                                   |
| ------------------- | ------------------------------------------------------------------- |
| Postgres            | `?sslmode=require` / `verify-ca` / `verify-full` または `?ssl=true` |
| Cloudflare D1       | `d1://...` URL (provider 側で常に encrypted at rest)                |
| SQLCipher           | `sqlcipher://...`                                                   |
| encrypted SQLite    | `sqlite://path?key=...` (PRAGMA key 経由)                           |
| 汎用 override flag  | `?encrypted=true` を URL に付与                                     |
| postgres TLS scheme | `postgres+tls://` / `postgresql+tls://`                             |

cloud 別の推奨設定:

- **Cloudflare D1**: `d1://<binding-name>` を `DATABASE_URL` に設定するだけで OK
- **AWS RDS / Aurora**: `?sslmode=require` を URL に追加し、CA bundle を信頼する
- **GCP Cloud SQL**: Cloud SQL Auth Proxy + `?sslmode=verify-ca` で CA を pin
- **Kubernetes (self-managed Postgres)**: cert-manager で issue した cert を
  `sslmode=verify-full` で接続。pgcrypto / TDE / encrypted PV を operator が選択
- **Self-hosted**: SQLCipher、または LUKS 等で disk encryption を operator が
  enforce

local / dev で encryption の無い DB を使う場合は `TAKOS_ALLOW_UNENCRYPTED_DB=1`
で明示 opt-in が必要です (production / staging では opt-in 無効、boot 時に
`process exit 1` で fail-closed)。

## audit-replication external sink (Phase 18.3 M5)

audit_events table の SHA-256 hash chain は app 層で計算されますが、DBA が DB
上で chain を再計算しながら row を改竄するシナリオでは **off-DB の immutable
replica** が canonical な tamper evidence になります。Takos PaaS は production /
staging boot で `AuditExternalReplicationSink` を必須化します:

| `TAKOS_AUDIT_REPLICATION_KIND` | 実装                            | 用途                              |
| ------------------------------ | ------------------------------- | --------------------------------- |
| `s3`                           | `S3ImmutableLogReplicationSink` | 本番。S3 versioning + Object Lock |
| `stdout`                       | `StdoutReplicationSink`         | test / smoke。append-only stdout  |

S3 sink は `<prefix>/<10-digit-zero-padded-sequence>-<hash[:16]>.json` の key で
1 event = 1 object として upload し、Object Lock retention を
`TAKOS_AUDIT_REPLICATION_S3_RETENTION_DAYS` (default 2555 = 7y, COMPLIANCE mode)
で固定します。`s3:BypassGovernanceRetention` を持たない IAM principal
で運用すれば DBA が compromise された場合でも replica は触れません。

cloud 別の推奨組み合わせ:

| kernel cloud      | recommended replica target                                 |
| ----------------- | ---------------------------------------------------------- |
| Cloudflare        | AWS S3 (cross-cloud immutable archive) または R2 + lock    |
| AWS               | S3 + Object Lock COMPLIANCE                                |
| GCP               | GCS Bucket Lock 経由の S3 互換 layer または cross-cloud S3 |
| Kubernetes / self | MinIO with Object Lock または off-cluster S3               |

boot 時には `verifyAuditReplicationConsistency` が SQL chain と external chain
を `(sequence, hash)` で照合し、divergence (DB 削除 / hash mismatch) を検出
した場合 production / staging では fail-closed します。catch-up 状態 (primary が
external より進んでいる場合) は OK として扱われ、定期 GC ジョブが lag を
解消します。

env vars:

| key                                         | 用途                                                            |
| ------------------------------------------- | --------------------------------------------------------------- |
| `TAKOS_AUDIT_REPLICATION_KIND`              | `s3` / `stdout`                                                 |
| `TAKOS_AUDIT_REPLICATION_S3_BUCKET`         | S3 bucket name (s3 sink 必須)                                   |
| `TAKOS_AUDIT_REPLICATION_S3_PREFIX`         | object key prefix (default `audit-replication`)                 |
| `TAKOS_AUDIT_REPLICATION_S3_RETENTION_MODE` | `COMPLIANCE` (default) / `GOVERNANCE`                           |
| `TAKOS_AUDIT_REPLICATION_S3_RETENTION_DAYS` | retain-until-date を boot 時刻 + N 日で設定 (default 2555 = 7y) |

## 関連ドキュメント

- [Cloudflare](/hosting/cloudflare) ― tracked reference Workers backend
- [AWS](/hosting/aws) ― AWS provider plugin と Helm overlay
- [GCP](/hosting/gcp) ― GCP provider plugin と Helm overlay
- [Kubernetes](/hosting/kubernetes) ― k8s provider plugin と base Helm chart
- [Self-hosted](/hosting/self-hosted) ― selfhosted provider plugin と bare metal
  runbook
- [Deploy](/deploy/) ― deploy manifest author 向け
- [Rollback](/deploy/rollback) ― rollback semantics
- [環境ごとの差異](/hosting/differences) ― hosting surface 比較
