# `.takos/app.yml`

<!-- docs:manifest-example specs/examples/app-manifest.current.example.yml -->

::: tip Status
このページは current contract です。Takos は **single-document YAML** の `kind: App` manifest を正本として解釈します。
:::

Takos の app deploy は、repo 内の `.takos/app.yml` を読んで構成を決めます。
この manifest は「ビルド手順の自由記述」ではなく、「deploy したい app を宣言する文書」です。

## このページで依存してよい範囲

- single-document YAML の `kind: App`
- `spec.services` / `spec.resources` / `spec.routes` の役割
- `build.fromWorkflow` を使った artifact 参照 contract
- OAuth / MCP / file handler を manifest で宣言する方法

## このページで依存してはいけない範囲

- multi-document `Package` / `Workload` / `Binding`
- `build.command` や local shell を直接書く build 記法
- `container`, `http-url` など provider 寄りの target 記法
- repo に存在してもこのページに出てこない field

## implementation note

現行 parser が受け付ける manifest は、`.takos/app.yml` または `.takos/app.yaml` に置かれた single-document YAML です。
current public contract では `worker` service を正本とし、`build.fromWorkflow` で workflow artifact を参照します。

これは「workflow artifact を deploy 入力にする」contract であり、build shell や provider ごとの実装手順を manifest に埋め込む面ではありません。

## この manifest が宣言するもの

`.takos/app.yml` は、次の 4 つを束ねて宣言します。

1. app の identity と表示情報
2. deploy される service
3. service が必要とする resource と binding
4. deploy 後に公開・連携される route / MCP / OAuth / file handler

## 最小構成

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: notes-assistant
spec:
  version: 0.3.0
  services:
    web:
      type: worker
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
| `spec.services` | yes | deploy 対象 service map |
| `spec.resources` | no | app が必要とする backing resource |
| `spec.routes` | no | app を公開する route |
| `spec.oauth` | no | OAuth client 自動登録設定 |
| `spec.takos.scopes` | no | Takos-managed token の scope |
| `spec.mcpServers` | no | MCP server 公開設定 |
| `spec.fileHandlers` | no | file handler 登録 |

## `spec.services`

`spec.services` は「何を deploy するか」を決める中心です。
current public manifest で使える service type は `worker` のみです。

```yaml
spec:
  services:
    web:
      type: worker
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: bundle
          artifact: web
          artifactPath: dist/worker
      bindings:
        d1: [primary-db]
        r2: [assets]
      triggers:
        schedules:
          - cron: "*/15 * * * *"
            export: scheduled
```

### build contract

`spec.services.<name>.build.fromWorkflow` は必須です。

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

## `spec.resources`

`spec.resources` は service が必要とする backing capability を宣言します。
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
- `workflow.service` は既存 service 名を参照する必要があります。
- `migrations` は文字列または `{ up, down }` のどちらでも指定できます。

## `spec.routes`

`spec.routes` は service をどの path / ingress で公開するかを宣言します。

```yaml
spec:
  routes:
    - name: app
      service: web
      path: /
      timeoutMs: 30000
```

| field | required | 役割 |
| --- | --- | --- |
| `service` | yes | route の target service |
| `name` | no | route 表示名 |
| `path` | no | 公開 path |
| `ingress` | no | ingress service 名 |
| `timeoutMs` | no | route timeout |

## OAuth / MCP / file handlers

manifest は service/resource だけでなく、deploy 後に公開される連携面も宣言します。

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

## このページで覚えるべきこと

- `.takos/app.yml` は build 手順書ではなく app 宣言です。
- `spec.services` が deploy 対象、`spec.resources` が backing capability、`spec.routes` が公開面です。
- `build.fromWorkflow` は workflow artifact を deploy 入力にする current contract です。

## 次に読むページ

- [Deploy System](/specs/deploy-system)
- [CLI / Auth model](/specs/cli-and-auth)
- [API リファレンス](/reference/api)
