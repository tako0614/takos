# .takos/app.yml

app.yml は「何をデプロイするか」を宣言するファイルです。
ビルド手順書ではなく、デプロイ後に何が起動し、どこで公開され、何が接続されるかを表します。

::: details 依存してよい / してはいけない範囲
**依存してよい**: single-document YAML の `kind: App` / `spec.containers` / `spec.workers` / `spec.routes` / `spec.resources` / `spec.env` / `build.fromWorkflow` / OAuth / MCP / file handler の宣言方法

**依存してはいけない**: multi-document `Package` / `Workload` / `Binding` / `build.command` や local shell を直接書く build 記法 / `container`, `http-url` など provider 寄りの target 記法
:::

## 5 分で書ける最小構成

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: my-app
spec:
  version: 0.1.0
  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: bundle
          artifact: web
          artifactPath: dist/worker
```

これだけで Worker が 1 つデプロイされます。ドメインはシステムが自動付与します。

## よくあるパターン

### Worker + Database

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: notes-app
spec:
  version: 0.1.0
  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: bundle
          artifact: web
          artifactPath: dist/worker
      bindings:
        d1: [primary-db]
        r2: [assets]
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
  routes:
    - name: app
      target: web
      path: /
```

D1 データベースと R2 バケットが自動作成され、`DB` / `ASSETS` バインディングで Worker から参照できます。

### Worker + Container

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: browser-service
spec:
  version: 1.0.0
  containers:
    browser:
      dockerfile: packages/browser-service/Dockerfile
      port: 8080
      instanceType: standard-2
      maxInstances: 25
  workers:
    browser-host:
      containers: [browser]
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build-browser-host
          artifact: browser-host
          artifactPath: dist/browser-host.js
  routes:
    - name: browser-api
      target: browser-host
      path: /session
```

`browser-host` Worker が `browser` コンテナを CF Containers として管理します。Docker が必要な処理はコンテナ側、ルーティングは Worker 側が担います。

### Worker + MCP Server

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
  routes:
    - name: mcp-endpoint
      target: web
      path: /mcp
  resources:
    mcp-auth-secret:
      type: secretRef
      binding: MCP_AUTH_TOKEN
      generate: true
  mcpServers:
    - name: notes
      route: mcp-endpoint
      transport: streamable-http
      authSecretRef: mcp-auth-secret
```

MCP server が自動公開されます。`generate: true` の secretRef を `authSecretRef` に指定すると、認証トークンが自動生成されます。

## 構成の決め方

**何で動かす?**
- CF Workers だけで済む → `workers` だけ書く
- Docker が必要 → `containers` + `workers` を書く
- Docker だけで済む → `containers` に `ipv4: true` を付けて独立稼働させる

**データを保存する?**
- はい → `resources` に `d1` / `r2` / `kv` などを追加し、Worker の `bindings` で参照

**外部に公開する?**
- はい → `routes` を追加。ドメインはシステムが自動付与するので書かない

**他のアプリから呼ばれたい?**
- MCP server として → `mcpServers` を追加
- OAuth で認証 → `oauth` を追加
- ファイルを開く → `fileHandlers` を追加

## セクション詳細

### containers

Docker コンテナの定義です。Worker に紐づけて CF Containers として実行するか、`ipv4: true` で常設コンテナとして独立稼働させます。

```yaml
containers:
  browser:
    dockerfile: packages/browser-service/Dockerfile
    port: 8080
    instanceType: standard-2
    maxInstances: 25
  my-api:
    dockerfile: Dockerfile
    port: 3000
    ipv4: true          # 専用 IPv4 を割り当てて独立稼働
```

| field | required | 説明 |
| --- | --- | --- |
| `dockerfile` | yes | Dockerfile パス |
| `port` | yes | コンテナのリッスンポート |
| `instanceType` | no | インスタンスタイプ |
| `maxInstances` | no | 最大インスタンス数 |
| `ipv4` | no | `true` で専用 IPv4 を割り当て。独立稼働する常設コンテナ向け |
| `env` | no | コンテナ環境変数 |

::: tip containers と workers の使い分け
| | containers | workers |
| --- | --- | --- |
| 実行モデル | Docker コンテナ | CF Workers (V8 isolate) |
| IPv4 割当 | `ipv4: true` で可能 | 不可 |
| ビルド | Dockerfile | workflow artifact |
| 用途 | Docker が必要な処理 | ルーティング、軽量処理 |
:::

### workers

CF Workers (V8 isolate) の定義です。`containers` フィールドで上の `spec.containers` に定義したコンテナを紐づけられます。

```yaml
workers:
  browser-host:
    containers: [browser]       # spec.containers の名前を参照
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-browser-host
        artifact: browser-host
        artifactPath: dist/browser-host.js
    bindings:
      services: [takos-control]
```

| field | required | 説明 |
| --- | --- | --- |
| `build` | yes | ビルドソース。現在は `fromWorkflow` のみ |
| `containers` | no | 紐づける CF Containers (`spec.containers` の名前) |
| `bindings` | no | リソースバインディング |
| `triggers` | no | スケジュール / キュートリガー |
| `env` | no | 環境変数 |

#### build contract

Worker のビルドは `build.fromWorkflow` で workflow artifact を参照します。

| field | required | 説明 |
| --- | --- | --- |
| `path` | yes | `.takos/workflows/` 配下の workflow path |
| `job` | yes | deploy artifact を出す job 名 |
| `artifact` | yes | workflow artifact 名 |
| `artifactPath` | yes | artifact 内の worker bundle path |

#### bindings と triggers

- binding list は `spec.resources` の名前を参照します。型が一致しない場合は validation error です。
- queue trigger の `queue` は `spec.resources` 内の `type: queue` を参照する必要があります。

### routes

Worker / container をどの path で公開するかを宣言します。ドメインは app.yml に書きません。システムが自動付与します。

```yaml
routes:
  - name: browser-api
    target: browser-host
    path: /session
  - name: executor-api
    target: executor-host
    path: /dispatch
```

| field | required | 説明 |
| --- | --- | --- |
| `name` | yes | ルート名。テンプレート変数で参照する際のキー |
| `target` | yes | 対象の worker or container 名 |
| `path` | no | 公開パス |
| `ingress` | no | ingress worker |
| `timeoutMs` | no | route timeout (ms) |

### resources

Worker / container が必要とする backing resource を宣言します。resource 名が binding の参照先になります。

```yaml
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
  mcp-auth-secret:
    type: secretRef
    binding: MCP_AUTH_TOKEN
    generate: true          # ランダムトークンを自動生成
```

| type | 追加フィールド |
| --- | --- |
| `d1` | `migrations` |
| `r2` | - |
| `kv` | - |
| `secretRef` | `generate` |
| `vectorize` | `vectorize.dimensions`, `vectorize.metric` |
| `queue` | `queue.maxRetries`, `queue.deadLetterQueue`, `queue.deliveryDelaySeconds` |
| `analyticsEngine` | `analyticsEngine.dataset` |
| `workflow` | `workflow.service`, `workflow.export`, `workflow.timeoutMs`, `workflow.maxRetries` |
| `durableObject` | `durableObject.className`, `durableObject.scriptName` |

すべての type に共通で `binding` (バインディング名) が必要です。

- `generate: true` (secretRef): デプロイ時にシステムがランダムトークンを自動生成します。
- `queue.deadLetterQueue`: 別の `type: queue` resource を参照する必要があります。
- `workflow.service`: 既存の worker 名を参照する必要があります。
- `migrations`: 文字列または `{ up, down }` のどちらでも指定できます。

### env

app 全体の環境変数を宣言します。

```yaml
env:
  required:
    - TAKOS_ACCESS_TOKEN
  inject:
    BROWSER_API_URL: "{{routes.browser-api.url}}"
    EXECUTOR_IP: "{{containers.executor.ipv4}}"
```

| field | 説明 |
| --- | --- |
| `required` | 必須環境変数のリスト。deploy 時に未設定ならエラー |
| `inject` | テンプレート変数を使ってデプロイ後の値を自動注入 |

<div v-pre>

### テンプレート変数

`inject` の値には `{{...}}` 形式のテンプレート変数を使えます。デプロイ後にシステムが実際の値に解決し、worker / container に環境変数として注入します。

| テンプレート | 解決例 | 説明 |
| --- | --- | --- |
| `{{routes.<name>.url}}` | `https://app.takos.jp/session` | ルートのフル URL |
| `{{routes.<name>.domain}}` | `app.takos.jp` | ルートのドメイン |
| `{{routes.<name>.path}}` | `/session` | ルートのパス |
| `{{containers.<name>.ipv4}}` | `203.0.113.42` | コンテナの割当 IPv4 |
| `{{containers.<name>.port}}` | `8080` | コンテナのポート |
| `{{workers.<name>.url}}` | `https://host.workers.dev` | ワーカーの URL |
| `{{resources.<name>.id}}` | `abc-123` | リソース ID |

存在しない名前を参照するとパース時に validation error になります。

</div>

### OAuth / MCP / file handlers

#### oauth

OAuth client を app と一緒に登録します。redirect URI と scope を manifest 側で管理します。

```yaml
oauth:
  clientName: Notes Assistant
  redirectUris:
    - https://notes.example.com/oauth/callback
  scopes: [openid, profile, spaces:read]
  autoEnv: true
```

詳細は [OAuth](/apps/oauth) を参照してください。

#### mcpServers

```yaml
mcpServers:
  - name: takos-computer
    route: browser-mcp          # routes の name を参照
    transport: streamable-http
    authSecretRef: mcp-auth-secret  # resources の secretRef を参照
```

| field | required | 説明 |
| --- | --- | --- |
| `name` | yes | MCP server 名 |
| `route` | yes* | 対象ルート (`endpoint` と排他) |
| `endpoint` | yes* | 対象エンドポイント (`route` と排他) |
| `transport` | yes | 現在は `streamable-http` |
| `authSecretRef` | no | 認証トークンに使う secretRef リソース名 |

#### fileHandlers

```yaml
fileHandlers:
  - name: markdown
    mimeTypes: [text/markdown]
    extensions: [.md]
    openPath: /files/:id
```

`openPath` は必須です。MIME type / 拡張子にマッチするファイルを app で開きます。

## 完全な例

実際に動いている takos-computer の app.yml です。

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: takos-computer
spec:
  version: "1.0.0"
  description: Browser automation and agent executor
  category: service
  tags: [browser, executor, agent, playwright]

  # --- Docker コンテナ ---
  # Worker に紐づけて CF Containers として実行される
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

  # --- CF Workers ---
  # containers フィールドでコンテナを紐づける
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
        services: [takos-control]

  # --- 公開ルート ---
  # ドメインはシステムが自動付与。path だけ指定する
  routes:
    - name: browser-gui
      target: browser-host
      path: /gui
    - name: browser-api
      target: browser-host
      path: /session
    - name: browser-mcp
      target: browser-host
      path: /mcp
    - name: executor-api
      target: executor-host
      path: /dispatch

  # --- backing resource ---
  resources:
    mcp-auth-secret:
      type: secretRef
      binding: MCP_AUTH_TOKEN
      generate: true            # ランダムトークンを自動生成

  # --- 環境変数 ---
  # inject のテンプレートはデプロイ後に実際の URL へ解決される
  env:
    required:
      - TAKOS_ACCESS_TOKEN
    inject:
      BROWSER_API_URL: "{{routes.browser-api.url}}"
      EXECUTOR_API_URL: "{{routes.executor-api.url}}"

  # --- Takos token scope ---
  takos:
    scopes:
      - threads:read
      - threads:write
      - runs:read
      - runs:write
      - repos:read

  # --- MCP server 公開 ---
  mcpServers:
    - name: takos-computer
      route: browser-mcp
      transport: streamable-http
      authSecretRef: mcp-auth-secret
```

## フィールドリファレンス

| field | required | 説明 |
| --- | --- | --- |
| `apiVersion` | yes | `takos.dev/v1alpha1` 固定 |
| `kind` | yes | `App` 固定 |
| `metadata.name` | yes | app の識別名 |
| `metadata.appId` | no | 既存 app identity を pin する場合に使用 |
| `spec.version` | yes | deploy 単位で表示する version |
| `spec.description` | no | app の説明 |
| `spec.category` | no | カテゴリ (`app`, `service` など) |
| `spec.tags` | no | タグ |
| `spec.containers` | no | [Docker コンテナ定義](#containers) |
| `spec.workers` | no | [CF Workers 定義](#workers) |
| `spec.routes` | no | [HTTP エンドポイント](#routes) |
| `spec.resources` | no | [backing resource](#resources) |
| `spec.env` | no | [環境変数設定](#env) |
| `spec.oauth` | no | [OAuth client 登録](#oauth) |
| `spec.takos.scopes` | no | Takos-managed token の scope |
| `spec.mcpServers` | no | [MCP server 公開設定](#mcpservers) |
| `spec.fileHandlers` | no | [file handler 登録](#filehandlers) |

::: danger 廃止
`spec.services` は廃止されました。`spec.containers` / `spec.workers` を使用してください。
:::

## 次に読むページ

- [Deploy System](/deploy/)
- [CLI / Auth model](/reference/cli-auth)
- [API リファレンス](/reference/api)
