# `.takos/app.yml`

Takos の app deploy は、repo-local な `.takos/app.yml` を正本 manifest として解決します。

## top-level contract

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: sample-app
  appId: dev.takos.sample-app
spec:
  version: 1.0.0
  services: {}
```

必須条件:

- `apiVersion` は `takos.dev/v1alpha1`
- `kind` は `App`
- `metadata.name` は必須
- `spec.version` は必須
- `spec.services` は 1 つ以上必須

## service

current contract で manifest に直接定義できる service は `worker` です。

### worker service

```yaml
services:
  gateway:
    type: worker
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build-gateway
        artifact: gateway-dist
        artifactPath: dist/gateway.mjs
    env:
      APP_MODE: production
    bindings:
      d1: [main-db]
      r2: [assets]
      kv: [cache]
      services: [payments]
```

worker service の重要ルール:

- local build field は使わず、`build.fromWorkflow` を使う
- `path` は `.takos/workflows/` 配下である必要がある
- deploy producer job は `needs`, `strategy.matrix`, `services` を使えない
- `bindings.vectorize` を使うと Vectorize index を tenant worker に渡せる

現時点の `.takos/app.yml` v1alpha1 では `http service` は public contract に含めていません。  
Takos の internal routing model には `http-url` target がありますが、manifest surface としてはまだ予約領域です。

## resources

```yaml
resources:
  main-db:
    type: d1
    binding: DB
    migrations:
      up: .takos/migrations/main-db/up
      down: .takos/migrations/main-db/down
  semantic-index:
    type: vectorize
    binding: SEARCH_INDEX
    vectorize:
      dimensions: 1536
      metric: cosine
```

利用できる resource type:

- `d1`
- `r2`
- `kv`
- `secretRef`
- `vectorize`

`vectorize` は Cloudflare Vectorize index を表します。`dimensions` と `metric` を指定できます。

## worker bindings

```yaml
services:
  api:
    type: worker
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build-api
        artifact: api-dist
        artifactPath: dist/api.mjs
    bindings:
      d1: [main-db]
      r2: [assets]
      kv: [cache]
      vectorize: [semantic-index]
      services: [search-gateway]
```

current contract で worker service に渡せる binding は次です。

- `d1`
- `r2`
- `kv`
- `vectorize`
- `services`

次は tenant worker の public contract にはまだ含めていません。

- Durable Objects
- Queues
- Browser binding
- Workers AI binding
- Hyperdrive などの Cloudflare 固有 binding

## routes

```yaml
routes:
  - name: gateway-root
    service: gateway
    path: /
  - name: payments-api
    service: payments
    path: /payments
    ingress: gateway
    timeoutMs: 30000
```

route のルール:

- `service` は既知の service を指す必要がある
- `ingress` を使う場合は worker service を指す必要がある

## mcpServers

```yaml
mcpServers:
  - name: payments
    route: payments-api
    transport: streamable-http
```

`endpoint` または `route` のどちらかは必須です。

## fileHandlers

```yaml
fileHandlers:
  - name: image-viewer
    mimeTypes: [image/png, image/jpeg]
    extensions: [.png, .jpg, .jpeg]
    openPath: /open/image
```

## optional spec fields

Takos は次のような optional field を許します。

- `description`
- `icon`
- `category`
- `tags`
- `capabilities`
- `env.required`
- `oauth`
- `takos.scopes`

これらは app の public metadata や auth behavior を補足します。
