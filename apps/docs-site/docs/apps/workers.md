# Workers

`workers` は Workers runtime で動くワークロードです。HTTP 処理、軽量ジョブ、route ingress を担います。

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

## Bindings

```yaml
workers:
  web:
    build: ...
    bindings:
      d1: [primary-db]
      r2: [assets]
      kv: [cache]
      queues: [jobs]
      vectorize: [embeddings]
      analyticsEngine: [events]
      workflow: [deploy-flow]
      durableObjects: [session-do]
      services: [control-api]
```

`bindings` は `spec.resources` の名前を参照します。binding key と resource type は一致している必要があります。

| binding | resource type | 例 |
| --- | --- | --- |
| `d1` | `d1` | `d1: [primary-db]` |
| `r2` | `r2` | `r2: [assets]` |
| `kv` | `kv` | `kv: [cache]` |
| `queues` | `queue` | `queues: [jobs]` |
| `vectorize` | `vectorize` | `vectorize: [embeddings]` |
| `analyticsEngine` | `analyticsEngine` | `analyticsEngine: [events]` |
| `workflow` | `workflow` | `workflow: [deploy-flow]` |
| `durableObjects` | `durableObject` | `durableObjects: [session-do]` |
| `services` | 他 workload | `services: [control-api]` |

## 代表例

### Analytics

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
      analyticsEngine: [events]
```

### Workflow Runtime

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
      workflow: [deploy-flow]
```

`workflow` は manifest でも service settings API / builtin tool でも設定できます。binding には `workflow.service` と `workflow.export` の metadata が必要です。

### Durable Namespace

```yaml
resources:
  session-do:
    type: durableObject
    binding: SESSION
    durableObject:
      className: SessionDO
      scriptName: web

workers:
  web:
    build: ...
    bindings:
      durableObjects: [session-do]
```

## Triggers

```yaml
workers:
  web:
    build: ...
    triggers:
      schedules:
        - cron: "*/15 * * * *"
          export: scheduled
      queues:
        - queue: jobs
          export: queue
```

## フィールド

| field | required | 説明 |
| --- | --- | --- |
| `build` | yes | 現在は `fromWorkflow` のみ |
| `containers` | no | 紐づける `spec.containers` 名 |
| `bindings` | no | Cloudflare-native resource bindings |
| `triggers` | no | スケジュール / キュートリガー |
| `env` | no | Worker 固有の環境変数 |
| `healthCheck` | no | ヘルスチェック設定 |
| `scaling` | no | スケーリング設定 |
| `dependsOn` | no | 他 workload への依存 |
