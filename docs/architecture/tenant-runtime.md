# Tenant Runtime

Tenant runtime は deploy された group の component が実際の HTTP request
を処理する execution plane。 GroupHead が指す current Deployment の
`desired.activation_envelope` と `desired.routes` から導出した route
projection に従って request を受け、 `Deployment.desired.bindings` で固定
された binding を通じて ResourceInstance / publication output を参照する。

このページでいう tenant runtime は、 user-defined group の `components`
workload を request に応じて実行する面を指す。 sandbox shell / workflow job
/ git / CLI proxy を扱う内部 service は
[takos-runtime-service](./runtime-service.md) であり、 tenant workload の
runtime contract とは別の execution plane。

## Workload artifacts

`runtime.js-worker@v1` を ref に持つ component の artifact は
`artifact.workflow-bundle@v1` 経由の `worker-bundle`。

- tracked reference Workers backend: Workers runtime 上で実行
- local / self-host: tenant worker runtime path (Workers-compatible adapter)
  上で実行
- AWS / GCP / k8s: tenant worker runtime path で実行

`runtime.oci-container@v1` を ref に持つ component の artifact は
`artifact.oci-image@v1` 経由の `container-image`。 これらも user group
workload だが、 worker bundle path とは別に OCI deployment adapter /
backend-specific adapter で materialize される。 provider 選択は
`provider-selection` policy gate と operator-only configuration で行い、
public deploy manifest には provider 名を書かない。

## Container runtime

`runtime.oci-container@v1` を ref に持つ component (旧 service / attached
container) はいずれも `container-image` artifact を持つ container-service
workload。 manifest 上は他 component と同じ `components.<name>` として
declaration し、 親子関係を持ちたい場合は `depends:` で順序 hint を渡す
(旧 `containers:` 配下の nesting は廃止)。

共通する runtime contract:

- routing は dispatch が `service-ref` または `http-url` target として到達
  する
- local backend では oci-orchestrator が Docker Engine API 経由で lifecycle
  を管理する
- tracked reference Workers backend でも current 実装では OCI deployment
  adapter を使う
- AWS / GCP / k8s では backend-specific adapter (`ecs`, `cloud-run`, `k8s`)
  に解決される。 `ecs` / `cloud-run` は tenant image workload adapter で
  あり、 Takos kernel hosting target ではない
- `artifact.oci-image@v1.config.image` は digest pin (`@sha256:...`) 必須。
  rollback は group deployment record に保存された image ref と execution
  context を再適用する
- `runtime.oci-container@v1.config.port` は listen port として明示が必要

container runtime は v1 では HTTP routable な component に限定される。

## 子 component (旧 attached container)

子 component は別 component として declaration し、 親 component から
runtime binding 経由で呼び出します。 旧 `compute.<>.containers.<sub>`
nesting は廃止されました。

```yaml
components:
  api:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
        config:
          source:
            ref: artifact.workflow-bundle@v1
            config:
              workflow: .takos/workflows/deploy.yml
              job: build-api
              artifact: api
              entry: dist/api.js
      api:
        ref: interface.http@v1
  worker:
    contracts:
      runtime:
        ref: runtime.oci-container@v1
        config:
          source:
            ref: artifact.oci-image@v1
            config:
              image: ghcr.io/example/worker-service@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
          port: 8080
      gateway:
        ref: interface.http@v1
    depends: [api]
```

親側に子 component を runtime binding として渡したい場合は `bindings[]` で
明示します。 binding 名 / handle 形式は backend 固有 (current runtime
detail であり、 provider product surface と 1 対 1 に固定された契約では
ない)。

`__TAKOS_ATTACHED_CONTAINER_${NAME}_URL` 形式の internal URL env は legacy
runtime generated であり、 public contract ではない。

## Dispatch の役割

tenant request は直接 bundle に届くのではなく、dispatch を経由する。dispatch
は GroupHead が指す current Deployment の `desired.routes` /
`desired.activation_envelope` から導出した route projection に基づいて
request を振り分ける。

dispatch は次を行う。

- hostname から group を特定する
- hostname で kernel or group に振り分ける
  - `{KERNEL_DOMAIN}` → kernel（`/api/*`, `/auth/*`, `/settings`）
  - `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}` (auto) / custom slug /
    custom domain → group の worker
- group 内では `service-ref` または `http-url` に request を振り分ける
- tenant request に内部ヘッダを付与する
- control plane と tenant runtime の境界を固定する

## Local backend

local でも Worker workload の artifact は `worker-bundle` のまま。local は
provider account なしで tenant worker contract を検証するための backend で、
tracked reference Workers backend と対比される。

- control plane は Node-backed
- tenant runtime は runtime-host worker runtime path（Workers-compatible local
  adapter）
- local でも `worker-bundle` を materialize して実行する
- image-backed workload は local OCI deployment adapter で解決する

## Backend-specific runtime backends

AWS / GCP の current hosting docs は k8s Helm overlay です。runtime topology は
operator が選ぶ backing service と adapter に依存します。

- worker workload: operator-selected worker runtime path
- image-backed workload: `ecs` / `cloud-run` / `k8s` など backend-specific
  tenant image workload adapter
- routing: Takos-managed hostname routing + backend ingress

hosting surface の contract 境界は
[Not A Current Contract](/hosting/differences#not-a-current-contract) を参照。

## Routing contract

tenant runtime が受ける target は dispatch が route projection (current
Deployment の `desired.routes` / `desired.activation_envelope` から導出)
から解決した結果。

- `service-ref` (`routeRef`): dispatch namespace 内の worker 参照。RoutingRecord
  の deployments[].routeRef と同義
- `http-url`: 外部 backend や container endpoint のための URL。RoutingRecord の
  endpoints[].target.baseUrl と同義

dispatch が canary weight の解決と path routing を行った後、tenant runtime
は単一の target を受け取る。

## Snapshot-based execution

runtime deployment は実行 contract を snapshot として持つ。これは
`Deployment.desired.activation_envelope` と `Deployment.desired.bindings` の
materialized form に相当する。

- runtime config
- bindings
- env vars

この snapshot により、local と tracked reference Workers backend は同じ runtime
deployment 入力をもとに tenant runtime を再現する。

## Compatibility

Takos は backend-neutral tenant contract を共有するが、compatible は schema /
translation parity を指し、runtime behavior や resource existence
の一致ではない。 詳細は [互換性と制限](./compatibility.md) と
[環境ごとの差異](/hosting/differences) を参照。

## Workers backend reference materialization

::: details tracked reference Workers backend の実装詳細

> このセクションは Cloudflare Workers backend に固有の materialization
> detail。Core 用語との対応は
> [Glossary § Workers backend implementation note](/reference/glossary#workers-backend-implementation-note)
> を参照。

tracked reference Workers backend では `worker-bundle` を Cloudflare Workers
runtime に載せ、tenant runtime として実行する。Cloudflare 側は tracked
reference Workers backend の materialization detail であり、PaaS Core の
canonical provider ではない。

- deploy backend は tracked reference Workers backend (Cloudflare Workers)
- worker artifact は Cloudflare Workers runtime で materialize
  (`Deployment.conditions[]` の provider operation 進捗として記録され、
  observed 側は ProviderObservation stream に落ちる)
- image-backed service / container workload は OCI deployment adapter 経由で
  Cloudflare Container DO 上にマウントする
- tenant routing は dispatch worker (`takos-dispatch`) と RoutingDO ベースの
  route projection cache に従う
- Worker deploy / readiness / routing は Workers backend 側の能力
  (dispatch namespace / Container DO / KV / DO) も使って成立する。
  image-backed workload の healthCheck は OCI deployment adapter / orchestrator
  に渡す deploy 入力として扱う
- 子 component (旧 attached container) binding は Cloudflare の
  DurableObjectNamespace-compatible namespace binding として expose される
  が、 これは current runtime detail であり、 Cloudflare product surface と
  1 対 1 に固定された契約ではない

:::
