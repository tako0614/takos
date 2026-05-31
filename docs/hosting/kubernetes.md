# Kubernetes

> このページでわかること: Takosumi kernel を Kubernetes (Helm chart)
> にホストする方法。

このページは **Takosumi kernel を Kubernetes にホストする operator**
向けです。カバー範囲は 2 通りです:

1. **base Helm chart で kernel hosting** ― `takos/deploy/helm/takos` chart
   を直接使う、または AWS / GCP overlay と組み合わせる path。
2. **k8s reference provider adapter client** ― namespace / Deployment / Service
   / Ingress / Secret / ConfigMap を takosumi.com reference implementation
   の配線として呼び出す path。Cloudflare control plane + k8s tenant runtime
   (`composite.cf-control-k8s-tenant@v1`) や k8s 単独 profile
   (`profiles/cloudflare-kubernetes.example.json`) で使う。

Takosumi 上に AppSpec を install し、Installation / Deployment を管理する方法は
[Deploy](/deploy/) を参照してください。 5 target 横断 runbook は
[Multi-cloud](/hosting/multi-cloud) を参照してください。

::: tip 対象範囲本ページは Helm chart と k8s reference provider adapter client
が提供する範囲を扱います。 :::

AWS / GCP 向けは同じ chart の Helm overlay として提供します。target ごとの
対応状況は [環境ごとの差異](/hosting/differences) を参照してください。

## 統合 distribution からこの target を選ぶ

Takos product distribution artifact は `takos/deploy/` にあり、
`takos-private/distribution.yml` は private operator が target を選ぶ instance
config です。汎用 Kubernetes を kernel host に選ぶには:

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
cd ../takosumi-cloud
deno run --config deno.json --allow-all packages/cli/src/main.ts accounts seed \
  --issuer https://accounts.k8s.example.com \
  --subject tsub_admin \
  --client-id takos-admin \
  --redirect-uri https://admin.takos.example.com/auth/oidc/callback \
  > accounts-seed-plan.json
```

`distribute:apply` は `kernel_host.target=kubernetes` を見て内部で
`helm upgrade --install takos-control deploy/helm/takos -f deploy/helm/values-k8s.yaml`
を呼び出します。

## どちらを選ぶか

| 状況                                                                | 推奨 path             |
| ------------------------------------------------------------------- | --------------------- |
| 自分の k8s クラスタに Takosumi kernel 全体を置きたい                | section 1 (Helm)      |
| Cloudflare で kernel を動かしつつ tenant workload を k8s に置きたい | section 2 (plugin)    |
| k8s 上で kernel + tenant workload を組む                            | section 1 + section 2 |

---

## Section 1: base Helm chart (kernel hosting)

### Chart components

base chart は次の workload を Kubernetes 上に作ります:

| service ID    | kind                 | default role                                         |
| ------------- | -------------------- | ---------------------------------------------------- |
| `takos-worker`   | Deployment + Service | Web UI / public API / browser and API-client gateway |
| `takosumi`    | Deployment + Service | AppSpec install / Deployment apply engine            |
| `takos-git`   | Deployment + Service | Git Smart HTTP / refs / repository storage           |
| `takos-agent` | Deployment + Service | agent execution service                              |

admin / tenant ingress はどちらも `takos-worker` に向きます。Browser / API client
は `takos-worker` を public entrypoint とし、`takos-worker` が internal service URL
(`TAKOSUMI_INTERNAL_URL` / `TAKOS_GIT_INTERNAL_URL` /
`TAKOS_AGENT_INTERNAL_URL`) で owning service を呼びます。

### Values contract

主な values:

| value                                               | 説明                                               |
| --------------------------------------------------- | -------------------------------------------------- |
| `global.imageRegistry`                              | 全 service image registry の operator override     |
| `global.imagePullSecrets`                           | private registry 用 image pull secrets             |
| `domains.admin`                                     | admin / API host                                   |
| `domains.tenantBase`                                | tenant app base host                               |
| `images.takosWorker.registry` / `repository` / `tag`   | `takos-worker` image                                  |
| `images.takosumi.registry` / `repository` / `tag`   | `takosumi` image                                   |
| `images.takosGit.registry` / `repository` / `tag`   | `takos-git` image                                  |
| `images.takosAgent.registry` / `repository` / `tag` | `takos-agent` image                                |
| `services.<service>.replicaCount`                   | service replica count                              |
| `services.<service>.port`                           | service container / ClusterIP port                 |
| `services.<service>.healthPath`                     | liveness / readiness HTTP path                     |
| `services.<service>.resources`                      | requests / limits                                  |
| `runtimeConfig.implementationBindings.*`            | reference implementation binding selection         |
| `secrets.create`                                    | chart が Secret を作るか、既存 Secret を参照するか |
| `secrets.existingSecrets.*`                         | 既存 Secret 名                                     |
| `ingress.*`                                         | admin / tenant ingress                             |
| `serviceAccount.annotations`                        | IRSA / Workload Identity などの annotation         |

### インストール

```bash
cd takos/deploy/helm/takos

helm upgrade --install takos . \
  --namespace takos-system \
  --create-namespace \
  -f values.yaml
```

private registry を使う場合は、operator overlay で次のように上書きします:

```yaml
global:
  imageRegistry: registry.example.com
  imagePullSecrets:
    - name: takos-registry

images:
  takosWorker:
    repository: takos/takos-worker
    tag: "2026.05.06"
```

AWS / GCP overlay は distribution profile から生成します:

```bash
cd takos
bun run helm:generate-overlays
bun run helm:check-overlays
```

ecosystem root workflows は Helm v3 と kind cluster を setup し、 base / AWS /
GCP values の `helm template` と `helm install --dry-run=client` を
`bun run helm:template-smoke` で検査します。CI では
`TAKOS_HELM_REQUIRE_INSTALL_DRY_RUN=1 TAKOS_HELM_INSTALL_TEST_CRDS=1`
を付けます。 test CRD は kind 上で GCP `ManagedCertificate` resource mapping
を検査するためだけに入れます。ローカルで kubeconfig がない場合、この task は
template smoke を必須とし、install dry-run は cluster unreachable として skip
します。

同じ ecosystem root workflows は kind cluster 上で
`bun run helm:install-smoke` も実行します。CI では
`TAKOS_HELM_INSTALL_TEST_CRDS=1` を付けます。この task は base / AWS / GCP
values ごとに `helm install`、`helm status`、
`helm get manifest`、`helm uninstall` を走らせ、5 service の Deployment /
Service が release manifest に載ったことを検査します。Takos product の
`Release Artifacts` workflow は artifact build 前に
`bun run helm:template-smoke` だけを走らせ、cluster install smoke は ecosystem
root workflows / operator-owned cluster evidence 側で扱います。image pull / pod
readiness は production image publish 後の rollout gate として扱います。

<!-- root `CI` / `Release Gate` workflow runs `bun run helm:template-smoke` and `bun run helm:install-smoke`; `Release Artifacts` workflow runs `bun run helm:template-smoke`; cluster install smoke は root workflows. -->

production では Secret 値を `--set` で渡す代わりに External Secrets Operator /
Sealed Secrets / platform secret manager を使い、`secrets.create: false` と
`secrets.existingSecrets.*` を設定してください。

`secrets.existingSecrets.platform` で参照する platform secret には
`PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` / `ENCRYPTION_KEY` /
`EXECUTOR_PROXY_SECRET` / `TAKOS_INTERNAL_API_SECRET` を含めてください。

### Workload runtime

この chart は Takos product services と Takosumi substrate / account-plane
services を同じ runtime stack に載せるための chart です。tenant workload /
deploy runtime の lifecycle は `takosumi` と selected provider adapter の
ownership であり、 chart 側に standalone runtime / executor / orchestrator
workload は作りません。

---

## Section 2: k8s reference provider adapter

### 構成

Takosumi reference provider package の k8s adapter は次の resource lifecycle
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
`clients.provider: "k8s-provider-gateway"` を設定すると、Takosumi kernel が k8s
API server (kubectl proxy / API gateway) 経由で resource を materialize します。

### Operator が手動でやること / reference binding が行うこと

| step                                                               | operator               | reference binding |
| ------------------------------------------------------------------ | ---------------------- | ----------------- |
| k8s cluster 作成 (EKS / GKE / AKS / on-prem)                       | yes                    | no                |
| ServiceAccount + RBAC (Role / RoleBinding) 作成                    | yes                    | no                |
| kubeconfig または Bearer token を kernel に inject                 | yes (operator-managed) | no                |
| cert-manager / Ingress controller (nginx / traefik / Istio) deploy | yes                    | no                |
| DNS zone (Route53 / Cloud DNS) 設定                                | yes                    | no                |
| namespace / Deployment / Service の lifecycle                      | no                     | yes (provider)    |
| Ingress / TLS Secret rotation                                      | no                     | yes (provider)    |
| ConfigMap / Secret 同期                                            | no                     | yes (provider)    |
| runtime-agent enrolment + work lease                               | yes (pod deploy)       | yes (work pull)   |
| drift 検出 / rollback                                              | no                     | yes (provider)    |

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
cd takos-private/src/worker
KUBE_TOKEN=$(cat /tmp/takos-provider.token)
echo "$KUBE_TOKEN" | deno task secrets put K8S_API_TOKEN --env production
echo "https://k8s-api.takos.example.com" | deno task secrets put K8S_API_SERVER --env production

# CA cert (base64)
kubectl get secret -n takos-system takos-provider-token -o json \
  | jq -r '.data["ca.crt"]' \
  | deno task secrets put K8S_API_CA_CERT --env production
```

profile (`profiles/cloudflare-kubernetes.example.json`) の
`pluginConfig.operator.takosumi.cloudflare-kubernetes.clusterName`
を合わせます。

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

### runtime-agent を k8s に置く

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
Service / Ingress / Secret / ConfigMap ops を実行→結果を report します。
in-cluster mode で実行すると ServiceAccount projected token を自動 mount
できます (`/var/run/secrets/kubernetes.io/serviceaccount/token`)。

### Ingress routing の DNS 設定

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
- profile の `pluginConfig.operator.takosumi.cloudflare-kubernetes.routerConfig`
  に `ingressClass` / `clusterIssuer` / `externalDnsZone` を設定

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
- provider 固有 adapter 名を AppSpec author 向け public surface として固定する
  contract

## 次に読むページ

- [Multi-cloud](/hosting/multi-cloud) --- 4 cloud 横断 runbook
- [AWS](/hosting/aws) --- EKS overlay
- [GCP](/hosting/gcp) --- GKE overlay
- [環境ごとの差異](/hosting/differences) --- current hosting surface の比較
