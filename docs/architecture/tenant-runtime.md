# Tenant Runtime

Tenant runtime は deploy された group の workload が実際の HTTP request
を処理する execution plane。

このページでいう tenant runtime は、user-defined group の `compute` workload を
request に応じて実行する面を指す。sandbox shell / workflow job / git / CLI proxy
を扱う内部 service は [takos-runtime-service](./runtime-service.md)
であり、tenant workload の runtime contract とは別の execution plane。

## Workload artifacts

Worker workload の artifact は `worker-bundle`。

- Cloudflare: Workers backend 上で実行
- local / self-host: tenant worker runtime path（Workers-compatible
  adapter）上で実行
- AWS / GCP / k8s: tenant worker runtime path で実行

image-backed Service / Attached Container の artifact は `container-image`。
これらも user group workload だが、Worker の `worker-bundle` path とは別に OCI
deployment adapter / backend-specific adapter で materialize される。backend /
adapter の選択は operator-only configuration で、public deploy manifest
には書かない。

## Container runtime

`compute.<name>` の `kind="service"` (image-only) と
`compute.<name>.containers.<sub>` の `kind="attached-container"` はどちらも
`container-image` artifact を持つ container-service workload だが、group deploy
scope での役割が異なる。

- service (`compute.<name>` with `image`): top-level compute の long-running
  HTTP service
- attached container (`compute.<name>.containers.<sub>`): worker に紐づく
  attached container workload

共通する runtime contract:

- routing は dispatch が `service-ref` または `http-url` target として到達する
- local backend では oci-orchestrator が Docker Engine API 経由で lifecycle
  を管理する
- Cloudflare backend でも current 実装では OCI deployment adapter を使う
- AWS / GCP / k8s では backend-specific adapter (`ecs`, `cloud-run`, `k8s`)
  に解決される
- `image` は digest pin (`@sha256:...`) 必須。rollback は group snapshot
  に保存された image ref と execution context を再適用する
- Service / Attached Container は listen port を推測しないため、manifest の
  `port` が必須

container runtime は v1 では HTTP routable な service に限定される。

## Attached containers

`containers` は worker に紐づく image-backed workload。manifest 上は
`compute.<name>.containers` で参照する。

```yaml
compute:
  api:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-api
        artifact: api
        artifactPath: dist/api.js
    containers:
      worker:
        image: ghcr.io/example/worker-service@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
        port: 8080
```

worker 側には attached container binding が注入される。binding 名は child 名を
uppercase に正規化した `${NAME}_CONTAINER` になる。たとえば `worker` は
`env.WORKER_CONTAINER` で参照する。DurableObjectNamespace-compatible な
namespace binding として expose されるが、これは current runtime detail で
あり、Cloudflare product surface と 1 対 1 に固定された契約ではない。

`__TAKOS_ATTACHED_CONTAINER_${NAME}_URL` 形式の internal URL env は runtime
generated であり、public contract ではない。

## Dispatch の役割

tenant request は直接 bundle に届くのではなく、dispatch を経由する。

dispatch は次を行う。

- hostname から group を特定する
- hostname で kernel or group に振り分ける
  - `{KERNEL_DOMAIN}` → kernel（`/api/*`, `/auth/*`, `/settings`）
  - `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}` (auto) / custom slug /
    custom domain → group の worker
- group 内では `service-ref` または `http-url` に request を振り分ける
- tenant request に内部ヘッダを付与する
- control plane と tenant runtime の境界を固定する

## Cloudflare backend

Cloudflare では `worker-bundle` を Workers backend に載せ、tenant runtime
として実行する。

- deploy backend は Cloudflare backend
- worker artifact は Cloudflare Workers backend で materialize
- image-backed service / container workload は OCI deployment adapter 経由
- tenant routing は dispatch と deployment routing contract に従う
- Worker deploy / readiness / routing は Cloudflare backend 側の backend
  能力も使って成立する。image-backed workload の healthCheck は OCI deployment
  adapter / orchestrator に渡す deploy 入力として扱う

## Local backend

local でも Worker workload の artifact は `worker-bundle` のまま。local は
Cloudflare account なしで tenant worker contract を検証するための backend。

- control plane は Node-backed
- tenant runtime は runtime-host worker runtime path（Workers-compatible local
  adapter）
- local でも `worker-bundle` を materialize して実行する
- image-backed workload は local OCI deployment adapter で解決する

## Backend-specific runtime backends

AWS / GCP / k8s では public spec は変わらないが、runtime topology は
backend-specific になる。

- worker workload: operator-selected worker runtime path
- image-backed workload: `ecs` / `cloud-run` / `k8s` など backend-specific
  container service
- routing: Takos-managed hostname routing + backend ingress

## Routing contract

tenant runtime が受ける target は dispatch が RoutingRecord から解決した結果。

- `service-ref` (`routeRef`): dispatch namespace 内の worker 参照。RoutingRecord
  の deployments[].routeRef と同義
- `http-url`: 外部 backend や container endpoint のための URL。RoutingRecord の
  endpoints[].target.baseUrl と同義

dispatch が canary weight の解決と path routing を行った後、tenant runtime
は単一の target を受け取る。

## Snapshot-based execution

runtime deployment は実行 contract を snapshot として持つ。

- runtime config
- bindings
- env vars

この snapshot により、local と Cloudflare は同じ runtime deployment 入力をもとに
tenant runtime を再現する。

## Compatibility

Takos は backend-neutral tenant contract を共有するが、backend
は同一ではない。詳細は [互換性と制限](./compatibility.md) を参照。
