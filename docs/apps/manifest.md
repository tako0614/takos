# アプリマニフェスト (`.takos/app.yml`)

`.takos/app.yml` は Takos でアプリ構成を宣言する主要な source です。
`takos deploy` は manifest を group に反映し、group 省略時は `name`
を使って自動作成します。

app の deploy/runtime contract は `.takos/app.yml` で定義する。 Takos の product
boundary は [Kernel](/architecture/kernel) を参照。

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
```

## Worker + Database

```yaml
name: notes-app
version: 0.1.0

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

storage:
  primary-db:
    type: sql
    bind: DB
    migrations: .takos/migrations/primary-db
  assets:
    type: object-store
    bind: ASSETS

routes:
  - target: web
    path: /
```

## Service

```yaml
name: my-service
version: 0.2.0

compute:
  api:
    image: ghcr.io/org/api@sha256:abc123...
    port: 8080

routes:
  - target: api
    path: /api
```

## Attached container

Worker の `containers:` で attached container を宣言する。container は worker
側に紐づく。

```yaml
name: my-app
version: 0.3.0

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:def456...
        port: 3000
```

## Worker + MCP Server (publish)

```yaml
name: notes-assistant
version: 0.3.0

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
    path: /mcp

storage:
  mcp-auth-secret:
    type: secret
    bind: MCP_AUTH_TOKEN
    generate: true

publish:
  - type: McpServer
    name: notes
    path: /mcp
    transport: streamable-http
    authSecretRef: mcp-auth-secret
```

## 構成の考え方

- `compute`: worker / container workload の定義
- `storage`: storage resource の定義
- `routes`: workload への公開ルート
- `publish`: 外部 interface の公開情報

custom domain / hostname routing はこの manifest の canonical desired state
には含めず、routing / observed surface として別 API で扱います。

## トップレベルフィールド一覧

| field | 必須 | 用途 |
| --- | --- | --- |
| `name` | yes | group 名 (slug) |
| `version` | no | display 用 version (Git tag と一致させる慣習) |
| `compute` | no | worker / service / attached-container の宣言 |
| `storage` | no | sql / object-store / key-value / queue / vector-index / secret / analytics-engine / workflow / durable-object |
| `routes` | no | path → compute mapping |
| `publish` | no | 外部 interface (McpServer / FileHandler / UiSurface 等) |
| `env` | no | top-level 環境変数 (key-value) |
| `scopes` | no | app token に含める scope のリスト (group → kernel API の権限) |
| `oauth` | no | OAuth client 設定 (third-party user に request する scope は `oauth.scopes`) |
| `overrides` | no | 環境別 partial override |

`scopes` (top-level) と `oauth.scopes` は別物:

- **top-level `scopes`**: この group が発行する **app token** に含まれる scope。group → kernel API の権限を制限する。
- **`oauth.scopes`**: この group が **OAuth client** として third-party user に request する scope。end-user の consent flow で表示される。

両者は同じ vocabulary (`files:read` / `threads:write` 等) を使うが、役割は別。

## overrides

`overrides` を使うと環境ごとに manifest の一部を上書きできます。

```yaml
overrides:
  production:
    compute:
      web:
        scaling:
          minInstances: 2
          maxInstances: 10
    env:
      LOG_LEVEL: warn
  staging:
    env:
      LOG_LEVEL: debug
```

`takos deploy --env production` で deploy すると、base manifest に `overrides.production` が deep merge されます。

## compute

`compute` は workload の定義を格納する。3 種類の workload があり、parser が field の組み合わせから `kind` を **自動判定** する:

| 判定条件 | 結果 `kind` |
|---|---|
| `build` あり | `worker` |
| `image` のみ (`build` なし) | `service` |
| 親 worker の `containers:` 内エントリ | `attached-container` |

`build` と `image` を両方指定すると parse error。

### worker

Workers runtime で動くワークロード。`build` field を持つ。

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

standalone Service workload。`image` と `port` を持つ。

```yaml
compute:
  api:
    image: ghcr.io/org/api@sha256:abc123...
    port: 8080
```

### attached container

worker に紐づく container workload。親 worker の `containers:` に定義する。

```yaml
compute:
  web:
    build: ...
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:def456...
        port: 3000
```

### depends

compute ごとに、起動・bind 順序の依存を `depends` で宣言する。 配列には **同一
group 内の compute 名 と storage 名の両方**を指定できる。

```yaml
compute:
  api:
    build: ...
    depends: [db] # storage 名
  worker:
    build: ...
    depends: [db, cache, api] # storage 名 + compute 名
```

`depends` はトップレベルには存在しない。必ず `compute.<name>.depends`
で宣言する。 deploy pipeline は依存を topological order で適用する。

### healthCheck

`healthCheck` は **Service / Attached container のみ** で利用できる。 Worker は
request-driven のため manifest で health check を宣言しない （kernel が deploy
時に simple HTTP probe で readiness を判定する）。

```yaml
compute:
  inference: # Service
    image: ghcr.io/my-org/ml-model@sha256:abc123
    port: 3000
    healthCheck:
      path: /health
      interval: 30
      timeout: 5
      unhealthyThreshold: 3

  web: # Worker + Attached container
    build: ...
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:def456
        port: 3000
        healthCheck:
          path: /health
```

| field                | required | default | 説明                              |
| -------------------- | -------- | ------- | --------------------------------- |
| `path`               | no       | /health | HTTP GET を送る path              |
| `interval`           | no       | 30      | チェック間隔（秒）                |
| `timeout`            | no       | 5       | レスポンス待ちタイムアウト（秒）  |
| `unhealthyThreshold` | no       | 3       | 連続失敗で unhealthy とみなす回数 |

### scaling

compute の scaling を設定する。

```yaml
compute:
  api:
    image: ghcr.io/my-org/api@sha256:abc123
    port: 8080
    scaling:
      minInstances: 1
      maxInstances: 10
```

| field          | required | default            | 説明             |
| -------------- | -------- | ------------------ | ---------------- |
| `minInstances` | no       | 0                  | 最小インスタンス |
| `maxInstances` | no       | provider dependent | 最大インスタンス |

### triggers

compute に対して cron schedule や queue consumer を設定する。

```yaml
compute:
  batch:
    build: ...
    triggers:
      schedules:
        - cron: "0 * * * *"
      queues:
        - storage: jobs
          batchSize: 10
          maxRetries: 3
```

## storage

storage は resource 定義を格納する。`bind:` で env 名を指定すると全 compute
に自動 bind される。

| type               | 用途                    | 追加フィールド                                 |
| ------------------ | ----------------------- | ---------------------------------------------- |
| `sql`              | SQL データベース        | `migrations`（directory path）                 |
| `object-store`     | オブジェクトストレージ  | -                                              |
| `key-value`        | Key-Value ストア        | -                                              |
| `queue`            | キュー                  | `queue.maxRetries`, `queue.deadLetterQueue`    |
| `vector-index`     | ベクトルインデックス    | `vectorIndex.dimensions`, `vectorIndex.metric` |
| `secret`           | シークレット            | `generate`                                     |
| `analytics-engine` | Analytics dataset       | -                                              |
| `workflow`         | Workflow binding        | -                                              |
| `durable-object`   | DurableObject namespace | -                                              |

```yaml
storage:
  primary-db:
    type: sql
    bind: DB
    migrations: .takos/migrations/primary-db
  uploads:
    type: object-store
    bind: UPLOADS
  cache:
    type: key-value
    bind: CACHE
  jobs:
    type: queue
    bind: JOBS
    queue:
      maxRetries: 3
      deadLetterQueue: jobs-dlq
  jobs-dlq:
    type: queue
    bind: JOBS_DLQ
  embeddings:
    type: vector-index
    bind: EMBEDDINGS
    vectorIndex:
      dimensions: 1536
      metric: cosine # cosine | euclidean | dot-product
  app-secret:
    type: secret
    bind: APP_SECRET
    generate: true
```

### migration

SQL storage の migration は forward-only。directory path を指定し、`.sql`
ファイルをファイル名順で適用する。

```yaml
storage:
  db:
    type: sql
    bind: DB
    migrations: .takos/migrations/db
```

```
.takos/migrations/db/
  0001_create_users.sql
  0002_add_email_index.sql
```

## bindings

全 storage は全 compute に自動 bind される。storage 側の `bind:` で env
名を指定する。 `bind:` を指定した場合は指定した名前がそのまま env
変数名として使われる（自動正規化なし）。 `bind:` を省略した場合は kernel が
storage 名を normalize する（ハイフン→アンダースコア、大文字化）。 例:
`jobs-dlq` → `JOBS_DLQ`, `app-secret` → `APP_SECRET`。

```yaml
storage:
  primary-db:
    type: sql
    bind: DB # 明示指定: env.DB
  uploads:
    type: object-store
    bind: UPLOADS # 明示指定: env.UPLOADS
  jobs-dlq:
    type: queue # bind 省略: storage 名 jobs-dlq → env.JOBS_DLQ
  app-secret:
    type: secret # bind 省略: storage 名 app-secret → env.APP_SECRET
    generate: true
```

compute 側に bindings を書く必要はない。全 storage が全 compute の env に inject
される。

## routes

workload への公開ルートを定義する。

```yaml
routes:
  - target: web
    path: /
  - target: api
    path: /api
    methods: [GET, POST]
    timeoutMs: 30000
```

| field       | required | 説明                |
| ----------- | -------- | ------------------- |
| `target`    | yes      | compute workload 名 |
| `path`      | yes      | 公開 path           |
| `timeoutMs` | no       | route timeout       |
| `methods`   | no       | 許可 HTTP method    |

## publish

外部に公開する interface を宣言する。`type` と `path` が必須。 すべての
publication は URL を持つため `path` が必須。残りのフィールドは `type`
に依存する。 詳しくは [App Publications](/architecture/app-publications)
を参照。

```yaml
publish:
  - type: McpServer
    path: /mcp
    name: browser
  - type: UiSurface
    path: /
    title: Files
    icon: folder
```

| field           | required | 説明                                    |
| --------------- | -------- | --------------------------------------- |
| `type`          | yes      | publication の種類 (open string)        |
| `path`          | yes      | group root からの相対 URL path          |
| `name`          | no       | publication の識別名                    |
| `transport`     | no       | transport 方式（例: `streamable-http`） |
| `authSecretRef` | no       | 認証用 secret の storage 名             |
| (any)           | no       | `type` に依存する追加 field             |

deploy 時に kernel は space 内のすべての publication をすべての group の env に
inject する （dependency declaration や scoping なし）。

## デプロイ

manifest の反映は `takos deploy` を使います。

```bash
takos deploy --env staging
```

manifest からの online deploy source は次で解決されます。

- worker: `build.fromWorkflow.artifactPath`
- container: `image` (digest pin `@sha256:...` 必須)

## Full example

```yaml
name: notes-app
version: 1.0.0

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    depends: [primary-db]
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:abc123...
        port: 3000
        healthCheck:
          path: /health
          interval: 30
          timeout: 5
          unhealthyThreshold: 3
    triggers:
      schedules:
        - cron: "0 */6 * * *"
      queues:
        - storage: jobs
          batchSize: 10
          maxRetries: 3

storage:
  primary-db:
    type: sql
    bind: DB
    migrations: .takos/migrations/primary-db
  assets:
    type: object-store
    bind: ASSETS
  cache:
    type: key-value
    bind: CACHE
  jobs:
    type: queue
    bind: JOBS
    queue:
      maxRetries: 3
      deadLetterQueue: jobs-dlq
  jobs-dlq:
    type: queue
    bind: JOBS_DLQ
  embeddings:
    type: vector-index
    bind: EMBEDDINGS
    vectorIndex:
      dimensions: 1536
      metric: cosine
  app-secret:
    type: secret
    bind: APP_SECRET
    generate: true

routes:
  - target: web
    path: /
  - target: web
    path: /mcp

publish:
  - type: McpServer
    path: /mcp
    name: notes
  - type: UiSurface
    path: /
    title: Notes
    icon: edit
```

## 関連ページ

- [Manifest Reference](/reference/manifest-spec)
- [App Publications](/architecture/app-publications)
