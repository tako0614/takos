# マニフェストリファレンス

> このページでわかること: app.yml の全フィールドを一覧できるリファレンス。

このページでは `.takos/app.yml` の全フィールドをテーブル形式で掲載します。各フィールドの詳しい説明は個別のガイドページを参照してください。

## トップレベル

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `apiVersion` | yes | string | `takos.dev/v1alpha1` 固定 |
| `kind` | yes | string | `App` 固定 |
| `metadata` | yes | object | メタデータ |
| `spec` | yes | object | アプリの仕様 |

## metadata

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `name` | yes | string | アプリの識別名 |
| `appId` | no | string | 既存 app identity を pin する場合に使用 |

## spec

| field | required | type | 説明 | ガイド |
| --- | --- | --- | --- | --- |
| `version` | yes | string | デプロイ単位で表示するバージョン（semver 形式） | - |
| `description` | no | string | アプリの説明 | - |
| `icon` | no | string | アプリアイコン（リポジトリ内パス or URL） | - |
| `category` | no | string | カテゴリ（`app`, `service`, `library`, `template`, `social`） | - |
| `tags` | no | string[] | タグ | - |
| `capabilities` | no | string[] | 能力宣言（`mcp`, `file-handler` など。任意の文字列を指定可能） | - |

### `spec.icon`

アプリのアイコンを指定する。以下のいずれかの形式:

- **リポジトリ内パス**: `.takos/icon.png` のようなリポジトリルートからの相対パス
- **URL**: `https://example.com/icon.png` のような外部 URL

```yaml
spec:
  icon: .takos/icon.png
```

```yaml
spec:
  icon: https://example.com/my-app-icon.svg
```

対応フォーマット: PNG、SVG、JPEG など。推奨サイズは 256x256 以上。

### `spec.category`

アプリの分類カテゴリ。有効な値:

| 値 | 説明 |
| --- | --- |
| `app` | 一般的なアプリケーション |
| `service` | バックエンドサービス |
| `library` | ライブラリ / ユーティリティ |
| `template` | テンプレート |
| `social` | ソーシャル・コミュニケーション系 |

```yaml
spec:
  category: app
```

### `spec.capabilities`

アプリが持つ能力を宣言する文字列配列。capability namespace に基づく任意の文字列を指定できる。

代表的な capability namespace:

| namespace | 説明 |
| --- | --- |
| `container` | コンテナ操作 |
| `repo` | リポジトリ操作 |
| `file` | ファイル操作 |
| `deploy` | デプロイ操作 |
| `platform` | プラットフォーム操作 |
| `runtime` | ランタイム操作 |
| `storage` | ストレージ操作 |
| `workspace.files` | ワークスペースファイル操作 |
| `workspace.env` | ワークスペース環境変数操作 |
| `workspace.skills` | スキル管理 |
| `workspace.apps` | アプリ管理 |
| `workspace.source` | ソースコード操作 |
| `memory` | メモリ操作 |
| `web` | Web アクセス |
| `artifact` | アーティファクト操作 |
| `agent` | エージェント操作 |
| `mcp` | MCP Server 連携 |
| `browser` | ブラウザ自動化 |
| `discovery` | 検索・発見 |

```yaml
spec:
  capabilities:
    - mcp
    - browser
    - web
```

capabilities はツールの権限チェックに使われる。宣言されていない capability に依存するツールはアプリから利用できない。
| `containers` | no | object | CF Containers 定義 (Worker に紐づく) | [Containers](/apps/containers) |
| `services` | no | object | 常設コンテナ定義 (VPS/独立稼働) | [Containers](/apps/containers) |
| `workers` | no | object | CF Workers 定義 | [Workers](/apps/workers) |
| `routes` | no | array | HTTP エンドポイント | [Routes](/apps/routes) |
| `resources` | no | object | backing resource | - |
| `env` | no | object | 環境変数設定 | [環境変数](/apps/environment) |
| `oauth` | no | object | OAuth client 登録 | - |
| `takos` | no | object | Takos 固有設定 | - |
| `lifecycle` | no | object | ライフサイクルフック | - |
| `update` | no | object | アップデート / ロールバック戦略 | - |
| `mcpServers` | no | array | MCP Server 公開設定 | [MCP](/apps/mcp) |
| `fileHandlers` | no | array | ファイルハンドラー登録 | [File Handlers](/apps/file-handlers) |

## containers.\<name\>

CF Containers (Worker に紐づけて使う Docker コンテナ)。

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `dockerfile` | yes | string | Dockerfile パス |
| `port` | yes | number | コンテナのリッスンポート |
| `instanceType` | no | string | インスタンスタイプ（`basic`, `standard-2` など） |
| `maxInstances` | no | number | 最大インスタンス数 |
| `env` | no | object | コンテナ環境変数 |

## services.\<name\>

常設コンテナ (VPS/独立稼働)。`ipv4: true` で専用 IPv4 を割り当てできる。

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `dockerfile` | yes | string | Dockerfile パス |
| `port` | yes | number | コンテナのリッスンポート |
| `instanceType` | no | string | インスタンスタイプ |
| `maxInstances` | no | number | 最大インスタンス数 |
| `ipv4` | no | boolean | `true` で専用 IPv4 を割り当て |
| `env` | no | object | コンテナ環境変数 |
| `healthCheck` | no | object | ヘルスチェック設定 |

## workers.\<name\>

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `build` | yes | object | ビルドソース |
| `containers` | no | string[] | 紐づける CF Containers（`spec.containers` の名前） |
| `bindings` | no | object | リソースバインディング |
| `triggers` | no | object | スケジュール / キュートリガー |
| `env` | no | object | Worker 固有の環境変数 |
| `healthCheck` | no | object | ヘルスチェック設定 |

## workers.\<name\>.build.fromWorkflow

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `path` | yes | string | `.takos/workflows/` 配下のワークフローパス |
| `job` | yes | string | deploy artifact を出すジョブ名 |
| `artifact` | yes | string | ワークフロー artifact 名 |
| `artifactPath` | yes | string | artifact 内の Worker バンドルパス |

## workers.\<name\>.bindings

| field | type | 説明 |
| --- | --- | --- |
| `d1` | string[] | D1 データベース（`spec.resources` の名前） |
| `r2` | string[] | R2 バケット（`spec.resources` の名前） |
| `kv` | string[] | KV Namespace（`spec.resources` の名前） |
| `queues` | string[] | Queue（`spec.resources` の名前） |
| `vectorize` | string[] | Vectorize（`spec.resources` の名前） |
| `analytics` | string[] | Analytics Engine（`spec.resources` の名前） |
| `workflows` | string[] | Workflows（`spec.resources` の名前） |
| `durableObjects` | string[] | Durable Objects（`spec.resources` の名前） |
| `services` | ServiceBinding[] | 外部 Worker service binding（文字列またはオブジェクト形式） |

## workers.\<name\>.triggers

| field | type | 説明 |
| --- | --- | --- |
| `schedules` | array | スケジュールトリガー |
| `schedules[].cron` | string | cron 式 |
| `schedules[].export` | string | Worker が export する関数名 |
| `queues` | array | キュートリガー |
| `queues[].queue` | string | `spec.resources` 内の `type: queue` 名 |
| `queues[].export` | string | Worker が export する関数名 |

## routes[]

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `name` | yes | string | ルート名（テンプレート変数のキー） |
| `target` | yes | string | 対象の Worker / Container / Service 名 |
| `path` | no | string | 公開パス |
| `ingress` | no | string | ingress worker |
| `timeoutMs` | no | number | ルートタイムアウト（ミリ秒） |

## resources.\<name\>

共通フィールド:

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `type` | yes | string | リソース種別 |
| `binding` | yes | string | バインディング名 |

type 別の追加フィールド:

| type | 追加フィールド | 説明 |
| --- | --- | --- |
| `d1` | `migrations` | `string` または `{ up: string, down: string }` |
| `r2` | - | - |
| `kv` | `migrations` | `string` または `{ up: string, down: string }` |
| `secretRef` | `generate: boolean` | `true` でデプロイ時にランダムトークン生成 |
| `vectorize` | `vectorize.dimensions: number`, `vectorize.metric: string` | ベクトル次元数とメトリクス |
| `queue` | `queue.maxRetries: number`, `queue.deadLetterQueue: string`, `queue.deliveryDelaySeconds: number` | キュー設定 |
| `analyticsEngine` | `analyticsEngine.dataset: string` | データセット名 |
| `workflow` | `workflow.service: string`, `workflow.export: string`, `workflow.timeoutMs: number`, `workflow.maxRetries: number` | ワークフロー設定 |
| `durableObject` | `durableObject.className: string`, `durableObject.scriptName: string` | Durable Object 設定 |

### `vectorize.metric` の有効値

| 値 | 説明 |
| --- | --- |
| `cosine` | コサイン類似度（デフォルト、推奨） |
| `euclidean` | ユークリッド距離 |
| `dot-product` | 内積 |

## env

| field | type | 説明 |
| --- | --- | --- |
| `required` | string[] | 必須環境変数のリスト |
| `inject` | object | テンプレート変数による値の注入 |

## oauth

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `clientName` | yes | string | OAuth client の表示名 |
| `redirectUris` | yes | string[] | リダイレクト URI |
| `scopes` | yes | string[] | 要求するスコープ |
| `autoEnv` | no | boolean | `true` で `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` を環境変数に自動注入 |
| `metadata` | no | object | OAuth client メタデータ |

## oauth.metadata

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `logoUri` | no | string | OAuth 認可画面に表示するロゴ画像の URL |
| `tosUri` | no | string | 利用規約ページの URL |
| `policyUri` | no | string | プライバシーポリシーページの URL |

```yaml
oauth:
  clientName: My App
  redirectUris:
    - "{{routes.api.url}}/oauth/callback"
  scopes:
    - storage:read
    - storage:write
  autoEnv: true
  metadata:
    logoUri: https://example.com/logo.png
    tosUri: https://example.com/terms
    policyUri: https://example.com/privacy
```

`autoEnv: true` にすると、デプロイ時に OAuth client ID と client secret が Worker の環境変数に自動注入される。

## takos

| field | type | 説明 |
| --- | --- | --- |
| `scopes` | string[] | Takos-managed token のスコープ |
| `minVersion` | string | Takos プラットフォームの最小バージョン要件（semver 形式） |

## mcpServers[]

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `name` | yes | string | MCP Server 名 |
| `route` | yes* | string | 対象ルート名。`endpoint` と排他 |
| `endpoint` | yes* | string | 対象エンドポイント。`route` と排他 |
| `transport` | yes | string | 現在は `streamable-http` のみ |
| `authSecretRef` | no | string | 認証トークンの `secretRef` リソース名 |

## fileHandlers[]

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `name` | yes | string | ファイルハンドラー名 |
| `mimeTypes` | yes | string[] | 対応 MIME type |
| `extensions` | yes | string[] | 対応ファイル拡張子 |
| `openPath` | yes | string | ファイルを開く際のパス（`:id` がファイル ID に置換） |

## spec.version

`spec.version` は semver (Semantic Versioning) 形式のみ受け付けます。

有効: `1.0.0`, `0.1.0`, `1.0.0-beta.1`, `1.0.0+build.123`
無効: `v1.0`, `latest`, `banana`

```yaml
spec:
  version: 1.0.0
```

## healthCheck

Worker および Service に設定できるヘルスチェック。

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `path` | yes | string | ヘルスチェック URL パス |
| `intervalSeconds` | no | number | チェック間隔（デフォルト: 30） |
| `timeoutSeconds` | no | number | タイムアウト（デフォルト: 5） |
| `unhealthyThreshold` | no | number | 失敗回数でダウン判定（デフォルト: 3） |

```yaml
workers:
  web:
    build: ...
    healthCheck:
      path: /health
      intervalSeconds: 30
      timeoutSeconds: 5
      unhealthyThreshold: 3
```

```yaml
services:
  my-api:
    dockerfile: Dockerfile
    port: 3000
    healthCheck:
      path: /healthz
      intervalSeconds: 60
```

## lifecycle

デプロイ前後に実行するライフサイクルフック。

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `preApply` | no | object | デプロイ適用前に実行 |
| `postApply` | no | object | デプロイ適用後に実行 |

### lifecycle hook オブジェクト

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `command` | yes | string | 実行するコマンド |
| `timeoutSeconds` | no | number | タイムアウト（秒） |

```yaml
lifecycle:
  preApply:
    command: pnpm run migrate
    timeoutSeconds: 120
  postApply:
    command: pnpm run seed
```

## update

デプロイ時のアップデート戦略とロールバック設定。

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `strategy` | no | string | `rolling`, `canary`, `blue-green` のいずれか |
| `canaryWeight` | no | number | canary トラフィック比率（%） |
| `healthCheck` | no | string | ヘルスチェック参照名 |
| `rollbackOnFailure` | no | boolean | 失敗時に自動ロールバック |
| `timeoutSeconds` | no | number | アップデートタイムアウト（秒） |

```yaml
update:
  strategy: canary
  canaryWeight: 10
  rollbackOnFailure: true
  timeoutSeconds: 300
```

```yaml
update:
  strategy: blue-green
  rollbackOnFailure: true
```

## takos.minVersion

Takos プラットフォームの最小バージョンを指定する。semver 形式で記述する。
指定したバージョン未満のプラットフォームではデプロイがブロックされる。

```yaml
takos:
  scopes:
    - threads:read
  minVersion: '2.0.0'
```

## service binding バージョン制約

`workers.<name>.bindings.services` は従来の文字列配列に加えて、バージョン制約付きのオブジェクト形式もサポートする。両形式を混在させることも可能。

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `name` | yes | string | バインド先 service 名 |
| `version` | no | string | semver range 制約 |

```yaml
# 文字列形式（従来互換）
bindings:
  services:
    - other-worker

# オブジェクト形式（バージョン制約付き）
bindings:
  services:
    - name: other
      version: ">=2.0.0"

# 混在
bindings:
  services:
    - simple-svc
    - name: versioned-svc
      version: "^1.0.0"
```

## 次のステップ

- [アプリ開発](/apps/) --- 各セクションの詳細ガイド
- [サンプル集](/examples/) --- コピペで始められるサンプル
- [Deploy System](/deploy/) --- デプロイの仕様詳細
