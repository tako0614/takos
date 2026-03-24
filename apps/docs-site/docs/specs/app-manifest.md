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

service には 2 種類あります。

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

### http service

```yaml
services:
  payments:
    type: http
    baseUrl: https://payments.internal.example
```

http service は Takos の外や別 backend への接続先を表します。

## resources

```yaml
resources:
  main-db:
    type: d1
    binding: DB
    migrations:
      up: .takos/migrations/main-db/up
      down: .takos/migrations/main-db/down
```

利用できる resource type:

- `d1`
- `r2`
- `kv`
- `secretRef`

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
- http service を route に出す場合は `ingress` が必須
- `ingress` は worker service を指す必要がある

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
