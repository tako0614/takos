# Workers

CF Workers (V8 isolate) を定義する。HTTP リクエスト処理、ルーティング、軽量処理を担当する Takos アプリの中核。

## 基本

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

## コンテナとの紐づけ

```yaml
workers:
  browser-host:
    containers: [browser]       # spec.containers の名前を参照
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-host
        artifact: browser-host
        artifactPath: dist/host.js
```

## バインディング

```yaml
workers:
  web:
    build: ...
    bindings:
      d1: [primary-db]
      r2: [assets]
      queues: [reminders]
      vectorize: [embeddings]
      services: [takos-control]
```

`spec.resources` の名前を参照する。型が一致しないとバリデーションエラー。

## トリガー

```yaml
workers:
  web:
    build: ...
    triggers:
      schedules:
        - cron: "*/15 * * * *"
          export: scheduled
      queues:
        - queue: reminders        # spec.resources の type: queue を参照
          export: queue
```

## Worker 固有の環境変数

```yaml
workers:
  web:
    build: ...
    env:
      PUBLIC_APP_NAME: My App
      NODE_ENV: production
```

アプリ全体の環境変数は `spec.env` で設定する。詳しくは [環境変数](/apps/environment) を参照。

## フィールド

| field | required | 説明 |
| --- | --- | --- |
| `build` | yes | ビルドソース。現在は `fromWorkflow` のみ |
| `containers` | no | 紐づける CF Containers (`spec.containers` の名前) |
| `bindings` | no | リソースバインディング |
| `triggers` | no | スケジュール / キュートリガー |
| `env` | no | Worker 固有の環境変数 |

### build.fromWorkflow

| field | required | 説明 |
| --- | --- | --- |
| `path` | yes | `.takos/workflows/` 配下のワークフローパス |
| `job` | yes | deploy artifact を出すジョブ名 |
| `artifact` | yes | ワークフロー artifact 名 |
| `artifactPath` | yes | artifact 内の Worker バンドルパス |

## 次のステップ

- [Containers](/apps/containers) --- Docker コンテナの定義方法
- [Routes](/apps/routes) --- Worker の公開設定
- [環境変数](/apps/environment) --- テンプレート変数と値の注入
