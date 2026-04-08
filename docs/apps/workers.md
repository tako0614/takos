# Workers

`compute` は Workers runtime で動くワークロードです。HTTP
処理、軽量ジョブ、route ingress を担います。

## 基本

```yaml
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
```

## Storage binding

compute に `bindings` フィールドはありません。`storage` で宣言した resource は
`bind:` で env 名を指定すると、group 内の全 compute に自動注入されます。

```yaml
storage:
  db:
    type: sql
    bind: DB
  files:
    type: object-store
    bind: FILES
  jobs-dlq:
    type: queue # bind 省略: storage 名 jobs-dlq → env.JOBS_DLQ
  app-secret:
    type: secret # bind 省略: storage 名 app-secret → env.APP_SECRET
    generate: true
```

`bind:` を指定した場合は指定した名前がそのまま env
変数名になります（自動正規化なし）。 `bind:` を省略した場合は kernel が storage
名を normalize します（ハイフン→アンダースコア、大文字化）。 例: `jobs-dlq` →
`JOBS_DLQ`, `app-secret` → `APP_SECRET`。詳しくは
[Deploy System - Binding](/architecture/deploy-system#binding) を参照。

## Depends

compute ごとの起動・bind 順序の依存を `depends` で宣言できます。 同一 group
内の他の **compute 名と storage 名の両方**を指定できます。

```yaml
storage:
  db:
    type: sql
    bind: DB

compute:
  api:
    build: ...
    depends: [db, jobs] # storage と compute を混在可
  jobs:
    build: ...
    depends: [db]
```

deploy pipeline が topological order で適用します。

## 代表例

### Analytics

`analytics-engine` は write-only sink です。追加の設定 field はありません。

```yaml
storage:
  events:
    type: analytics-engine
    bind: ANALYTICS

compute:
  web:
    build: ...
```

### Workflow Runtime

`workflow` は durable な multi-step workflow を実行します。 `workflow.class`
でコード内の workflow class 名を指定します。

```yaml
storage:
  deploy-flow:
    type: workflow
    bind: DEPLOY_WORKFLOW
    workflow:
      class: DeployWorkflow

compute:
  web:
    build: ...
```

### Durable Namespace

`durable-object` は DurableObject namespace を bind します。
`durableObject.class` で DO class 名、`durableObject.script` で DO を定義する
worker (`compute.<name>`) の名前を指定します。

```yaml
storage:
  session-do:
    type: durable-object
    bind: SESSION
    durableObject:
      class: SessionDO
      script: web

compute:
  web:
    build: ...
```

## Triggers

```yaml
compute:
  web:
    build: ...
    triggers:
      schedules:
        - cron: "*/15 * * * *"
      queues:
        - storage: jobs
          batchSize: 10
          maxRetries: 3
```

queue trigger は `storage:` で参照する。`queue:` や `export:` ではない。

## healthCheck

Worker は request-driven のため `healthCheck` field を持ちません。 manifest
で宣言する `healthCheck` は **Service / Attached container のみ** で
有効です。詳しくは
[Manifest Reference - healthCheck](/reference/manifest-spec#3-compute-name-healthcheck)
を参照してください。

### Worker readiness

Worker は healthCheck を持ちませんが、deploy 時に kernel が readiness を確認します:

1. Worker を deploy
2. kernel が readiness path を Worker に送信（default: `GET /`）
3. 200/2xx/3xx を受け取れば ready
4. 5xx または timeout (10s) なら deploy fail

readiness path は manifest で指定可能です（default: `GET /`）。root path が
200 を返せない Worker（例: MCP-only endpoint）は `compute.<name>.readiness`
フィールドで明示的に上書きします。

```yaml
compute:
  mcp:
    build: ...
    readiness: /mcp   # root が 200 を返さない Worker の場合
```

routing 切り替えはこの readiness 確認の後に行われます。

## フィールド

| field        | required | 説明                                               |
| ------------ | -------- | -------------------------------------------------- |
| `build`      | yes      | 現在は `fromWorkflow` のみ                         |
| `readiness`  | no       | deploy 時の readiness probe path（default: `/`）   |
| `containers` | no       | 紐づける attached container の定義                 |
| `depends`    | no       | 同一 group 内の compute / storage への起動順序依存 |
| `triggers`   | no       | スケジュール / キュートリガー                      |
| `env`        | no       | Worker 固有の環境変数                              |
| `scaling`    | no       | スケーリング設定                                   |
