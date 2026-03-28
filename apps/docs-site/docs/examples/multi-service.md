# マルチサービス構成

複数の Worker と Container を組み合わせてリソースを共有する構成例。API サーバーとバックグラウンドワーカーが同じ DB を使い、キューで非同期連携する。

<div v-pre>

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: full-stack-app
spec:
  version: 1.0.0
  description: Full-stack app with API and background worker
  icon: assets/icon.png
  capabilities: [mcp]

  containers:
    api-server:
      dockerfile: apps/api/Dockerfile
      port: 3000
      env:
        NODE_ENV: production
        LOG_LEVEL: info
    worker-process:
      dockerfile: apps/worker/Dockerfile
      port: 8080

  workers:
    api-host:
      containers: [api-server]
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build-api
          artifact: api-host
          artifactPath: dist/api-host.js
      bindings:
        d1: [main-db]
        r2: [uploads]
        analytics: [events]
    background-host:
      containers: [worker-process]
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build-worker
          artifact: background-host
          artifactPath: dist/worker-host.js
      bindings:
        d1: [main-db]
        queues: [jobs]
      triggers:
        queues:
          - queue: jobs
            export: queue

  resources:
    main-db:
      type: d1
      binding: DB
      migrations:
        up: .takos/migrations/main-db/up
        down: .takos/migrations/main-db/down
    uploads:
      type: r2
      binding: UPLOADS
    jobs:
      type: queue
      binding: JOB_QUEUE
      queue:
        maxRetries: 3
        deadLetterQueue: dead-jobs
    dead-jobs:
      type: queue
      binding: DEAD_LETTER
    events:
      type: analyticsEngine
      binding: ANALYTICS
      analyticsEngine:
        dataset: app-events

  routes:
    - name: api
      target: api-host
      path: /api
    - name: mcp-endpoint
      target: api-host
      path: /mcp

  env:
    required:
      - DATABASE_SECRET
    inject:
      API_URL: "{{routes.api.url}}"
      API_PORT: "{{containers.api-server.port}}"

  mcpServers:
    - name: app-tools
      route: mcp-endpoint
      transport: streamable-http
```

</div>

## ポイント

- **リソース共有**: `main-db` を `api-host` と `background-host` の両方で使っている。同じリソースを複数 Worker からバインドするのは OK
- **キュー連携**: API がキューにメッセージを投入し、background-host が `triggers.queues` で受信する
- **Dead Letter Queue**: 失敗したジョブは `dead-jobs` キューに退避される
- **Analytics**: API Worker から Analytics Engine にイベントを書き込み
- **テンプレート変数**: `env.inject` でルート URL やコンテナポートを自動注入

## 次のステップ

- [Workers](/apps/workers) --- バインディングの詳細
- [Containers](/apps/containers) --- コンテナの定義
- [環境変数](/apps/environment) --- テンプレート変数
- [MCP Server](/apps/mcp) --- MCP Server の公開
