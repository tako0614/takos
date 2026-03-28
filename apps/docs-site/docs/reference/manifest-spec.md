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
| `version` | yes | string | デプロイ単位で表示するバージョン | - |
| `description` | no | string | アプリの説明 | - |
| `category` | no | string | カテゴリ（`app`, `service` など） | - |
| `tags` | no | string[] | タグ | - |
| `capabilities` | no | string[] | 能力宣言（`mcp`, `file-handler` など） | - |
| `containers` | no | object | Docker コンテナ定義 | [Containers](/apps/containers) |
| `workers` | no | object | CF Workers 定義 | [Workers](/apps/workers) |
| `routes` | no | array | HTTP エンドポイント | [Routes](/apps/routes) |
| `resources` | no | object | backing resource | - |
| `env` | no | object | 環境変数設定 | [環境変数](/apps/environment) |
| `oauth` | no | object | OAuth client 登録 | - |
| `takos` | no | object | Takos 固有設定 | - |
| `mcpServers` | no | array | MCP Server 公開設定 | [MCP](/apps/mcp) |
| `fileHandlers` | no | array | ファイルハンドラー登録 | [File Handlers](/apps/file-handlers) |

## containers.\<name\>

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `dockerfile` | yes | string | Dockerfile パス |
| `port` | yes | number | コンテナのリッスンポート |
| `instanceType` | no | string | インスタンスタイプ（`basic`, `standard-2` など） |
| `maxInstances` | no | number | 最大インスタンス数 |
| `ipv4` | no | boolean | `true` で専用 IPv4 を割り当て |
| `env` | no | object | コンテナ環境変数 |

## workers.\<name\>

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `build` | yes | object | ビルドソース |
| `containers` | no | string[] | 紐づける CF Containers（`spec.containers` の名前） |
| `bindings` | no | object | リソースバインディング |
| `triggers` | no | object | スケジュール / キュートリガー |
| `env` | no | object | Worker 固有の環境変数 |

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
| `queues` | string[] | Queue（`spec.resources` の名前） |
| `vectorize` | string[] | Vectorize（`spec.resources` の名前） |
| `services` | string[] | 外部 Worker service binding |

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
| `target` | yes | string | 対象の Worker / Container 名 |
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
| `kv` | - | - |
| `secretRef` | `generate: boolean` | `true` でデプロイ時にランダムトークン生成 |
| `vectorize` | `vectorize.dimensions: number`, `vectorize.metric: string` | ベクトル次元数とメトリクス（`cosine` など） |
| `queue` | `queue.maxRetries: number`, `queue.deadLetterQueue: string`, `queue.deliveryDelaySeconds: number` | キュー設定 |
| `analyticsEngine` | `analyticsEngine.dataset: string` | データセット名 |
| `workflow` | `workflow.service: string`, `workflow.export: string`, `workflow.timeoutMs: number`, `workflow.maxRetries: number` | ワークフロー設定 |
| `durableObject` | `durableObject.className: string`, `durableObject.scriptName: string` | Durable Object 設定 |

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
| `autoEnv` | no | boolean | 環境変数に自動注入 |

## takos

| field | type | 説明 |
| --- | --- | --- |
| `scopes` | string[] | Takos-managed token のスコープ |

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

## 次のステップ

- [アプリ開発](/apps/) --- 各セクションの詳細ガイド
- [サンプル集](/examples/) --- コピペで始められるサンプル
- [Deploy System](/deploy/) --- デプロイの仕様詳細
