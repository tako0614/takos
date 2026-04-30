# Worker だけのシンプルな group

> このページでわかること: Worker 1 つだけの最小構成の書き方。

この例は
[Canonical minimal manifest](/reference/manifest-spec#canonical-minimal-manifest)
そのままの構成です。

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

## deploy manifest

```yaml
name: simple-worker

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - id: web
    target: web
    path: /
```

## ワークフロー

```yaml
# .takos/workflows/deploy.yml
name: deploy
jobs:
  bundle:
    runs-on: ubuntu-latest
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
takos deploy --env staging --space SPACE_ID
```

## ポイント

- `name` は display 名であり、deploy / install 時の既定 group 名にもなります
- `routes` の `path: /` で Worker
  をルートパスに公開しています。ドメインはシステムが自動付与します
- Worker のコードは標準 Fetch API の `fetch` ハンドラです

## 次のステップ

- データベースを追加したい →
  [Worker + SQL データベース](/examples/worker-with-db)
- Docker コンテナを使いたい →
  [Worker + Container](/examples/worker-with-container)
- MCP Server を公開したい → [MCP Server](/examples/mcp-server)
