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
      analytics: [events]
      workflows: [deploy-flow]
      durableObjects: [session-do]
      services: [takos-control]
```

`spec.resources` の名前を参照する。型が一致しないとバリデーションエラー。

### バインディング種類一覧

| binding | 説明 | 例 |
| --- | --- | --- |
| `d1` | D1 Database | `d1: [primary-db]` |
| `r2` | R2 Bucket | `r2: [assets]` |
| `kv` | KV Namespace | `kv: [cache]` |
| `vectorize` | Vectorize Index | `vectorize: [embeddings]` |
| `queues` | Queue | `queues: [jobs]` |
| `analytics` | Analytics Engine | `analytics: [events]` |
| `workflows` | Workflows | `workflows: [deploy-flow]` |
| `durableObjects` | Durable Objects | `durableObjects: [session-do]` |
| `services` | Service Binding (外部 Worker) | `services: [other-worker]` |

### analytics (Analytics Engine)

Analytics Engine にイベントを書き込むときに使う。`spec.resources` で `type: analyticsEngine` のリソースを定義し、バインディングで参照する。

```yaml
resources:
  events:
    type: analyticsEngine
    binding: ANALYTICS
    analyticsEngine:
      dataset: app-events

workers:
  web:
    build: ...
    bindings:
      analytics: [events]
```

Worker コードからは `env.ANALYTICS.writeDataPoint(...)` で書き込める。

### workflows (Workflows)

Workflows バインディングでワークフローの作成・管理ができる。`spec.resources` で `type: workflow` のリソースを定義する。

```yaml
resources:
  deploy-flow:
    type: workflow
    binding: DEPLOY_WORKFLOW
    workflow:
      service: web
      export: DeployWorkflow
      timeoutMs: 300000
      maxRetries: 3

workers:
  web:
    build: ...
    bindings:
      workflows: [deploy-flow]
```

Worker コードからは `env.DEPLOY_WORKFLOW.create(...)` でワークフローインスタンスを作成できる。

### durableObjects (Durable Objects)

Durable Objects バインディングでステートフルなオブジェクトにアクセスできる。`spec.resources` で `type: durableObject` のリソースを定義する。

```yaml
resources:
  session-do:
    type: durableObject
    binding: SESSION
    durableObject:
      className: SessionDO
      scriptName: web         # 省略すると同一 Worker 内を参照

workers:
  web:
    build: ...
    bindings:
      durableObjects: [session-do]
```

Worker コードからは `env.SESSION.get(id)` でオブジェクトを取得できる。

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
| `bindings` | no | リソースバインディング（d1, r2, kv, vectorize, queues, analytics, workflows, durableObjects, services） |
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
