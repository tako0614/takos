# GCP

このページは **Takos kernel を GCP にホストする operator** 向けです。
カバー範囲は 2 通りで、用途に応じて使い分けます:

1. **GCP 単独 hosting (GKE Helm)** ―
   `takos/paas/deploy/helm/takos/values-gcp.yaml` overlay。Kubernetes ベースで
   control plane / runtime / executor を運用する path。
2. **GCP provider plugin (Phase 17A2)** ― Cloud Run / Cloud SQL / GCS / Pub/Sub
   / Cloud KMS / Secret Manager の 6 provider を Takos PaaS kernel から
   `provider` 契約として呼び出す path。Cloudflare control plane + GCP tenant
   runtime (`composite.cf-control-gcp-tenant@v1`) や GCP 単独 profile
   (`profiles/gcp.example.json`) で使う。

::: warning current contract section 1 (Helm overlay) は Cloud Run へ Takos
kernel を直接デプロイする手順、Firestore を control-plane storage として 使う
matrix、Terraform overlay を含みません。section 2 (provider plugin) は Phase
17A2 で追加された 6 provider の materialization 契約までです。 :::

Takos 上で group を deploy する方法は [Deploy](/deploy/) を参照してください。 5
target 横断 runbook は [Multi-cloud](/hosting/multi-cloud) を参照してください。

## 統合 distribution からこの target を選ぶ

Takos kernel の deploy は target に関わらず `takos-private/distribution.yml`
を正本とします。GCP GKE を kernel host に選ぶには:

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
deno task generate:keys:production --per-cloud
# distribution.yml を編集 (kernel_host.target = gcp)
deno task distribute:dry-run --confirm production
deno task distribute:apply --confirm production
cd ../takos/paas
deno task --cwd apps/paas bootstrap:initial -- --admin-email=admin@takos.jp
```

`distribute:apply` は `kernel_host.target=gcp` を見て内部で
`helm upgrade --install takos-control deploy/helm/takos -f deploy/helm/values-gcp.yaml`
を呼び出します。

## どちらを選ぶか

| 状況                                                                    | 推奨 path          |
| ----------------------------------------------------------------------- | ------------------ |
| Takos kernel 全体を GCP の k8s に置く                                   | section 1 (Helm)   |
| Cloudflare で kernel を動かしつつ tenant runtime / DB を GCP に置きたい | section 2 (plugin) |
| GCP のみで tenant runtime + control-plane provider を組む               | section 2 + Helm   |

---

## Section 1: Helm overlay (kernel hosting)

### Helm overlay が行うこと

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

### 必要な外部サービス

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

### インストール

```bash
cd takos/paas/deploy/helm/takos
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

---

## Section 2: GCP provider plugin (Phase 17A2)

### 構成

Takosumi (`@takosumi/plugins`) の GCP provider plugin は 6 provider を提供します:

| provider client               | 用途                          | 参照クラス                            |
| ----------------------------- | ----------------------------- | ------------------------------------- |
| `gcp-control-plane`           | Cloud Run service / revision  | `src/providers/gcp/cloud_run.ts`      |
| `gcp-cloud-sql-postgres`      | Cloud SQL Postgres lifecycle  | `src/providers/gcp/cloud_sql.ts`      |
| `gcp-cloud-storage-artifacts` | GCS bucket lifecycle          | `src/providers/gcp/gcs.ts`            |
| `gcp-pubsub-control-plane`    | Pub/Sub topic + subscription  | `src/providers/gcp/pubsub.ts`         |
| `gcp-cloud-kms`               | Cloud KMS key + version       | `src/providers/gcp/kms.ts`            |
| `gcp-secret-manager`          | Secret Manager rotation       | `src/providers/gcp/secret_manager.ts` |
| `gcp-load-balancer-router`    | HTTP(S) LB + Cloud DNS        | `src/providers/gcp/load_balancer.ts`  |
| `gcp-runtime-agent-registry`  | runtime-agent enrolment store | `src/providers/gcp/gateway.ts`        |

profile JSON (`profiles/gcp.example.json`) で `clients.*` を上記 client
名に向けると Takos PaaS kernel が `provider` 契約を GCP materializer
経由で実行します。

### Operator が手動でやること / kernel が plugin 経由でやること

| step                                                                       | operator               | kernel (plugin) |
| -------------------------------------------------------------------------- | ---------------------- | --------------- |
| GCP project 作成 / billing account link                                    | yes                    | no              |
| service account JSON / Workload Identity 設定                              | yes                    | no              |
| IAM role attach (Cloud Run / Cloud SQL / Storage / Pub/Sub / KMS / Secret) | yes                    | no              |
| service account JSON または OAuth2 token を kernel に inject               | yes (operator-managed) | no              |
| Cloud SQL / GCS / Pub/Sub / KMS / Secret resource lifecycle                | no                     | yes (provider)  |
| Cloud Run service deploy / revision traffic split                          | no                     | yes (provider)  |
| HTTP(S) LB url-map + Cloud DNS record 同期                                 | no                     | yes (provider)  |
| runtime-agent enrolment + work lease                                       | yes (process deploy)   | yes (work pull) |
| drift 検出 / rollback                                                      | no                     | yes (provider)  |

### IAM role 設計

Cloud Run + Cloud SQL + GCS + Pub/Sub + KMS + Secret Manager + Cloud DNS
を扱う最小限の役割:

```bash
# kernel から呼ぶ provider 用 service account
gcloud iam service-accounts create takos-provider \
  --project=takos-prod \
  --display-name="Takos PaaS provider"

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
cd takos-private/apps/control
base64 -w0 ~/takos-provider.json | deno task secrets put GCP_SERVICE_ACCOUNT_JSON --env production
echo "takos-prod" | deno task secrets put GCP_PROJECT_ID --env production
echo "asia-northeast1" | deno task secrets put GCP_REGION --env production
```

provider plugin は base64 decode して `google-auth-library` 互換 OAuth2 token
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

### runtime-agent (Phase 17B) を GCP に置く

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
            - name: TAKOS_KERNEL_URL
              value: "https://admin.takos.example.com"
            - name: TAKOS_RUNTIME_AGENT_TOKEN
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

Cloud Run の min instance を 1 にして常駐させると lease pull が即時に
反応します。serverless で間欠的に起動する場合は heartbeat の頻度を下げ、
`heartbeatIntervalMs` を 60000 程度に伸ばします。

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
            - name: TAKOS_KERNEL_URL
              value: https://admin.takos.example.com
          envFrom:
            - secretRef: { name: takos-runtime-agent-token }
```

agent は kernel に enroll → heartbeat → lease pull → Cloud Run / Cloud SQL / GCS
/ Pub/Sub / KMS / Secret ops を実行 → 結果を report します。

### GCP LB routing (Phase 17C) の DNS 設定

`gcp-load-balancer-router` provider client は次を materialize します:

1. Backend service (tenant Cloud Run service / NEG を attach)
2. URL map / host rule (per-tenant host header matcher)
3. Target HTTPS proxy + forwarding rule (static IP)
4. Cloud DNS A record (`<tenant>.app.takos.example.com` → static IP)
5. Google-managed SSL certificate を target proxy に attach

operator がやること:

- Cloud DNS managed zone (`takos.example.com`) 作成
- static external IP 取得 (`gcloud compute addresses create takos-app --global`)
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

- Cloud Run への Takos kernel direct deploy
- Cloud Run は tenant image workload adapter として OCI orchestrator
  経由で使う対象であり、 kernel hosting surface ではない
- Firestore / Pub/Sub / Secret Manager を app resource backend として自動
  provisioning する contract (※ section 2 の provider plugin はこれを担う)
- Terraform による GCP resource 作成手順
- GCP 固有 adapter 名を deploy manifest author 向けの public surface として固定
  する contract

必要なら operator が追加 adapter / external service
を構成できますが、このページは Helm overlay と provider plugin
で実際に表現されている範囲だけを contract とします。

## 次に読むページ

- [Multi-cloud](/hosting/multi-cloud) --- 4 cloud 横断 runbook
- [Kubernetes](/hosting/kubernetes) --- base Helm chart
- [AWS](/hosting/aws) --- EKS overlay
- [Cloudflare](/hosting/cloudflare) --- Cloudflare control plane
- [環境ごとの差異](/hosting/differences) --- current hosting surface の比較
