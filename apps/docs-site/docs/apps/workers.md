# Workers

> このページでわかること: app.yml の `workers` セクションの書き方と設定オプション。

Workers は Cloudflare Workers (V8 isolate) として実行されるサービスの定義です。Takos アプリの中核的なコンポーネントで、HTTP リクエストの処理、ルーティング、軽量な処理を担当します。

## 基本的な書き方

```yaml
workers:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
```

`web` が Worker 名です。この名前はデプロイ時のリソース名に使われます。

## build contract

Worker のビルドは `build.fromWorkflow` でワークフローの artifact を参照します。

```yaml
build:
  fromWorkflow:
    path: .takos/workflows/deploy.yml    # ワークフローのパス
    job: bundle                          # ジョブ名
    artifact: web                        # artifact 名
    artifactPath: dist/worker            # artifact 内の Worker バンドルパス
```

| field | required | 説明 |
| --- | --- | --- |
| `path` | yes | `.takos/workflows/` 配下のワークフローパス |
| `job` | yes | deploy artifact を出すジョブ名 |
| `artifact` | yes | ワークフロー artifact 名 |
| `artifactPath` | yes | artifact 内の Worker バンドルパス |

::: warning
`path` は `.takos/workflows/` 配下を指す必要があります。それ以外のパスを指定するとバリデーションエラーになります。
:::

## コンテナとの紐づけ

Worker に Docker コンテナを紐づけて、CF Containers として実行できます。

```yaml
containers:
  browser:
    dockerfile: Dockerfile
    port: 8080

workers:
  browser-host:
    containers: [browser]          # spec.containers の名前を参照
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-host
        artifact: browser-host
        artifactPath: dist/host.js
```

`containers` フィールドに `spec.containers` で定義したコンテナ名を配列で指定します。紐づけたコンテナは Durable Object として Worker から参照できます。

## バインディング

Worker が使うリソースやサービスを `bindings` で指定します。

```yaml
workers:
  web:
    build: ...
    bindings:
      d1: [primary-db]              # D1 データベース
      r2: [assets]                   # R2 バケット
      queues: [reminders]            # Queue
      vectorize: [embeddings]        # Vectorize
      services: [takos-control]      # Service binding
```

- バインディングのリスト値は `spec.resources` の名前を参照します
- 型が一致しない場合はバリデーションエラーになります
- `services` は外部の Worker service binding です

## トリガー

スケジュール実行やキュー処理のトリガーを定義できます。

```yaml
workers:
  web:
    build: ...
    triggers:
      schedules:
        - cron: "*/15 * * * *"
          export: scheduled       # Worker が export する関数名
      queues:
        - queue: reminders        # spec.resources 内の type: queue を参照
          export: queue           # Worker が export する関数名
```

キュートリガーの `queue` は `spec.resources` 内の `type: queue` リソースを参照する必要があります。

## 環境変数

Worker 固有の環境変数を設定できます。

```yaml
workers:
  web:
    build: ...
    env:
      PUBLIC_APP_NAME: My App
      NODE_ENV: production
```

アプリ全体の環境変数は `spec.env` で設定します。詳しくは [環境変数](/apps/environment) を参照してください。

## 全フィールド

| field | required | 説明 |
| --- | --- | --- |
| `build` | yes | ビルドソース。現在は `fromWorkflow` のみ |
| `containers` | no | 紐づける CF Containers（`spec.containers` の名前） |
| `bindings` | no | リソースバインディング |
| `triggers` | no | スケジュール / キュートリガー |
| `env` | no | Worker 固有の環境変数 |

## 次のステップ

- [Containers](/apps/containers) --- Docker コンテナの定義方法
- [Routes](/apps/routes) --- Worker の公開設定
- [環境変数](/apps/environment) --- テンプレート変数と値の注入
