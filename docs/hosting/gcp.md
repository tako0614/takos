# GCP

> このページでわかること: Takosumi kernel を GCP (GKE / Cloud Run)
> にホストする方法。

このページは **Takosumi kernel を GCP にホストする operator** 向けです。
カバー範囲は 2 通りで、用途に応じて使い分けます:

1. **GCP 単独 hosting (GKE Helm)** ― `takos/deploy/helm/takos/values-gcp.yaml`
   overlay。Kubernetes ベースで control plane / runtime / executor を運用する
   path。
2. **GCP reference runtime connector** ― Cloud Run / Cloud SQL / GCS /
   Pub/Sub / Cloud KMS / Secret Manager の inventory / evidence connector を takosumi.com reference
   implementation の配線として呼び出す path。Cloudflare control plane + GCP
   tenant runtime (`composite.cf-control-gcp-tenant@v1`) や GCP 単独 profile
   (`profiles/gcp.example.json`) で使う。

::: tip 対象範囲 section 1 (Helm overlay) は Cloud Run への kernel 直接
deploy、Firestore を control-plane storage として使う構成、Terraform overlay
を扱いません。 section 2 (reference runtime connector) は operator-owned infra workflow
が作った PlatformService inventory と Deployment evidence の接続までを扱います。 :::

Takosumi 上で Source から Installation を作り、Deployment を管理する方法は [Deploy](/deploy/)
を参照してください。 5 target 横断 runbook は
[Multi-cloud](/hosting/multi-cloud) を参照してください。

## 統合 distribution からこの target を選ぶ

Takos product distribution artifact は `takos/deploy/` にあり、
`takos-private/distribution.yml` は private operator が target を選ぶ instance
config です。GCP GKE を kernel host に選ぶには:

```yaml
# takos-private/distribution.yml
distribution:
  kernel_host:
    target: gcp
    region: us-central1
    project_id: takos-jp-prod
    cluster_name: takos-control
    values_file: deploy/helm/values-gcp.yaml
```

## target-specific 設定

GCP GKE target に固有の prerequisites:

- GCP project + billing account link
- GKE cluster (Standard / Autopilot)
- Cloud SQL PostgreSQL + Cloud SQL Auth Proxy or connector
- Memorystore for Redis endpoint
- GCS bucket with HMAC interoperability access
- GCE Ingress / static external IP
- Google-managed SSL certificate (admin + tenant wildcard domain)
- Workload Identity-enabled service account (`iam.gke.io/gcp-service-account`
  annotation 用)
- External Secrets Operator などの secret 管理

詳細な values overlay と外部 secret 構成は
[Section 1: Helm overlay (kernel hosting)](#section-1-helm-overlay-kernel-hosting)
を参照してください。

## deploy 実行

5 target 共通の quick runbook です。target ごとの差は `distribution.yml` の
`kernel_host.target` だけで、`distribute:apply` が target 固有 backend (wrangler
/ Helm / docker-compose) に dispatch します:

```bash
# 共通手順 (5 target で同じ)
cd takos-private
bun run generate:keys:production --per-cloud
# distribution.yml を編集 (kernel_host.target = gcp)
bun run distribute:dry-run --confirm production
bun run distribute:apply --confirm production
cd ../takosumi
bun packages/cli/src/main.ts accounts seed \
  --issuer https://accounts.gcp.example.com \
  --subject tsub_admin \
  --client-id takos-admin \
  --redirect-uri https://admin.takos.example.com/auth/oidc/callback \
  > accounts-seed-plan.json
```

`distribute:apply` は `kernel_host.target=gcp` を見て内部で
`helm upgrade --install takos-control deploy/helm/takos -f deploy/helm/values-gcp.yaml`
を呼び出します。

## どちらを選ぶか

| 状況                                                                    | 推奨 path          |
| ----------------------------------------------------------------------- | ------------------ |
| Takosumi kernel 全体を GCP の k8s に置く                                | section 1 (Helm)   |
| Cloudflare で kernel を動かしつつ tenant runtime / DB を GCP に置きたい | section 2 (plugin) |
| GCP のみで tenant runtime + control-plane provider を組む               | section 2 + Helm   |

---

## Section 1: Helm overlay (kernel hosting)

### Helm overlay が行うこと

`values-gcp.yaml` は base chart に対して次を設定します:

| 項目            | current value                                                                  |
| --------------- | ------------------------------------------------------------------------------ |
| source          | `deploy/distributions/gcp.json` から `bun run helm:generate-overlays` で生成 |
| images          | distribution profile の service image entries を Helm image values に展開      |
| domains         | distribution profile の `routing` から admin / tenant base domain を展開       |
| runtime config  | `runtimeConfig.environment=production`、implementation binding selector は fail-closed empty |
| ingress         | GCE ingress class と managed certificate annotation を使う                     |
| service account | Workload Identity 用 annotation を受け取る                                     |
| workloads       | `takos-worker` / `takosumi` / `takosumi` / `takos-git` / `takos-agent`      |

overlay は generated artifact です。distribution profile を更新したら:

```bash
cd takos
bun run helm:generate-overlays
bun run helm:check-overlays
```

### 必要な外部サービス

- GKE cluster
- GCE Ingress
- External Secrets Operator などの secret 管理、または Helm values で secret
  を作成する運用
- operator-owned GCP workflow / runtime connector が参照する GCP managed-service credentials

Terraform apply 後の Cloud SQL connection name / Redis URL / Pub/Sub topic / GCS
bucket 名は `bun run terraform:helm-values` で generated values に変換し、
base overlay の後に重ねます。生成 values は non-secret resource id だけを
`runtimeConfig.managedResources` へ入れ、secret は `takos-private` / external
secrets 側に残します。

Terraform live tfvars、provider credential、DB password の扱いは
[Hosting Secret Policy](/hosting/secrets) に従います。`takos/` に committed する
tfvars は CI plan fixture だけで、production / staging の raw secret は
`takos-private` から注入します。

`values-gcp.yaml` は `secrets.create: false` を前提に、既定では chart の release
fullname 由来の Secret 名を参照します。`<release>` は Helm release
名から決まり、各 Secret は `<release>-platform` / `<release>-auth` /
`<release>-llm` になります。外部 secret を使っていて名前が異なる場合だけ
`secrets.existingSecrets.*` を設定してください。

外部 secret の `platform` には `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` /
`ENCRYPTION_KEY` / `EXECUTOR_PROXY_SECRET` / `TAKOS_INTERNAL_API_SECRET`
を含めてください。

### インストール

```bash
cd takos/deploy/helm/takos

helm upgrade --install takos . \
  --namespace takos-system \
  --create-namespace \
  -f values.yaml \
  -f values-gcp.yaml \
  --set serviceAccount.annotations."iam\\.gke\\.io/gcp-service-account"="takos@project.iam.gserviceaccount.com"
```

GCE Ingress の static IP は overlay の `ingress.annotations`
で指定します。ManagedCertificate は chart が `ingress.gcpManagedCertificate`
から作成し、既定では admin domain と tenant wildcard domain を入れます。既存の
ManagedCertificate を使う場合や domain 構成を変える場合は
`ingress.gcpManagedCertificate.name` / `ingress.gcpManagedCertificate.domains`
を上書きしてください。

---

## Section 2: GCP reference runtime connector

### 構成

Takosumi reference implementation の GCP profile は次の runtime connector clients
を使います:

| connector client              | 用途                          | 参照クラス                            |
| ----------------------------- | ----------------------------- | ------------------------------------- |
| `gcp-control-plane`           | Cloud Run service / revision  | `src/providers/gcp/cloud_run.ts`      |
| `gcp-cloud-sql-postgres`      | Cloud SQL Postgres lifecycle  | `src/providers/gcp/cloud_sql.ts`      |
| `gcp-cloud-storage-artifacts` | GCS bucket provisioning       | `src/providers/gcp/gcs.ts`            |
| `gcp-pubsub-control-plane`    | Pub/Sub topic / consumer binding | `src/providers/gcp/pubsub.ts`      |
| `gcp-cloud-kms`               | Cloud KMS key + version       | `src/providers/gcp/kms.ts`            |
| `gcp-secret-manager`          | Secret Manager rotation       | `src/providers/gcp/secret_manager.ts` |
| `gcp-load-balancer-router`    | HTTP(S) LB + Cloud DNS        | `src/providers/gcp/load_balancer.ts`  |
| `gcp-runtime-agent-registry`  | runtime-agent endpoint config | `src/providers/gcp/gateway.ts`        |

profile JSON (`profiles/gcp.example.json`) で `clients.*` を上記 client
名に向けると、takosumi.com reference implementation は operator-owned GCP
workflow の PlatformService inventory と Deployment evidence を読み書きします。

### Operator workflow がやること / reference connector が記録すること

| step                                                                       | operator workflow      | reference connector |
| -------------------------------------------------------------------------- | ---------------------- | --------------- |
| GCP project 作成 / billing account link                                    | yes                    | no              |
| service account JSON / Workload Identity 設定                              | yes                    | no              |
| IAM role attach (Cloud Run / Cloud SQL / Storage / Pub/Sub / KMS / Secret) | yes                    | no              |
| service account JSON または OAuth2 token を kernel に inject               | yes (operator-managed) | no              |
| Cloud SQL / GCS / Pub/Sub / KMS / Secret resource provisioning             | yes                    | records evidence |
| Cloud Run service deploy / revision traffic split                          | yes                    | records evidence |
| HTTP(S) LB url-map + Cloud DNS record 同期                                 | yes                    | records evidence |
| runtime-agent HTTP lifecycle endpoint                                      | yes (process deploy)   | yes (lifecycle RPC) |
| drift 検出 / rollback                                                      | yes                    | records evidence |

### IAM role 設計

Cloud Run + Cloud SQL + GCS + Pub/Sub + KMS + Secret Manager + Cloud DNS
を扱う最小限の役割:

```bash
# kernel から呼ぶ provider 用 service account
gcloud iam service-accounts create takos-provider \
  --project=takos-prod \
  --display-name="Takosumi provider"

gcloud projects add-iam-policy-binding takos-prod \
  --member="serviceAccount:takos-provider@takos-prod.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding takos-prod \
  --member="serviceAccount:takos-provider@takos-prod.iam.gserviceaccount.com" \
  --role="roles/cloudsql.admin"

gcloud projects add-iam-policy-binding takos-prod \
  --member="serviceAccount:takos-provider@takos-prod.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding takos-prod \
  --member="serviceAccount:takos-provider@takos-prod.iam.gserviceaccount.com" \
  --role="roles/pubsub.admin"

gcloud projects add-iam-policy-binding takos-prod \
  --member="serviceAccount:takos-provider@takos-prod.iam.gserviceaccount.com" \
  --role="roles/cloudkms.admin"

gcloud projects add-iam-policy-binding takos-prod \
  --member="serviceAccount:takos-provider@takos-prod.iam.gserviceaccount.com" \
  --role="roles/secretmanager.admin"

gcloud projects add-iam-policy-binding takos-prod \
  --member="serviceAccount:takos-provider@takos-prod.iam.gserviceaccount.com" \
  --role="roles/dns.admin"

gcloud projects add-iam-policy-binding takos-prod \
  --member="serviceAccount:takos-provider@takos-prod.iam.gserviceaccount.com" \
  --role="roles/compute.loadBalancerAdmin"

gcloud iam service-accounts keys create ~/takos-provider.json \
  --iam-account=takos-provider@takos-prod.iam.gserviceaccount.com
```

### Credential injection 方式

#### A. Cloudflare Worker secret (Cloudflare control + GCP tenant の場合)

service account JSON を base64 してから secret に inject:

```bash
cd takos-private
base64 -w0 ~/takos-provider.json | bun run control:secrets put GCP_SERVICE_ACCOUNT_JSON --env production
echo "takos-prod" | bun run control:secrets put GOOGLE_CLOUD_PROJECT --env production
echo "asia-northeast1" | bun run control:secrets put GCP_REGION --env production
```

runtime connector は base64 decode して `google-auth-library` 互換 OAuth2 token
を発行します。

#### B. operator-managed gateway URL

Cloudflare Worker から GCP API を直接呼べない場合 (request size / auth flow
など) は operator が gateway を立てて URL を inject:

```jsonc
{
  "pluginConfig": {
    "operator.takosumi.gcp": {
      "clients": { "...": "..." },
      "region": "asia-northeast1",
      "projectId": "takos-prod",
      "gatewayUrl": "https://gcp-gateway.internal.takos.example/v1/",
      "gatewayToken": "operator-issued-token"
    }
  }
}
```

#### C. Workload Identity Federation (推奨 production)

`gcp.example.json` で `clients.auth: "gcp-iam-iap-auth"` を選ぶと、Identity Pool
/ Provider 経由の short-lived token を使えます。Worker 側の secret は
`GCP_WORKLOAD_IDENTITY_PROVIDER` (provider resource path) と
`GCP_WORKLOAD_IDENTITY_AUDIENCE` を設定するだけで済み、long-lived service
account JSON を持たずに済みます。

### runtime-agent を GCP に置く

#### Cloud Run

```yaml
# cloudrun.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: takos-runtime-agent
  annotations:
    run.googleapis.com/launch-stage: GA
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "1"
        autoscaling.knative.dev/maxScale: "5"
    spec:
      serviceAccountName: takos-runtime-agent@takos-prod.iam.gserviceaccount.com
      containers:
        - image: ghcr.io/takos/runtime-agent:latest
          env:
            - name: PORT
              value: "8789"
            - name: TAKOSUMI_AGENT_TOKEN
              valueFrom:
                secretKeyRef:
                  name: takos-agent-token
                  key: latest
```

```bash
gcloud run services replace cloudrun.yaml \
  --project=takos-prod \
  --region=asia-northeast1
```

Cloud Run の min instance を 1 にして常駐させると lifecycle RPC endpoint の cold
start を避けられます。serverless で間欠的に起動する場合は operator 側の timeout /
retry budget を長めに取ります。

#### GKE pod

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: takos-runtime-agent, namespace: takos }
spec:
  replicas: 2
  selector: { matchLabels: { app: takos-runtime-agent } }
  template:
    metadata: { labels: { app: takos-runtime-agent } }
    spec:
      serviceAccountName: takos-runtime-agent
      containers:
        - name: agent
          image: ghcr.io/takos/runtime-agent:latest
          env:
            - name: PORT
              value: "8789"
          envFrom:
            - secretRef: { name: takos-runtime-agent-token }
```

runtime-agent は bearer 保護の lifecycle HTTP API で kernel からの apply / destroy /
describe / verify envelope を受け、Cloud Run / Cloud SQL / GCS / Pub/Sub / KMS /
Secret ops を実行して結果を返します。

### GCP LB routing の DNS 設定

`gcp-load-balancer-router` connector は次の lifecycle を扱います:

1. Backend service (tenant Cloud Run service / NEG を attach)
2. URL map / host rule (per-tenant host header matcher)
3. Target HTTPS proxy + forwarding rule (static IP)
4. Cloud DNS A record (`<tenant>.app.takos.example.com` → static IP)
5. Google-managed SSL certificate を target proxy に attach

operator がやること:

- Cloud DNS managed zone (`takos.example.com`) 作成
- static external IP 取得 (`gcloud compute addresses create takos-worker --global`)
- Google-managed SSL cert または独自 cert を target proxy に attach (wildcard
  推奨: `*.app.takos.example.com`)
- profile の `pluginConfig.operator.takosumi.gcp.routerConfig` に `urlMapName` /
  `dnsZoneName` / `staticIpName` / `sslCertificateName` を設定

kernel がやること:

- backend service 作成 / NEG attach / health check 設定
- URL map host rule / path matcher の同期
- Cloud DNS A record の create / update / delete
- drift 検出 (URL map rule / DNS record の actual state vs desired)

---

## chart contract に含まれないもの (section 1)

- Cloud Run への Takosumi kernel self-deploy automation
- Cloud Run は tenant image workload adapter として OCI orchestrator
  経由で使う対象であり、 kernel hosting surface ではない
- Firestore / Pub/Sub / Secret Manager を app resource backend として自動
  provisioning する contract (※ section 2 は operator-owned workflow の inventory / evidence 接続を扱う)
- Terraform による GCP resource 作成手順
- GCP 固有 connector 名を app author 向けの public surface として固定
  する contract

必要なら operator が追加 connector / inventory importer
を構成できますが、このページは Takos product/operator distribution の Helm
overlay と reference runtime connector で実際に表現されている範囲だけを runbook
として扱います。

## 次に読むページ

- [Multi-cloud](/hosting/multi-cloud) --- 4 cloud 横断 runbook
- [Kubernetes](/hosting/kubernetes) --- base Helm chart
- [AWS](/hosting/aws) --- EKS overlay
- [Cloudflare](/hosting/cloudflare) --- Cloudflare control plane
- [環境ごとの差異](/hosting/differences) --- current hosting surface の比較
