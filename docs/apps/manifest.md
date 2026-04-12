# アプリマニフェスト (`.takos/app.yml`)

`.takos/app.yml` は Takos の app deploy contract です。現行の public surface は
top-level `publish` と `compute.<name>.consume` を中心に構成されます。

旧 `storage` / `bindings` / `common-env` / top-level `scopes` / top-level
`oauth` / `compute.<name>.capabilities` は retired です。

## 最小例

```yaml
name: my-app
version: 0.1.0

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /
```

## Provider publication を使う例

```yaml
name: notes-app

publish:
  - name: primary-db
    provider: takos
    kind: sql
    spec:
      resource: notes-db
      permission: write
  - name: takos-api
    provider: takos
    kind: api
    spec:
      scopes:
        - files:read
        - files:write

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: primary-db
        env:
          endpoint: DATABASE_URL
          apiKey: DATABASE_API_KEY
      - publication: takos-api
        env:
          endpoint: INTERNAL_TAKOS_API_URL
          apiKey: INTERNAL_TAKOS_API_KEY

routes:
  - target: web
    path: /
```

## Route publication を使う例

```yaml
publish:
  - name: browser
    type: McpServer
    path: /mcp
    transport: streamable-http

compute:
  agent:
    build: ...
    consume:
      - publication: browser
        env:
          url: BROWSER_MCP_URL
```

publication は自動注入されません。必要な consumer が明示的に `consume` します。

## トップレベルフィールド

| field       | required | 説明                  |
| ----------- | -------- | --------------------- |
| `name`      | yes      | group 名              |
| `version`   | no       | 表示用 version        |
| `compute`   | no       | workload 定義         |
| `routes`    | no       | path と target の対応 |
| `publish`   | no       | publication catalog   |
| `env`       | no       | top-level env         |
| `overrides` | no       | 環境別 override       |

## compute

`compute` は workload map です。`build` があれば worker、`image` があれば
service として解釈されます。worker の `containers` 配下は attached container
です。

### Worker

```yaml
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
```

### Service

```yaml
compute:
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 8080
```

### Attached container

```yaml
compute:
  web:
    build: ...
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
        port: 3000
```

### consume

`consume` は publication 名と optional alias map を持ちます。 alias map は
output 名 -> env 名 の対応です。必要な output だけ指定でき、 未指定の output は
publication の default env 名をそのまま使います。

```yaml
consume:
  - publication: shared-db
    env:
      endpoint: DATABASE_URL
      apiKey: DATABASE_API_KEY
```

### depends

`depends` は同一 manifest 内の compute 名だけを参照します。

```yaml
compute:
  api:
    build: ...
  jobs:
    build: ...
    depends:
      - api
```

### triggers

現行 contract で使える trigger は `schedules` だけです。

```yaml
triggers:
  schedules:
    - cron: "*/15 * * * *"
```

`triggers.queues` は retired です。

### healthCheck / readiness

- `healthCheck` は service / attached container 用
- `readiness` は worker 用の deploy readiness probe
- `readiness` の path は HTTP 200 を返す必要があります

```yaml
compute:
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 8080
    healthCheck:
      path: /health

  web:
    build: ...
    readiness: /mcp
```

## routes

```yaml
routes:
  - target: web
    path: /
  - target: api
    path: /api
    methods: [GET, POST]
    timeoutMs: 30000
```

`target` は compute 名です。

## publish

`publish` は 2 形態あります。

### route publication

```yaml
publish:
  - name: browser
    type: McpServer
    path: /mcp
    title: Browser MCP
```

route publication は `name` / `type` / `path` が必須です。`type` には
`McpServer` / `FileHandler` / `UiSurface` などを指定できます。
`path` は `/` で始まる app 内 path です。`title` は route publication 共通の
discovery metadata です。`McpServer` は `transport` / `authSecretRef`、
`FileHandler` は `mimeTypes` または `extensions`、`UiSurface` は `icon`
などの metadata を持てます。

### provider publication

```yaml
publish:
  - name: shared-db
    provider: takos
    kind: sql
    spec:
      resource: notes-db
      permission: write
```

provider publication は `name` / `provider` / `kind` / `spec` で定義します。
`consume.env` で output を任意の env 名へ alias できます。alias を書かない
output は provider default の env 名を使います。

### built-in Takos provider kinds

| kind               | spec                                                                   | outputs                              |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------ |
| `api`              | `spec.scopes`                                                          | `endpoint`, `apiKey`                 |
| `oauth-client`     | `spec.clientName`, `spec.redirectUris`, `spec.scopes`, `spec.metadata` | `clientId`, `clientSecret`, `issuer` |
| `sql`              | `spec.resource`, `spec.permission`                                     | `endpoint`, `apiKey`                 |
| `object-store`     | `spec.resource`, `spec.permission`                                     | `endpoint`, `apiKey`                 |
| `key-value`        | `spec.resource`, `spec.permission`                                     | `endpoint`, `apiKey`                 |
| `queue`            | `spec.resource`, `spec.permission`                                     | `endpoint`, `apiKey`                 |
| `vector-index`     | `spec.resource`, `spec.permission`                                     | `endpoint`, `apiKey`                 |
| `analytics-engine` | `spec.resource`, `spec.permission`                                     | `endpoint`, `apiKey`                 |

default env 名は publication 名から決まります。たとえば `shared-db` の
`endpoint` は `PUBLICATION_SHARED_DB_ENDPOINT` です。

## overrides

```yaml
overrides:
  production:
    compute:
      web:
        scaling:
          minInstances: 2
    env:
      LOG_LEVEL: warn
```

`takos deploy --env production --space SPACE_ID` で base manifest に deep merge されます。

## deploy

```bash
takos deploy --env staging --space SPACE_ID
```

manifest の online deploy source は次で解決されます。

- worker: `build.fromWorkflow.artifactPath`（省略時は `dist/worker.js`）
- service / attached container: `image`
