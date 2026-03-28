# `.takos/app.yml`

<!-- docs:manifest-example specs/examples/app-manifest.current.example.yml -->

::: tip Status
このページは current contract です。Takos は **single-document YAML** の `kind: App` manifest を正本として解釈します。
:::

Takos の app deploy は、repo 内の `.takos/app.yml` を読んで構成を決めます。
この manifest は「ビルド手順の自由記述」ではなく、「deploy したい app を宣言する文書」です。

## このページで依存してよい範囲

- single-document YAML の `kind: App`
- `spec.containers` / `spec.workers` / `spec.routes` / `spec.resources` の役割
- `spec.env` によるテンプレート変数注入
- `build.fromWorkflow` を使った artifact 参照 contract
- OAuth / MCP / file handler を manifest で宣言する方法

## このページで依存してはいけない範囲

- multi-document `Package` / `Workload` / `Binding`
- `build.command` や local shell を直接書く build 記法
- `container`, `http-url` など provider 寄りの target 記法
- repo に存在してもこのページに出てこない field

## implementation note

現行 parser が受け付ける manifest は、`.takos/app.yml` または `.takos/app.yaml` に置かれた single-document YAML です。
current public contract では `spec.containers` と `spec.workers` を正本とし、`build.fromWorkflow` で workflow artifact を参照します。

これは「workflow artifact を deploy 入力にする」contract であり、build shell や provider ごとの実装手順を manifest に埋め込む面ではありません。

## この manifest が宣言するもの

`.takos/app.yml` は、次の 5 つを束ねて宣言します。

1. app の identity と表示情報
2. deploy される container と worker
3. container / worker が必要とする resource と binding
4. deploy 後に公開・連携される route / MCP / OAuth / file handler
5. 環境変数の要求とテンプレート変数による注入

## 最小構成

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: notes-assistant
spec:
  version: 0.3.0
  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: bundle
          artifact: web
          artifactPath: dist/worker
```

有効な例全体は [current example](./examples/app-manifest.current.example.yml) を参照してください。

## トップレベルの見方

| field | required | 役割 |
| --- | --- | --- |
| `apiVersion` | yes | 現在は `takos.dev/v1alpha1` 固定 |
| `kind` | yes | `App` 固定 |
| `metadata.name` | yes | app の表示名 / 識別名 |
| `metadata.appId` | no | 既存 app identity を pin するときに使う |
| `spec.version` | yes | deploy 単位で表示する version |
| `spec.containers` | no | Docker コンテナ定義 |
| `spec.workers` | no | CF Workers 定義 |
| `spec.routes` | no | HTTP エンドポイント |
| `spec.resources` | no | backing resource |
| `spec.env` | no | 環境変数設定（required + inject） |
| `spec.oauth` | no | OAuth client 自動登録設定 |
| `spec.takos.scopes` | no | Takos-managed token の scope |
| `spec.mcpServers` | no | MCP server 公開設定 |
| `spec.fileHandlers` | no | file handler 登録 |

::: danger 廃止
`spec.services` は廃止されました。`spec.containers` / `spec.workers` を使用してください。`spec.services` が存在するとパースエラーになります。
:::

## `spec.containers`

`spec.containers` は Docker コンテナの定義です。container は worker に紐づけて CF Containers として実行するか、`ipv4: true` を指定して常設コンテナとして独立稼働させます。

```yaml
spec:
  containers:
    browser:
      dockerfile: packages/browser-service/Dockerfile
      port: 8080
      instanceType: standard-2
      maxInstances: 25
    my-api:
      dockerfile: Dockerfile
      port: 3000
      ipv4: true
```

| field | required | 役割 |
| --- | --- | --- |
| `dockerfile` | yes | Dockerfile パス |
| `port` | yes | コンテナのリッスンポート |
| `instanceType` | no | インスタンスタイプ |
| `maxInstances` | no | 最大インスタンス数 |
| `ipv4` | no | 専用 IPv4 を割り当てる（container のみ、worker には不可） |
| `env` | no | コンテナ環境変数 |

## `spec.workers`

`spec.workers` は CF Workers (V8 isolate) の定義です。`containers` フィールドで `spec.containers` に定義した container を紐づけることができます。

```yaml
spec:
  workers:
    browser-host:
      containers: [browser]
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build-browser-host
          artifact: browser-host
          artifactPath: dist/browser-host.js
      bindings:
        services: [takos-control]
```

| field | required | 役割 |
| --- | --- | --- |
| `build` | yes | ビルドソース（fromWorkflow） |
| `containers` | no | 紐づける CF Containers（`spec.containers` の名前） |
| `bindings` | no | リソースバインディング |
| `triggers` | no | スケジュール / キュートリガー |
| `env` | no | 環境変数 |

### build contract

`spec.workers.<name>.build.fromWorkflow` は必須です。

| field | required | 役割 |
| --- | --- | --- |
| `path` | yes | `.takos/workflows/` 配下の workflow path |
| `job` | yes | deploy artifact を出す job 名 |
| `artifact` | yes | workflow artifact 名 |
| `artifactPath` | yes | artifact 内の worker bundle path |

Takos が受け付けるのは `build.fromWorkflow` です。
現在は次を current contract に含めません。

- `build.command`
- `build.output`
- `build.cwd`
- `entry`
- local build shell を直接書く形式

### bindings と triggers

- binding list は resource 名を参照します。
- 型が一致しない binding は validation error になります。
- queue trigger の `queue` は `spec.resources` 内の `type: queue` を参照する必要があります。

## containers と workers の違い

| | containers | workers |
| --- | --- | --- |
| 実行モデル | Docker コンテナ | CF Workers (V8 isolate) |
| IPv4 | 割当可能 (`ipv4: true`) | 不可 |
| CF Containers | worker に紐づけて使用 | `containers` フィールドで参照 |
| 常設/VPS | `ipv4: true` で独立稼働 | N/A |
| ビルド | Dockerfile | workflow artifact |

## `spec.resources`

`spec.resources` は worker / container が必要とする backing capability を宣言します。
resource 名が binding の参照先になります。

```yaml
spec:
  resources:
    primary-db:
      type: d1
      binding: DB
      migrations:
        up: .takos/migrations/primary-db/up
        down: .takos/migrations/primary-db/down
    assets:
      type: r2
      binding: ASSETS
```

### サポートされる resource type

| type | fields |
| --- | --- |
| `d1` | `binding`, `migrations` |
| `r2` | `binding` |
| `kv` | `binding` |
| `secretRef` | `binding` |
| `vectorize` | `binding`, `vectorize.dimensions`, `vectorize.metric` |
| `queue` | `binding`, `queue.maxRetries`, `queue.deadLetterQueue`, `queue.deliveryDelaySeconds` |
| `analyticsEngine` | `binding`, `analyticsEngine.dataset` |
| `workflow` | `binding`, `workflow.service`, `workflow.export`, `workflow.timeoutMs`, `workflow.maxRetries` |
| `durableObject` | `binding`, `durableObject.className`, `durableObject.scriptName` |

### 追加ルール

- `queue.deadLetterQueue` は別の `type: queue` resource を参照する必要があります。
- `workflow.service` は既存 worker 名を参照する必要があります。
- `migrations` は文字列または `{ up, down }` のどちらでも指定できます。

## `spec.routes`

`spec.routes` は worker / container をどの path で公開するかを宣言します。
ドメインは app.yml に記述しません。システムが自動付与します。

```yaml
spec:
  routes:
    - name: browser-api
      target: browser-host
      path: /session
    - name: executor-api
      target: executor-host
      path: /dispatch
```

| field | required | 役割 |
| --- | --- | --- |
| `name` | yes | ルート名（テンプレート参照に使用） |
| `target` | yes | 対象の worker or container 名 |
| `path` | no | 公開パス |
| `ingress` | no | ingress worker |
| `timeoutMs` | no | route timeout |

## `spec.env`

`spec.env` は app 全体の環境変数を宣言します。`required` で必須変数を列挙し、`inject` でテンプレート変数を使ってデプロイ後の値を注入します。

```yaml
spec:
  env:
    required:
      - TAKOS_ACCESS_TOKEN
    inject:
      BROWSER_API_URL: "{{routes.browser-api.url}}"
      EXECUTOR_IP: "{{containers.executor.ipv4}}"
```

| field | 役割 |
| --- | --- |
| `required` | 必須環境変数のリスト。deploy 時に設定されていなければエラー |
| `inject` | システム変数テンプレート。デプロイ後に解決されて環境変数に注入 |

## テンプレート変数

`spec.env.inject` の値には `{{...}}` 形式のテンプレート変数を使用できます。テンプレートはデプロイ後にシステムが実際の値に解決し、対象の worker / container へ環境変数として注入します。

| テンプレート | 解決例 | 説明 |
| --- | --- | --- |
| `{{routes.<name>.url}}` | `https://app.takos.jp/session` | ルートのフル URL |
| `{{routes.<name>.domain}}` | `app.takos.jp` | ルートのドメイン |
| `{{routes.<name>.path}}` | `/session` | ルートのパス |
| `{{containers.<name>.ipv4}}` | `203.0.113.42` | コンテナの割当 IPv4 |
| `{{containers.<name>.port}}` | `8080` | コンテナのポート |
| `{{workers.<name>.url}}` | `https://host.workers.dev` | ワーカーの URL |
| `{{resources.<name>.id}}` | `abc-123` | リソース ID |

テンプレート参照はパース時に検証されます。存在しない名前を参照した場合は validation error になります。

## OAuth / MCP / file handlers

manifest は container / worker / resource だけでなく、deploy 後に公開される連携面も宣言します。

### `spec.oauth`

- OAuth client を app と一緒に登録したいときに使います。
- redirect URI と scope を manifest 側で管理します。
- 詳細な token / consent model は [OAuth](/specs/oauth) を参照してください。

### `spec.mcpServers`

```yaml
spec:
  mcpServers:
    - name: notes
      route: /mcp
      transport: streamable-http
```

- `endpoint` と `route` のどちらかが必要です。
- current transport は `streamable-http` です。

### `spec.fileHandlers`

```yaml
spec:
  fileHandlers:
    - name: markdown
      mimeTypes: [text/markdown]
      extensions: [.md]
      openPath: /files/:id
```

- `openPath` は必須です。
- MIME type / 拡張子マッチングを app 側へ結びつけます。

## 完全な例（takos-computer）

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: takos-computer
spec:
  version: "1.0.0"
  description: Browser automation and agent executor
  category: service
  tags:
    - browser
    - executor
    - agent
    - playwright

  containers:
    browser:
      dockerfile: packages/browser-service/Dockerfile
      port: 8080
      instanceType: standard-2
      maxInstances: 25
    executor:
      dockerfile: packages/executor-service/Dockerfile
      port: 8080
      instanceType: basic
      maxInstances: 100

  workers:
    browser-host:
      containers: [browser]
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build-browser-host
          artifact: browser-host
          artifactPath: dist/browser-host.js
    executor-host:
      containers: [executor]
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build-executor-host
          artifact: executor-host
          artifactPath: dist/executor-host.js
      bindings:
        services:
          - takos-control

  routes:
    - name: browser-api
      target: browser-host
      path: /session
    - name: browser-mcp
      target: browser-host
      path: /mcp
    - name: executor-api
      target: executor-host
      path: /dispatch

  resources:
    mcp-auth-secret:
      type: secretRef
      binding: MCP_AUTH_TOKEN
      generate: true

  env:
    required:
      - TAKOS_ACCESS_TOKEN
    inject:
      BROWSER_API_URL: "{{routes.browser-api.url}}"
      EXECUTOR_API_URL: "{{routes.executor-api.url}}"

  takos:
    scopes:
      - threads:read
      - threads:write
      - runs:read
      - runs:write
      - repos:read

  mcpServers:
    - name: takos-computer
      route: browser-mcp
      transport: streamable-http
      authSecretRef: mcp-auth-secret
```

## このページで覚えるべきこと

- `.takos/app.yml` は build 手順書ではなく app 宣言です。
- `spec.containers` が Docker コンテナ、`spec.workers` が CF Workers、`spec.resources` が backing capability、`spec.routes` が公開面です。
- `spec.env.inject` のテンプレート変数でデプロイ後の URL や IP を環境変数に注入できます。
- `build.fromWorkflow` は workflow artifact を deploy 入力にする current contract です。

## 次に読むページ

- [Deploy System](/specs/deploy-system)
- [CLI / Auth model](/specs/cli-and-auth)
- [API リファレンス](/reference/api)
