# Tenant Runtime

Takos の tenant runtime は、deploy された tenant artifact が実際の HTTP リクエストを処理する面です。

## canonical artifact

tenant の canonical artifact は `worker-bundle` です。

- Cloudflare: Workers backend 上で実行
- local: Workers-compatible な local adapter 上で実行

`container-image` は OCI 系 backend 用の artifact であり、tenant の canonical worker path そのものではありません。

## container runtime

deploy API では `container-image` artifact を `oci` provider で deploy できます。

- container は Docker image として pull・起動される long-running HTTP service です
- routing は dispatch が `http-endpoint-set` の `http-url` target として container endpoint に到達します
- local backend では oci-orchestrator が Docker Engine API 経由で container のライフサイクル (pull/create/start/health check/stop/remove) を管理します
- health check は `health_path` (default: `/health`) に対して polling で行われ、成功するまで deploy は完了しません
- container deploy では canary strategy は使えません。rollback は旧 image の re-deploy です

container runtime は v1 では HTTP routable な service に限定されます。service bindings / resource mounts / MCP / file handlers は次段に送られます。

## dispatch の役割

tenant request は直接 bundle に届くのではなく、dispatch を経由します。

dispatch は次を行います。

- hostname から routing target を解決する
- `service-ref` または `http-url` に request を振り分ける
- tenant request に内部ヘッダを付与する
- control plane と tenant runtime の境界を固定する

## Cloudflare backend

Cloudflare では `worker-bundle` を Workers backend に載せ、tenant runtime として実行します。

- deploy backend は Cloudflare provider
- artifact は worker-bundle
- tenant routing は dispatch と deployment routing contract に従う
- health / rollout / rollback は Cloudflare 側の backend 能力も使って成立する

## local backend

local でも tenant の canonical artifact は `worker-bundle` のままです。  
local は「Cloudflare account が無くても tenant worker contract を検証する」ための backend です。

- control plane は Node-backed
- tenant runtime は Workers-compatible adapter
- local でも `worker-bundle` を materialize して実行する
- tenant worker は URL forward ではなく local worker runtime で解決する

local で URL forward を使うのは tenant worker path ではなく、主に infra host や `http-url` target です。

## routing contract

tenant runtime が受ける target は次の 2 種類です。

- `service-ref`
- `http-url`

`service-ref` は Takos 内の service identity を指し、tenant worker の canonical path です。  
`http-url` は外部 backend や OCI 系 endpoint のための path です。

## snapshot-based execution

Takos の deployment は、実行 contract を deployment ごとの snapshot として持ちます。

- runtime config
- bindings
- env vars

この snapshot により、local と Cloudflare は同じ deployment 入力をもとに tenant runtime を再現します。

## compatibility note

Takos は local と Cloudflare で tenant contract をできるだけ揃えますが、backend は同一ではありません。  
既知の差分と制限は [互換性と制限](./compatibility-and-limitations.md) にまとめています。
