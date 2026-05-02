# Kubernetes

このページは **Takos kernel を Kubernetes にホストする operator**
向けです。カバー範囲は 2 通りです:

1. **base Helm chart で kernel hosting** ― `takos/paas/deploy/helm/takos` chart
   を直接使う、または AWS / GCP overlay と組み合わせる path。
2. **k8s provider plugin (Phase 17A3)** ― namespace / Deployment / Service /
   Ingress / Secret / ConfigMap を Takos PaaS kernel から `provider` 契約
   として呼び出す path。Cloudflare control plane + k8s tenant runtime
   (`composite.cf-control-k8s-tenant@v1`) や k8s 単独 profile
   (`profiles/cloudflare-kubernetes.example.json`) で使う。

Takos 上で group を deploy する方法は [Deploy](/deploy/) を参照してください。 5
target 横断 runbook は [Multi-cloud](/hosting/multi-cloud) を参照してください。

::: warning current contract このページは Helm chart と Phase 17A3 の k8s
provider plugin が表現している contract だけを説明します。任意の cloud-managed
service への自動 provisioning matrix は current contract ではありません。 :::

AWS / GCP 向けの current docs はこの chart の Helm overlay です。current
contract に含まれない項目は
[Not A Current Contract](/hosting/differences#not-a-current-contract)
を参照してください。

## 統合 distribution からこの target を選ぶ

Takos kernel の deploy は target に関わらず `takos-private/distribution.yml`
を正本とします。汎用 Kubernetes を kernel host に選ぶには:

```yaml
# takos-private/distribution.yml
distribution:
  kernel_host:
    target: kubernetes
    region: on-prem
    kubeconfig: ~/.kube/config
    values_file: deploy/helm/values-k8s.yaml
```

## target-specific 設定

汎用 Kubernetes target に固有の prerequisites:

- Kubernetes cluster (EKS / GKE / AKS / on-prem / kind / k3s 何でも可)
- `kubectl` access (operator 端末から cluster API server に到達できる
  kubeconfig)
- Helm v3 CLI
- Ingress controller (nginx / traefik / Istio Gateway)
- cert-manager + ClusterIssuer (Let's Encrypt 推奨)
- external-dns (DNS 自動同期する場合)
- StorageClass (PostgreSQL / Redis / MinIO の PVC backing)
- External Secrets Operator / Sealed Secrets / 既存 Secret 連携

bundled subchart (PostgreSQL / Redis / MinIO) を使うか、external 接続を使うかは
[Values contract](#values-contract) と [External services](#external-services)
を参照してください。

## deploy 実行

5 target 共通の quick runbook です。target ごとの差は `distribution.yml` の
`kernel_host.target` だけで、`distribute:apply` が target 固有 backend (wrangler
/ Helm / docker-compose) に dispatch します:

```bash
# 共通手順 (5 target で同じ)
cd takos-private
deno task generate:keys:production --per-cloud
# distribution.yml を編集 (kernel_host.target = kubernetes)
deno task distribute:dry-run --confirm production
deno task distribute:apply --confirm production
cd ../takos/paas
deno task --cwd apps/paas bootstrap:initial -- --admin-email=admin@takos.jp
```

`distribute:apply` は `kernel_host.target=kubernetes` を見て内部で
`helm upgrade --install takos-control deploy/helm/takos -f deploy/helm/values-k8s.yaml`
を呼び出します。

## どちらを選ぶか

| 状況                                                                | 推奨 path             |
| ------------------------------------------------------------------- | --------------------- |
| 自分の k8s クラスタに Takos kernel 全体を置きたい                   | section 1 (Helm)      |
| Cloudflare で kernel を動かしつつ tenant workload を k8s に置きたい | section 2 (plugin)    |
| k8s 上で kernel + tenant workload を組む                            | section 1 + section 2 |

---

## Section 1: base Helm chart (kernel hosting)

### Chart components

base chart は次の workload を Kubernetes 上に作ります:

| component          | kind                        | default role                                   |
| ------------------ | --------------------------- | ---------------------------------------------- |
| `control-web`      | Deployment + Service        | HTTP API / control UI                          |
| `control-dispatch` | Deployment + Service        | dispatch path                                  |
| `control-worker`   | Deployment                  | queue / scheduled worker                       |
| `runtime-host`     | Deployment + Service        | tenant runtime host                            |
| `executor-host`    | Deployment + Service        | executor host                                  |
| `oci-orchestrator` | Deployment + Service + RBAC | image-backed service / container orchestration |
| `runtime`          | Deployment + Service + HPA  | agent runtime workload                         |
| `executor`         | Deployment + Service + HPA  | code execution workload                        |

base chart の optional subcharts:

| subchart           | enabled by default | 用途                         |
| ------------------ | ------------------ | ---------------------------- |
| Bitnami PostgreSQL | yes                | control plane database       |
| Bitnami Redis      | yes                | queue / coordination backend |
| Bitnami MinIO      | yes                | S3-compatible object storage |

### Values contract

主な values:

| value                                | 説明                                                      |
| ------------------------------------ | --------------------------------------------------------- |
| `domains.admin`                      | admin / API host                                          |
| `domains.tenantBase`                 | tenant app base host                                      |
| `images.control.repository` / `tag`  | control image                                             |
| `images.runtime.repository` / `tag`  | runtime image                                             |
| `images.executor.repository` / `tag` | executor image                                            |
| `externalDatabase.url`               | `postgresql.enabled: false` のときに使う DB URL           |
| `externalRedis.url`                  | `redis.enabled: false` のときに使う Redis URL             |
| `externalS3.*`                       | `minio.enabled: false` のときに使う S3-compatible storage |
| `secrets.create`                     | chart が Secret を作るか、既存 Secret を参照するか        |
| `secrets.existingSecrets.*`          | 既存 Secret 名                                            |
| `ingress.*`                          | admin / tenant ingress                                    |
| `serviceAccount.annotations`         | IRSA / Workload Identity などの annotation                |

object storage は S3-compatible env として注入されます。base chart は
`AWS_S3_GIT_OBJECTS_BUCKET`, `AWS_S3_OFFLOAD_BUCKET`,
`AWS_S3_TENANT_SOURCE_BUCKET`, `AWS_S3_WORKER_BUNDLES_BUCKET`,
`AWS_S3_TENANT_BUILDS_BUCKET` と runtime-service 互換の `S3_*` env
を生成します。

### インストール

```bash
cd takos/paas/deploy/helm/takos
helm dependency update

helm upgrade --install takos . \
  --namespace takos \
  --create-namespace \
  -f values.yaml \
  --set postgresql.auth.password="change-me" \
  --set minio.auth.rootPassword="change-me"
```

production では Secret 値を `--set` で渡す代わりに External Secrets Operator /
Sealed Secrets / platform secret manager を使い、`secrets.create: false` と
`secrets.existingSecrets.*` を設定してください。

`secrets.existingSecrets.platform` で参照する platform secret には
`PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` / `ENCRYPTION_KEY` /
`EXECUTOR_PROXY_SECRET` / `TAKOS_INTERNAL_API_SECRET` を含めてください。
`secrets.ociOrchestratorToken` を使う場合は、同じ platform secret に
`OCI_ORCHESTRATOR_TOKEN` も含めてください。

### External services

bundled PostgreSQL / Redis / MinIO を使わない場合:

```yaml
postgresql:
  enabled: false
redis:
  enabled: false
minio:
  enabled: false

externalDatabase:
  url: postgresql://user:pass@postgres.example:5432/takos
externalRedis:
  url: redis://redis.example:6379
externalS3:
  endpoint: https://s3.example.com
  region: us-east-1
  bucket: takos-tenant-source
```

`externalS3.bucket` はデフォルトで全 storage
用途に使われます。用途別に分ける場合は `gitObjectsBucket`, `offloadBucket`,
`tenantSourceBucket`, `workerBundlesBucket`, `tenantBuildsBucket` を設定します。

### Workload runtime

Worker compute は Kubernetes Deployment として直接生成されません。current chart
では `runtime-host` が tenant worker runtime を担当し、image-backed `services` /
`containers` は `oci-orchestrator` を通して扱います。

ECS / Cloud Run は tenant image workload adapter として `oci-orchestrator`
経由で接続されることがありますが、Takos kernel の hosting target
ではありません。

`oci-orchestrator` は chart 内で Deployment / Service / RBAC として作られます。
認証付きで使う場合は `secrets.ociOrchestratorToken` を設定し、chart が作る
platform secret または `secrets.existingSecrets.platform` の
`OCI_ORCHESTRATOR_TOKEN` から渡します。

---

## Section 2: k8s provider plugin (Phase 17A3)

### 構成

Takosumi (`@takosumi/plugins`) の k8s provider plugin は次の resource lifecycle
を提供します:

| provider client             | 用途                                                 | 参照クラス                                       |
| --------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `k8s-provider-gateway`      | namespace / Deployment / Service / Ingress lifecycle | `src/providers/k8s/provider.ts`                  |
| `k8s-runtime-agent-gateway` | runtime-agent enrolment store                        | `src/providers/k8s/provider.ts` (`runtimeAgent`) |
| `k8s-ingress-router`        | Ingress + cert-manager                               | `src/providers/k8s/ingress.ts`                   |
| `k8s-secret`                | Kubernetes Secret rotation                           | `src/providers/k8s/secret.ts`                    |
| `k8s-configmap`             | ConfigMap publication                                | `src/providers/k8s/configmap.ts`                 |
| `k8s-deployment`            | Deployment + replicas                                | `src/providers/k8s/deployment.ts`                |

`profiles/cloudflare-kubernetes.example.json` のように
`clients.provider: "k8s-provider-gateway"` を設定すると、Takos PaaS kernel が
k8s API server (kubectl proxy / API gateway) 経由で resource を materialize
します。

### Operator が手動でやること / kernel が plugin 経由でやること

| step                                                               | operator               | kernel (plugin) |
| ------------------------------------------------------------------ | ---------------------- | --------------- |
| k8s cluster 作成 (EKS / GKE / AKS / on-prem)                       | yes                    | no              |
| ServiceAccount + RBAC (Role / RoleBinding) 作成                    | yes                    | no              |
| kubeconfig または Bearer token を kernel に inject                 | yes (operator-managed) | no              |
| cert-manager / Ingress controller (nginx / traefik / Istio) deploy | yes                    | no              |
| DNS zone (Route53 / Cloud DNS) 設定                                | yes                    | no              |
| namespace / Deployment / Service の lifecycle                      | no                     | yes (provider)  |
| Ingress / TLS Secret rotation                                      | no                     | yes (provider)  |
| ConfigMap / Secret 同期                                            | no                     | yes (provider)  |
| runtime-agent enrolment + work lease                               | yes (pod deploy)       | yes (work pull) |
| drift 検出 / rollback                                              | no                     | yes (provider)  |

### kubeconfig / ServiceAccount 設計

provider 用 ServiceAccount + Role:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata: { name: takos-provider, namespace: takos-system }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: { name: takos-provider }
rules:
  - apiGroups: [""]
    resources: ["namespaces", "configmaps", "secrets", "services"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata: { name: takos-provider }
subjects:
  - { kind: ServiceAccount, name: takos-provider, namespace: takos-system }
roleRef:
  {
    apiGroup: rbac.authorization.k8s.io,
    kind: ClusterRole,
    name: takos-provider,
  }
```

token 取得 (k8s 1.24+ では `kubectl create token`):

```bash
kubectl create token takos-provider -n takos-system --duration=8760h \
  > /tmp/takos-provider.token
```

長期 token を避ける場合は ServiceAccount projected token + token rotator
(External Secrets Operator など) を使います。

### Credential injection 方式

#### A. Cloudflare Worker secret (Cloudflare control + k8s tenant の場合)

```bash
cd takos-private/apps/control
KUBE_TOKEN=$(cat /tmp/takos-provider.token)
echo "$KUBE_TOKEN" | deno task secrets put K8S_API_TOKEN --env production
echo "https://k8s-api.takos.example.com" | deno task secrets put K8S_API_SERVER --env production

# CA cert (base64)
kubectl get secret -n takos-system takos-provider-token -o json \
  | jq -r '.data["ca.crt"]' \
  | deno task secrets put K8S_API_CA_CERT --env production
```

profile (`profiles/cloudflare-kubernetes.example.json`) の
`pluginConfig.operator.takosumi.cloudflare-kubernetes.clusterName` を合わせます。

#### B. operator-managed gateway URL

k8s API server が internet-facing でない場合、bastion host に kubectl proxy
を立てて TLS 終端した gateway を kernel に晒す構成:

```jsonc
{
  "pluginConfig": {
    "operator.takosumi.cloudflare-kubernetes": {
      "clients": { "...": "..." },
      "clusterName": "takos-prod",
      "gatewayUrl": "https://k8s-gateway.internal.takos.example/api/",
      "gatewayToken": "operator-issued-token"
    }
  }
}
```

### runtime-agent (Phase 17B) を k8s に置く

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: takos-runtime-agent, namespace: takos-system }
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
              value: "https://admin.takos.example.com"
            - {
                name: TAKOS_RUNTIME_AGENT_TOKEN,
                valueFrom: {
                  secretKeyRef: { name: takos-agent-token, key: token },
                },
              }
          resources:
            requests: { cpu: "100m", memory: "128Mi" }
            limits: { cpu: "500m", memory: "512Mi" }
---
apiVersion: v1
kind: ServiceAccount
metadata: { name: takos-runtime-agent, namespace: takos-system }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: takos-runtime-agent, namespace: takos-tenants }
subjects:
  - { kind: ServiceAccount, name: takos-runtime-agent, namespace: takos-system }
roleRef:
  {
    apiGroup: rbac.authorization.k8s.io,
    kind: Role,
    name: takos-tenant-deployer,
  }
```

agent は kernel に enroll → heartbeat → lease pull → namespace / Deployment /
Service / Ingress / Secret / ConfigMap ops を実行 → 結果を report します。
in-cluster mode で実行すると ServiceAccount projected token を自動 mount
できます (`/var/run/secrets/kubernetes.io/serviceaccount/token`)。

### Ingress routing (Phase 17C) の DNS 設定

`k8s-ingress-router` provider client は次を materialize します:

1. Namespace per tenant
2. Deployment + Service (tenant workload)
3. Ingress (host header `<tenant>.app.takos.example.com` → service)
4. cert-manager `Certificate` resource (Let's Encrypt or operator CA)
5. external-dns annotation (Route53 / Cloud DNS / Cloudflare DNS と連動)

operator がやること:

- Ingress controller deploy (nginx / traefik / Istio Gateway)
- cert-manager + ClusterIssuer (Let's Encrypt) deploy
- external-dns + DNS provider credential 設定
- profile の `pluginConfig.operator.takosumi.cloudflare-kubernetes.routerConfig` に
  `ingressClass` / `clusterIssuer` / `externalDnsZone` を設定

kernel がやること:

- namespace / Service / Ingress 同期
- Certificate resource lifecycle (cert-manager がリフレッシュ)
- drift 検出 (Ingress rule / Certificate の actual state vs desired)

---

## chart contract に含まれないもの

- cloud ごとの app resource backend 自動 provisioning (※ AWS / GCP provider
  plugin と組み合わせると materialize 可能)
- DynamoDB / Firestore / SQS / Pub/Sub / cloud secret manager の provider matrix
- manifest の abstract resource を各 provider service に必ず materialize
  する保証
- provider 固有 adapter 名を deploy manifest author 向け public surface
  として固定する contract

## 次に読むページ

- [Multi-cloud](/hosting/multi-cloud) --- 4 cloud 横断 runbook
- [AWS](/hosting/aws) --- EKS overlay
- [GCP](/hosting/gcp) --- GKE overlay
- [環境ごとの差異](/hosting/differences) --- current hosting surface の比較
