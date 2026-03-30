# .takos/app.yml

`.takos/app.yml` は Takos の宣言的なアプリ定義です。現在の正面入口は `takos apply` で、manifest は Cloudflare-native の syntax を使います。`takos apply` の group は省略時に `metadata.name` を使って自動作成されます。

## 最小例

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

## Worker + Database

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

## Worker + MCP Server

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: notes-assistant
spec:
  version: 0.3.0
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
  mcpServers:
    - name: notes
      route: mcp-endpoint
      transport: streamable-http
      authSecretRef: mcp-auth-secret
```

## 構成の考え方

- `workers`: Workers runtime で動くワークロード
- `services`: 常設コンテナ系ワークロード
- `containers`: Worker に紐づく CF Containers
- `resources`: Cloudflare-native resource 定義
- `routes`: workload への公開ルート
- `mcpServers`: MCP 公開設定

## resources

public spec で使う `type` は Cloudflare-native resource kind です。

| type | 用途 | 追加フィールド |
| --- | --- | --- |
| `d1` | SQL データベース contract | `migrations` |
| `r2` | オブジェクトストレージ contract | - |
| `kv` | Key-Value ストア | - |
| `queue` | キュー | `queue.maxRetries`, `queue.deadLetterQueue`, `queue.deliveryDelaySeconds` |
| `vectorize` | ベクトルインデックス contract | `vectorize.dimensions`, `vectorize.metric` |
| `analyticsEngine` | Analytics ストア contract | `analyticsEngine.dataset` |
| `secretRef` | シークレット | `generate` |
| `workflow` | ワークフロー runtime contract | `workflow.service`, `workflow.export`, `workflow.timeoutMs`, `workflow.maxRetries` |
| `durableObject` | Durable Object namespace contract | `durableObject.className`, `durableObject.scriptName` |

```yaml
resources:
  primary-db:
    type: d1
    binding: DB
  uploads:
    type: r2
    binding: UPLOADS
  app-secret:
    type: secretRef
    binding: APP_SECRET
    generate: true
```

`class` と `backing` は public spec では使いません。Cloudflare では通常そのまま D1/R2/KV/Vectorize/Workflows/DO に解決され、他 provider では translation layer が対応可能な実装に変換します。

`workflow` は manifest でも service settings API / builtin tool でも設定できます。dynamic binding でも `workflow.service` と `workflow.export` の metadata が必要です。

## bindings

workload bindings も Cloudflare-native です。

| key | 参照する resource |
| --- | --- |
| `d1` | `type: d1` |
| `r2` | `type: r2` |
| `kv` | `type: kv` |
| `queues` | `type: queue` |
| `vectorize` | `type: vectorize` |
| `analyticsEngine` | `type: analyticsEngine` |
| `workflow` | `type: workflow` |
| `durableObjects` | `type: durableObject` |
| `services` | 他 workload への service binding |

## デプロイ

manifest の反映は `takos apply` を使います。

```bash
takos apply --env staging
```

manifest からの online deploy source は次で解決されます。

- `workers.*`: `build.fromWorkflow.artifactPath`
- `services.*`: `imageRef`
- `containers.*`: `imageRef`

## 関連ページ

- [Manifest Reference](/reference/manifest-spec)
- [Workers](/apps/workers)
- [MCP Server](/apps/mcp)
