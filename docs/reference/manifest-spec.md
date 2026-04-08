# マニフェストリファレンス

`.takos/app.yml` の完全な spec reference です。 manifest は flat top-level
構造で group desired state を宣言します。

---

## 1. トップレベルフィールド

| field       | required | type   | 説明                     |
| ----------- | -------- | ------ | ------------------------ |
| `name`      | **yes**  | string | group 名                 |
| `compute`   | no       | object | workload 定義            |
| `storage`   | no       | object | storage resource 定義    |
| `routes`    | no       | array  | HTTP routing             |
| `publish`   | no       | array  | publication 宣言         |
| `version`   | no       | string | デプロイ表示用バージョン |
| `scopes`    | no       | array  | app token scope          |
| `env`       | no       | object | グローバル環境変数       |
| `oauth`     | no       | object | OAuth client 設定        |
| `overrides` | no       | object | 環境別 override          |

> **`depends` はトップレベルに存在しない。** depends は `compute.<name>.depends`
> でのみ使用する。
>
> **`bindings` は compute に存在しない。** storage の `bind` フィールドで全
> compute に自動注入する。

最小例:

```yaml
name: my-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
```

---

## 2. `compute`

workload 定義を格納する。フィールドの組み合わせで 3 形態に自動判定される。

| 形態              | 判定条件                     | 動作                         |
| ----------------- | ---------------------------- | ---------------------------- |
| Worker            | `build` あり                 | serverless、request-driven   |
| Service           | `image` あり（`build` なし） | always-on container          |
| Worker + Attached | `build` + `containers` あり  | worker に container が紐づく |

### 2.1 Worker (`compute.<name>` with `build`)

| field                             | required | type   | 説明                                              |
| --------------------------------- | -------- | ------ | ------------------------------------------------- |
| `build`                           | **yes**  | object | ビルド設定                                        |
| `build.fromWorkflow.path`         | **yes**  | string | workflow ファイルパス                             |
| `build.fromWorkflow.job`          | **yes**  | string | job 名                                            |
| `build.fromWorkflow.artifact`     | **yes**  | string | artifact 名                                       |
| `build.fromWorkflow.artifactPath` | **yes**  | string | artifact 内パス                                   |
| `readiness`                       | no       | string | deploy 時の readiness probe path。default: `/`    |
| `containers`                      | no       | object | attached container の map `{name: {image, port}}` |
| `triggers`                        | no       | object | schedules, queues                                 |
| `env`                             | no       | object | workload 固有 env                                 |
| `scaling`                         | no       | object | スケーリング                                      |
| `depends`                         | no       | array  | storage / compute 名の配列                        |

> Worker は request-driven のため `healthCheck` field を持たない。 Worker の
> readiness は kernel が deploy 時に simple HTTP probe で判定する （manifest
> で宣言する health check ではない）。
>
> `readiness` は deploy 時の readiness probe path を指定する（default:
> `GET /`）。 root path が 200 を返せない Worker（例: MCP-only
> endpoint）は明示的に上書きする:
>
> ```yaml
> compute:
>   web:
>     build: ...
>     readiness: / # default. Override for MCP-only workers: /mcp
> ```

```yaml
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
    triggers:
      schedules:
        - cron: "0 * * * *"
    depends: [db, cache]
```

### 2.2 Service (`compute.<name>` with `image`)

| field         | required | type   | 説明                                    |
| ------------- | -------- | ------ | --------------------------------------- |
| `image`       | **yes**  | string | digest-pinned image ref (`@sha256:...`) |
| `port`        | **yes**  | number | listen port                             |
| `dockerfile`  | no       | string | local build 用 Dockerfile path          |
| `triggers`    | no       | object | schedules のみ                          |
| `env`         | no       | object | container env                           |
| `healthCheck` | no       | object | ヘルスチェック                          |
| `volumes`     | no       | object | volume mount                            |
| `depends`     | no       | array  | storage / compute 名の配列              |

```yaml
compute:
  api:
    image: ghcr.io/org/api@sha256:abc123...
    port: 8080
    depends: [db]
```

### 2.3 Attached container (`containers` inside Worker)

Worker の `containers` map 内で定義する。トップレベル compute ではない。
attached container は routes の `target` にできない（routes は親 worker /
service を指す）。

| field          | required | type   | 説明                                    |
| -------------- | -------- | ------ | --------------------------------------- |
| `image`        | **yes**  | string | container image                         |
| `port`         | no       | number | listen port                             |
| `instanceType` | no       | string | instance profile                        |
| `maxInstances` | no       | number | 最大インスタンス数                      |
| `env`          | no       | object | container env                           |
| `volumes`      | no       | object | volume mount                            |
| `healthCheck`  | no       | object | ヘルスチェック（service と同じ schema） |

```yaml
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
        instanceType: gpu-small
        maxInstances: 5
```

---

## 3. `compute.<name>.healthCheck`

`healthCheck` は **Service / Attached container のみ**で使用できる （Worker は
request-driven のため対象外）。schema は両者で同じ。

```yaml
healthCheck:
  path: /health # default: /health
  interval: 30 # seconds, default: 30
  timeout: 5 # seconds, default: 5
  unhealthyThreshold: 3 # default: 3
```

---

## 4. `compute.<name>.scaling`

```yaml
scaling:
  minInstances: 0 # default: 0
  maxInstances: 10 # default: provider dependent
```

---

## 5. `compute.<name>.triggers`

```yaml
triggers:
  schedules:
    - cron: "0 * * * *"
  queues:
    - storage: jobs # type: queue の storage 名を参照
      batchSize: 10
      maxRetries: 3
```

queue trigger は **`storage:`** で `type: queue` の storage 名を参照する。
`queue:` や `export:` ではない。

Service の triggers は `schedules` のみ。`queues` は Worker 専用。

---

## 6. `compute.<name>.depends`

storage 名または compute 名の配列。トップレベルには存在しない。

```yaml
depends: [db, cache]
```

---

## 7. `storage`

storage resource 定義を格納する。

| field           | required | type    | 説明                                                                                                                                                        |
| --------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`          | **yes**  | string  | `sql`, `object-store`, `key-value`, `queue`, `vector-index`, `secret`, `analytics-engine`, `workflow`, `durable-object`                                     |
| `bind`          | no       | string  | 注入する env 変数名。省略時は storage 名を normalize したもの (ハイフン→アンダースコア、大文字化)。例: `jobs-dlq` → `JOBS_DLQ`, `app-secret` → `APP_SECRET` |
| `migrations`    | no       | string  | migration ディレクトリパス（`sql` のみ）                                                                                                                    |
| `queue`         | no       | object  | queue 設定（`queue` のみ）                                                                                                                                  |
| `vectorIndex`   | no       | object  | vector 設定（`vector-index` のみ）                                                                                                                          |
| `generate`      | no       | boolean | 自動生成（`secret` のみ）                                                                                                                                   |
| `workflow`      | no       | object  | workflow 設定（`workflow` のみ）                                                                                                                            |
| `durableObject` | no       | object  | DO 設定（`durable-object` のみ）                                                                                                                            |

> **`bind` は manifest 内の全 compute に自動注入される。** compute 側に
> `bindings` フィールドは存在しない。

### 7.1 storage types

**sql** -- SQLite 互換。`migrations` は `.sql`
ファイルのディレクトリを指定、forward-only。

```yaml
storage:
  db:
    type: sql
    bind: DB
    migrations: .takos/migrations/db
```

**object-store** -- S3 互換。

```yaml
storage:
  uploads:
    type: object-store
    bind: UPLOADS
```

**key-value** -- get / put / list / delete。

```yaml
storage:
  cache:
    type: key-value
    bind: CACHE
```

**queue** -- push, retry, DLQ。

| field                   | type   | 説明              |
| ----------------------- | ------ | ----------------- |
| `queue.maxRetries`      | number | 最大リトライ回数  |
| `queue.deadLetterQueue` | string | DLQ の storage 名 |

```yaml
storage:
  jobs:
    type: queue
    bind: JOBS
    queue:
      maxRetries: 3
      deadLetterQueue: jobs-dlq
  jobs-dlq:
    type: queue
    bind: JOBS_DLQ
```

**vector-index** -- upsert / query。

| field                    | type   | 説明                                            |
| ------------------------ | ------ | ----------------------------------------------- |
| `vectorIndex.dimensions` | number | ベクトル次元数                                  |
| `vectorIndex.metric`     | string | `cosine`（default）, `euclidean`, `dot-product` |

```yaml
storage:
  embeddings:
    type: vector-index
    bind: EMBEDDINGS
    vectorIndex:
      dimensions: 1536
      metric: cosine
```

**secret** -- 暗号化文字列。`generate: true` で自動生成。

```yaml
storage:
  app-secret:
    type: secret
    bind: APP_SECRET
    generate: true
```

**analytics-engine** -- AnalyticsEngine dataset。write-only sink
としてイベントを書き込む。 追加の設定 field はない。

```yaml
storage:
  events:
    type: analytics-engine
    bind: EVENTS
```

**workflow** -- Workflow binding。durable な multi-step workflow を実行する。

| field             | required | type   | 説明                                                       |
| ----------------- | -------- | ------ | ---------------------------------------------------------- |
| `workflow.class`  | **yes**  | string | workflow class 名（コード内で export されている class 名） |
| `workflow.script` | **yes**  | string | workflow を実装する worker (`compute.<name>`) の名前       |

```yaml
storage:
  flow:
    type: workflow
    bind: WORKFLOW
    workflow:
      class: MyWorkflow
      script: web
```

**durable-object** -- DurableObject
namespace。ステートフルなオブジェクトを管理する。

| field                  | required | type   | 説明                                                 |
| ---------------------- | -------- | ------ | ---------------------------------------------------- |
| `durableObject.class`  | **yes**  | string | DO class 名（コード内で export されている class 名） |
| `durableObject.script` | **yes**  | string | DO を定義する worker (`compute.<name>`) の名前       |

```yaml
storage:
  do:
    type: durable-object
    bind: DO
    durableObject:
      class: MyDurableObject
      script: web
```

---

## 8. `routes[]`

| field       | required | type   | 説明                                                             |
| ----------- | -------- | ------ | ---------------------------------------------------------------- |
| `target`    | **yes**  | string | compute 名（Worker または Service）。attached container 名は不可 |
| `path`      | **yes**  | string | URL path                                                         |
| `methods`   | no       | array  | 許可 HTTP method                                                 |
| `timeoutMs` | no       | number | route timeout (ms)                                               |

> `target` はトップレベルの compute 名のみ。attached container は単独の route
> target に ならない。container を外部から呼びたい場合は親 worker をターゲットに
> routes を書く。
>
> routes に `name` フィールドは存在しない。`ingress` フィールドも存在しない。

```yaml
routes:
  - target: web
    path: /
  - target: api
    path: /api
    methods: [GET, POST]
    timeoutMs: 30000
```

---

## 9. `publish[]`

外部に公開する interface を宣言する。 すべての publication は URL
を持つため、`type` と `path` の両方が必須。

| field           | required | type   | 説明                                                               |
| --------------- | -------- | ------ | ------------------------------------------------------------------ |
| `type`          | **yes**  | string | publication の種類（open string）                                  |
| `path`          | **yes**  | string | group root からの相対 URL path。すべての publication が URL を持つ |
| `name`          | no       | string | publication の識別名（同一 type を複数 publish する場合に使用）    |
| `transport`     | no       | string | transport 方式（例: `streamable-http`）                            |
| `authSecretRef` | no       | string | 認証用 secret の storage 名                                        |
| (any)           | no       | -      | type 固有の追加フィールド                                          |

deploy 時に kernel は manifest の `publish` を全 group の env に inject する。
inject は scope や dependency declaration なし、すべての publication がすべての
group の env に注入される。

> **`FileHandler` type には追加の必須制約がある。** `FileHandler` publication は
> `mimeTypes` または `extensions` のどちらかが **必須**（両方宣言してもよい）。
> いずれも指定されていない FileHandler は manifest parse で reject される。

```yaml
publish:
  - type: McpServer
    path: /mcp
    transport: streamable-http
  - type: UiSurface
    path: /
    title: Notes
    icon: edit
  - type: FileHandler
    path: /open
    mimeTypes: ["text/csv", "application/json"]
```

### Env injection 命名規則

publication URL は env var として inject される:

- 1 publication per type per group: `TAKOS_{GROUP}_{TYPE}_URL`
- 同 group が同 type を複数 publish する場合: `name` field 必須。
  `TAKOS_{GROUP}_{TYPE}_{NAME}_URL`
- group 名と type 名はハイフン→アンダースコア + 大文字化
- 既存の env と衝突する場合: deploy fail

例:

```yaml
# group: my-computer
publish:
  - type: McpServer
    path: /mcp
    name: browser # 同 type を 2 つ publish するので name 必須
  - type: McpServer
    path: /sandbox/mcp
    name: sandbox
```

inject される env:

```
TAKOS_MY_COMPUTER_MCPSERVER_BROWSER_URL=https://{auto-hostname}/mcp
TAKOS_MY_COMPUTER_MCPSERVER_SANDBOX_URL=https://{auto-hostname}/sandbox/mcp
```

---

## 10. `version`

デプロイ表示用バージョン文字列。semver を推奨するが enforce しない。

```yaml
version: 1.2.0
```

---

## 11. `scopes`

app token に付与する scope の配列。

```yaml
scopes:
  - files:read
  - files:write
```

---

## 12. `env`

グローバル環境変数。全 compute に適用される。compute ごとの `env` で上書き可能。

```yaml
env:
  NODE_ENV: production
  LOG_LEVEL: info
```

---

## 13. `overrides`

環境別の override。`overrides.<env-name>` の中にトップレベルと同じ構造を書く。

```yaml
overrides:
  staging:
    env:
      LOG_LEVEL: debug
  production:
    compute:
      web:
        scaling:
          maxInstances: 50
    env:
      LOG_LEVEL: warn
```

### Merge rules

overrides は deep merge で適用される:

- object: 再帰的に merge
- array: 完全に置換（merge されない）
- scalar: override 値で置換

例:

```
top-level: env: { LOG_LEVEL: info, API_URL: https://prod }
override:  env: { LOG_LEVEL: debug }
結果:      env: { LOG_LEVEL: debug, API_URL: https://prod }
```

---

## 14. `oauth`

OAuth client 設定。deploy 時に control plane が client credentials
を発行し、Worker / Container に環境変数として注入する。

| field                | required | type    | 説明                                                                               |
| -------------------- | -------- | ------- | ---------------------------------------------------------------------------------- |
| `clientName`         | **yes**  | string  | OAuth client の表示名                                                              |
| `redirectUris`       | **yes**  | array   | 許可するリダイレクト URI のリスト                                                  |
| `scopes`             | **yes**  | array   | 要求する OAuth スコープ                                                            |
| `autoEnv`            | no       | boolean | `true` で `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` を自動注入（default: `false`） |
| `metadata`           | no       | object  | ロゴ・利用規約・プライバシーポリシー等の追加メタデータ                             |
| `metadata.logoUri`   | no       | string  | 認可画面に表示するロゴ画像 URL                                                     |
| `metadata.tosUri`    | no       | string  | 利用規約ページ URL                                                                 |
| `metadata.policyUri` | no       | string  | プライバシーポリシーページ URL                                                     |

```yaml
oauth:
  clientName: My App
  redirectUris:
    - https://example.com/callback
  scopes:
    - threads:read
    - runs:write
  autoEnv: true
  metadata:
    logoUri: https://example.com/logo.png
    tosUri: https://example.com/terms
    policyUri: https://example.com/privacy
```

---

## 15. デプロイ

`takos deploy` は full deployment pipeline を通る。 ローカル manifest からの
deploy も repository URL からの deploy も同じコマンド。

- Worker: `build.fromWorkflow.artifactPath` から bundle を解決
- Service: `image` (digest pin `@sha256:...` 必須)

`dockerfile` だけでは deploy source としては不十分。必ず `image` に
digest-pinned ref を指定する。

---

## 16. 完全な例

```yaml
name: my-app
version: 1.0.0

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
        maxInstances: 5
        healthCheck:
          path: /health
          interval: 30
          timeout: 5
          unhealthyThreshold: 3
    triggers:
      schedules:
        - cron: "0 * * * *"
      queues:
        - storage: jobs
          batchSize: 10
          maxRetries: 3
    scaling:
      minInstances: 0
      maxInstances: 10
    env:
      WORKER_MODE: "true"
    depends: [db, cache, jobs]

  api:
    image: ghcr.io/org/api@sha256:abc123...
    port: 8080
    healthCheck:
      path: /healthz
    volumes:
      data: /var/data
    depends: [db]

storage:
  db:
    type: sql
    bind: DB
    migrations: .takos/migrations/db
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
      metric: cosine
  app-secret:
    type: secret
    bind: APP_SECRET
    generate: true

routes:
  - target: web
    path: /
  - target: api
    path: /api
    methods: [GET, POST]
    timeoutMs: 30000

publish:
  - type: McpServer
    path: /mcp
    transport: streamable-http
  - type: UiSurface
    path: /
    title: Notes
    icon: edit

scopes:
  - files:read
  - files:write

oauth:
  clientName: My App
  redirectUris:
    - https://my-app.example.com/callback
  scopes:
    - threads:read
    - runs:write
  autoEnv: true

env:
  NODE_ENV: production
  LOG_LEVEL: info

overrides:
  production:
    compute:
      web:
        scaling:
          maxInstances: 50
    env:
      LOG_LEVEL: warn
```
