# `.takos/app.yml`

Takos の app deploy は、リポジトリ内の `.takos/app.yml` を正本 manifest として解決します。
この manifest は **multi-document YAML** 形式で、パッケージを構成するオブジェクトをそれぞれ独立して宣言します。

## フォーマット

manifest は `---` で区切られた複数の YAML ドキュメントで構成されます。各ドキュメントは 1 つのオブジェクトを定義します。

```yaml
apiVersion: takos.dev/v1alpha1
kind: Package
metadata:
  name: my-app
spec:
  version: "1.0.0"
---
apiVersion: takos.dev/v1alpha1
kind: Workload
metadata:
  name: api
spec:
  type: worker
  pluginConfig:
    config: deploy/wrangler.toml
```

すべてのオブジェクトに共通するフィールド:

| field | required | description |
| --- | --- | --- |
| `apiVersion` | yes | `takos.dev/v1alpha1` |
| `kind` | yes | オブジェクト種別 |
| `metadata.name` | yes | manifest 内で一意な名前 |
| `metadata.labels` | no | 任意のラベル |

## Object kinds

| kind | description |
| --- | --- |
| `Package` | パッケージメタデータ |
| `Resource` | プロビジョニングされるリソース (D1, R2, KV, Queue, secretRef 等) |
| `Workload` | デプロイ対象 (container, worker) |
| `Endpoint` | Workload が公開する HTTP エンドポイント |
| `Binding` | Resource → Workload のバインディング |
| `McpServer` | MCP ツールサーバーの宣言 |
| `Policy` | アクセスポリシー |
| `Rollout` | デプロイ戦略 |

## Package

パッケージ全体のメタデータを定義します。manifest に 1 つ存在します。

```yaml
apiVersion: takos.dev/v1alpha1
kind: Package
metadata:
  name: my-app
spec:
  version: "1.0.0"
  description: My application
  category: service
  tags: [api, backend]
```

| field | required | description |
| --- | --- | --- |
| `spec.version` | yes | セマンティックバージョン |
| `spec.description` | no | 説明 |
| `spec.category` | no | カテゴリ (`service`, `tool`, `library` 等) |
| `spec.tags` | no | 検索・フィルタ用タグ |
| `spec.env.required` | no | 必須環境変数リスト (下記参照) |
| `spec.takos.scopes` | no | TAKOS_ACCESS_TOKEN のスコープ |
| `spec.oauth` | no | OAuth クライアント設定 |
| `spec.capabilities` | no | 要求するプラットフォーム機能 |

### env.required と TAKOS_ACCESS_TOKEN

`env.required` に `TAKOS_ACCESS_TOKEN` を含めると、デプロイ時に Takos API を呼べる `tak_pat_` トークンが自動生成され、Workload の環境変数に注入されます。`TAKOS_API_URL` も自動で設定されます。

```yaml
spec:
  env:
    required:
      - TAKOS_ACCESS_TOKEN
  takos:
    scopes:
      - threads:read
      - runs:write
```

`takos.scopes` でトークンの権限を制限します。Workload は `TAKOS_ACCESS_TOKEN` を使って Takos API を呼べます:

```bash
curl -H "Authorization: Bearer $TAKOS_ACCESS_TOKEN" $TAKOS_API_URL/api/me
```

これは MCP 認証 (`secretRef` + `authSecretRef`) とは別の仕組みです:

| | TAKOS_ACCESS_TOKEN | secretRef + authSecretRef |
| --- | --- | --- |
| 用途 | Worker → Takos API を呼ぶ | McpClient → MCP サーバーを認証する |
| 検証者 | Takos コントロールプレーン | Worker/MCP サーバー自身 |
| トークン形式 | `tak_pat_...` | ランダム 32 バイト (base64url) |
| 管理 | `serviceManagedTakosTokens` テーブル | `mcp_servers` テーブル |

## Resource

デプロイ時にプロビジョニングされるリソースを宣言します。

### Resource types

| type | description | 固有フィールド |
| --- | --- | --- |
| `d1` | SQLite データベース | `migrations` |
| `r2` | オブジェクトストレージ | — |
| `kv` | Key-Value ストア | — |
| `queue` | メッセージキュー | `queue.maxRetries`, `queue.deadLetterQueue`, `queue.deliveryDelaySeconds` |
| `vectorize` | ベクトルインデックス | `vectorize.dimensions`, `vectorize.metric` |
| `analyticsEngine` | Analytics データセット | `analyticsEngine.dataset` |
| `workflow` | ワークフロー | `workflow.service`, `workflow.export`, `workflow.timeoutMs`, `workflow.maxRetries` |
| `durableObject` | Durable Object | `durableObject.className`, `durableObject.scriptName` |
| `secretRef` | 共有シークレット | `generate` |

### 例: データベースとストレージ

```yaml
apiVersion: takos.dev/v1alpha1
kind: Resource
metadata:
  name: main-db
spec:
  type: d1
  binding: DB
  migrations:
    up: .takos/migrations/main-db/up
    down: .takos/migrations/main-db/down
---
apiVersion: takos.dev/v1alpha1
kind: Resource
metadata:
  name: assets
spec:
  type: r2
  binding: ASSETS
```

### secretRef

`secretRef` は Workload 間で共有するシークレット値を宣言します。`generate: true` を指定すると、デプロイ時に 32 バイトのランダムトークンが自動生成されます。

```yaml
apiVersion: takos.dev/v1alpha1
kind: Resource
metadata:
  name: mcp-auth-secret
spec:
  type: secretRef
  binding: MCP_AUTH_TOKEN
  generate: true
```

生成されたトークンは:

- **Binding** 経由で Workload の環境変数に `secret_text` として注入される
- **McpServer.authSecretRef** から参照され、MCP 接続時の Bearer token として利用される

## Workload

デプロイされる実行ユニットを宣言します。

### container

```yaml
apiVersion: takos.dev/v1alpha1
kind: Workload
metadata:
  name: browser
spec:
  type: container
  pluginConfig:
    dockerfile: packages/browser-service/Dockerfile
    port: 8080
    instanceType: standard-2
    maxInstances: 25
```

| field | description |
| --- | --- |
| `pluginConfig.dockerfile` | Dockerfile パス (リポジトリルートからの相対) |
| `pluginConfig.port` | コンテナが listen するポート |
| `pluginConfig.instanceType` | インスタンスタイプ |
| `pluginConfig.maxInstances` | 最大インスタンス数 |

### worker

```yaml
apiVersion: takos.dev/v1alpha1
kind: Workload
metadata:
  name: api
spec:
  type: worker
  pluginConfig:
    config: deploy/wrangler.toml
```

worker は wrangler.toml をビルド設定として使用します。build.fromWorkflow による CI 統合もサポートします。

## Endpoint

Workload が公開する HTTP エンドポイントを宣言します。

```yaml
apiVersion: takos.dev/v1alpha1
kind: Endpoint
metadata:
  name: api-mcp
spec:
  protocol: http
  targetRef: api-host
  path: /mcp
```

| field | required | description |
| --- | --- | --- |
| `spec.protocol` | yes | `http` |
| `spec.targetRef` | yes | Workload の `metadata.name` |
| `spec.path` | no | エンドポイントパス (default: `/`) |
| `spec.timeoutMs` | no | タイムアウト (ms) |
| `spec.auth` | no | 認証要件: `none` (default), `bearer`, `takos` |

## Binding

Resource を Workload にバインドします。

```yaml
apiVersion: takos.dev/v1alpha1
kind: Binding
metadata:
  name: db-to-api
spec:
  from: main-db
  to: api
  mount:
    as: DB
    type: d1
```

| field | required | description |
| --- | --- | --- |
| `spec.from` | yes | Resource の `metadata.name` |
| `spec.to` | yes | Workload の `metadata.name` |
| `spec.mount.as` | no | バインディング名 (省略時: Resource の `spec.binding` or `metadata.name`) |
| `spec.mount.type` | no | Resource type との一致バリデーション |

`secretRef` をバインドした場合、生成されたトークンが Workload の環境変数に `secret_text` として注入されます。

## McpServer

MCP (Model Context Protocol) ツールサーバーを宣言します。デプロイ時に自動的に登録され、エージェント実行時にツールとして読み込まれます。

```yaml
apiVersion: takos.dev/v1alpha1
kind: McpServer
metadata:
  name: my-tools
spec:
  endpointRef: api-mcp
  transport: streamable-http
  authSecretRef: mcp-auth-secret
```

| field | required | description |
| --- | --- | --- |
| `spec.endpointRef` | yes | Endpoint の `metadata.name` |
| `spec.name` | no | MCP サーバー表示名 (省略時: `metadata.name`) |
| `spec.transport` | no | `streamable-http` (default) |
| `spec.authSecretRef` | no | `secretRef` Resource への参照。Bearer token 認証に使用 |

### authSecretRef による認証

`authSecretRef` を指定すると、`secretRef` で生成されたトークンが MCP 接続の Bearer token として使用されます。

1. **デプロイ時**: トークンが暗号化されて `mcp_servers` に保存される
2. **接続時**: `McpClient` が `Authorization: Bearer <token>` を送信する
3. **サーバー側**: 環境変数に注入された同じトークンと照合する

省略した場合は `takos_oidc` (内部 JWT) 認証が使用されます。

## Rollout

デプロイ戦略を宣言します。

```yaml
apiVersion: takos.dev/v1alpha1
kind: Rollout
metadata:
  name: staged-rollout
spec:
  strategy: staged
  stages:
    - weight: 10
      pauseMinutes: 5
    - weight: 50
      pauseMinutes: 10
    - weight: 100
  healthCheck:
    errorRateThreshold: 0.05
    minRequests: 100
  autoPromote: true
```

| field | description |
| --- | --- |
| `spec.strategy` | `staged` or `immediate` |
| `spec.stages` | 段階的ロールアウトのステージ |
| `spec.healthCheck` | ヘルスチェック条件 |
| `spec.autoPromote` | 自動昇格の有無 |

## support matrix

| feature | manifest | cloud | local | 備考 |
| --- | --- | --- | --- | --- |
| `d1` / `r2` / `kv` | resource / binding | ✅ | ✅ | |
| `vectorize` | resource / binding | ✅ | ❌ | local 未 materialize |
| `queue` | resource / binding / trigger | ✅ | ⚠️ | producer binding は local materialize。delivery / orchestration は backend 依存 |
| `analyticsEngine` | resource / binding | ✅ | ❌ | local 未 materialize |
| `workflow resource` | resource | ✅ | ✅ | metadata/provisioning は対応。Takos-managed runner 前提 |
| `workflow binding / invocation` | binding / invocation | ❌ | ❌ | tenant worker binding は未 materialize。local invocation も未対応 |
| `durableObject` | resource / binding | ✅ | ✅ | tenant worker が export する class を namespace binding として materialize |
| `secretRef` | resource / binding | ✅ | ✅ | `generate: true` 対応 |
| `scheduled` | trigger | ✅ | ⚠️ | delivery は backend 依存 |
| `container` | workload | ✅ | ✅ | |
| `worker` | workload | ✅ | ✅ | |
| `McpServer` | MCP 登録 | ✅ | ✅ | `authSecretRef` 対応 |
| `Policy` | — | — | — | 予約済み、v1alpha1 未対応 |
| `R2 multipart` | — | ✅ | ✅ | in-memory / persistent local adapter 対応 |
| `D1 dump` | — | ✅ | ❌ | Postgres adapter 未対応 |

## リファレンス: takos-computer

`takos-computer` は Takos 公式のブラウザ自動化・エージェント実行パッケージです。manifest の実例として全文を掲載します。

```yaml
apiVersion: takos.dev/v1alpha1
kind: Package
metadata:
  name: takos-computer
spec:
  version: "1.0.0"
  description: Browser automation and agent executor
  category: service
  tags: [browser, executor, agent, playwright]
  env:
    required: [TAKOS_ACCESS_TOKEN]
  takos:
    scopes: [threads:read, threads:write, runs:read, runs:write, repos:read]
---
apiVersion: takos.dev/v1alpha1
kind: Workload
metadata:
  name: browser
spec:
  type: container
  pluginConfig:
    dockerfile: packages/browser-service/Dockerfile
    port: 8080
    instanceType: standard-2
    maxInstances: 25
---
apiVersion: takos.dev/v1alpha1
kind: Workload
metadata:
  name: executor
spec:
  type: container
  pluginConfig:
    dockerfile: packages/executor-service/Dockerfile
    port: 8080
    instanceType: basic
    maxInstances: 100
---
apiVersion: takos.dev/v1alpha1
kind: Workload
metadata:
  name: browser-host
spec:
  type: worker
  pluginConfig:
    config: deploy/wrangler.browser-host.toml
---
apiVersion: takos.dev/v1alpha1
kind: Workload
metadata:
  name: executor-host
spec:
  type: worker
  pluginConfig:
    config: deploy/wrangler.executor-host.toml
---
apiVersion: takos.dev/v1alpha1
kind: Resource
metadata:
  name: mcp-auth-secret
spec:
  type: secretRef
  binding: MCP_AUTH_TOKEN
  generate: true
---
apiVersion: takos.dev/v1alpha1
kind: Binding
metadata:
  name: mcp-secret-to-browser
spec:
  from: mcp-auth-secret
  to: browser-host
  mount:
    as: MCP_AUTH_TOKEN
    type: secretRef
---
apiVersion: takos.dev/v1alpha1
kind: Binding
metadata:
  name: executor-control
spec:
  from: executor-host
  to: takos-control
  mount:
    as: TAKOS_CONTROL
    type: service
---
apiVersion: takos.dev/v1alpha1
kind: Endpoint
metadata:
  name: browser-mcp
spec:
  protocol: http
  targetRef: browser-host
  path: /mcp
---
apiVersion: takos.dev/v1alpha1
kind: Endpoint
metadata:
  name: executor-api
spec:
  protocol: http
  targetRef: executor-host
  path: /dispatch
---
apiVersion: takos.dev/v1alpha1
kind: McpServer
metadata:
  name: takos-computer
spec:
  endpointRef: browser-mcp
  name: takos-computer
  transport: streamable-http
  authSecretRef: mcp-auth-secret
```

このパッケージのポイント:

- 2 つのコンテナ (`browser`, `executor`) と 2 つの Worker (`browser-host`, `executor-host`) をデプロイ
- `env.required: [TAKOS_ACCESS_TOKEN]` + `takos.scopes` で Worker が Takos API を呼べるトークンを自動注入
- `secretRef` + `generate: true` で MCP 認証用のトークンを自動生成
- `Binding` で `browser-host` の環境変数に MCP 認証トークンを注入
- `McpServer` + `authSecretRef` で MCP 接続時に Bearer token 認証
- エージェントは MCP 経由で `browser_open`, `browser_goto`, `browser_action`, `browser_screenshot`, `browser_extract`, `browser_html`, `browser_close` の 7 ツールを利用可能
