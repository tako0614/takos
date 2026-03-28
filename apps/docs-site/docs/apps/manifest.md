# .takos/app.yml

app.yml は「何をデプロイするか」を宣言するファイル。デプロイ後に何が起動し、どこで公開され、何が接続されるかを書く。

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

これだけで Worker が 1 つデプロイされる。ドメインはシステムが自動付与。

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

### Worker + MCP Server

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: notes-assistant
spec:
  version: 0.3.0
  icon: assets/icon.png
  capabilities: [mcp]
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
  oauth:
    clientName: Notes Assistant
    redirectUris: [https://example.com/callback]
    scopes: [threads:read]
    autoEnv: true
    metadata:
      logoUri: https://example.com/logo.png
      tosUri: https://example.com/terms
      policyUri: https://example.com/privacy
  mcpServers:
    - name: notes
      route: mcp-endpoint
      transport: streamable-http
      authSecretRef: mcp-auth-secret
```

## spec のトップレベルフィールド

### icon

アプリのアイコン画像。リポジトリ内の画像パス（`assets/icon.png`）または外部 URL（`https://example.com/icon.png`）を指定できる。

```yaml
spec:
  icon: assets/icon.png
```

### capabilities

アプリが持つ能力を宣言する。システムが機能検出に使う。

```yaml
spec:
  capabilities: [mcp, file-handler]
```

型定義上は `string[]` で任意の値を指定可能。よく使われる値:

| 値 | 意味 |
| --- | --- |
| `mcp` | MCP Server を提供する |
| `file-handler` | ファイルハンドラーを提供する |

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

## セクション早見表

| セクション | 一言 | 詳細 |
| --- | --- | --- |
| `containers` | Docker コンテナの定義 | [Containers](/apps/containers) |
| `workers` | CF Workers の定義 | [Workers](/apps/workers) |
| `routes` | HTTP エンドポイントの公開 | [Routes](/apps/routes) |
| `resources` | DB, Storage, Queue 等のリソース | 下記 |
| `env` | 環境変数とテンプレート変数 | [環境変数](/apps/environment) |
| `oauth` | OAuth client 登録 | [OAuth](/apps/oauth) |
| `mcpServers` | MCP Server 公開 | [MCP Server](/apps/mcp) |
| `fileHandlers` | ファイルハンドラー登録 | [File Handlers](/apps/file-handlers) |

### resources

Worker / Container が必要とする backing resource を宣言する。resource 名が binding の参照先になる。

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
    generate: true
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

すべての type に共通で `binding`(バインディング名)が必要。

## 完全な例

実際に動いている takos-computer の app.yml。

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
        services: [takos-control]

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

## 次に読むページ

- [Deploy System](/deploy/)
- [CLI / Auth model](/reference/cli-auth)
- [API リファレンス](/reference/api)
