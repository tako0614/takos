# Worker だけのシンプルなアプリ

> このページでわかること: Worker 1 つだけの最小構成の書き方。

## 完成形

```text
my-app/
├── .takos/
│   ├── app.yml
│   └── workflows/
│       └── deploy.yml
├── src/
│   └── index.ts
└── package.json
```

## app.yml

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: simple-worker
spec:
  version: 0.1.0
  description: A simple worker app

  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: bundle
          artifact: web
          artifactPath: dist/worker

  routes:
    - name: app
      target: web
      path: /
```

## ワークフロー

```yaml
# .takos/workflows/deploy.yml
name: deploy
jobs:
  bundle:
    steps:
      - name: Install dependencies
        run: npm install
      - name: Build
        run: npm run build
    artifacts:
      web:
        path: dist/worker
```

## Worker のコード

```typescript
// src/index.ts
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("Hello from Takos!", {
        headers: { "content-type": "text/plain" },
      });
    }

    if (url.pathname === "/api/health") {
      return Response.json({ status: "ok" });
    }

    return new Response("Not Found", { status: 404 });
  },
};
```

## デプロイ

```bash
takos deploy-group --env staging
```

## ポイント

- `metadata.name` がリソース名のプレフィックスになります。短くてわかりやすい名前にしましょう
- `routes` の `path: /` で Worker をルートパスに公開しています。ドメインはシステムが自動付与します
- Worker のコードは Cloudflare Workers の標準的な `fetch` ハンドラです

## 次のステップ

- データベースを追加したい → [Worker + D1 データベース](/examples/worker-with-db)
- Docker コンテナを使いたい → [Worker + Container](/examples/worker-with-container)
- MCP Server を公開したい → [MCP Server](/examples/mcp-server)
