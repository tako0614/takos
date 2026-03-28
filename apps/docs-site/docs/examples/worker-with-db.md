# Worker + D1 データベース

> このページでわかること: Worker に D1 データベースと R2 ストレージを接続する方法。

## app.yml

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: notes-app
spec:
  version: 0.1.0
  description: A notes app with D1 and R2

  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: bundle
          artifact: web
          artifactPath: dist/worker
      bindings:
        d1: [primary-db]
        r2: [assets]

  resources:
    primary-db:
      type: d1
      binding: DB
      migrations:
        up: .takos/migrations/primary-db/up
        down: .takos/migrations/primary-db/down
    assets:
      type: r2
      binding: ASSETS

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

## マイグレーション

```sql
-- .takos/migrations/primary-db/up/0001_init.sql
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

```sql
-- .takos/migrations/primary-db/down/0001_init.sql
DROP TABLE IF EXISTS notes;
```

## Worker のコード

```typescript
// src/index.ts
interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/notes" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM notes ORDER BY created_at DESC"
      ).all();
      return Response.json(results);
    }

    if (url.pathname === "/api/notes" && request.method === "POST") {
      const body = await request.json<{ title: string; content: string }>();
      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)"
      )
        .bind(id, body.title, body.content)
        .run();
      return Response.json({ id }, { status: 201 });
    }

    if (url.pathname.startsWith("/assets/") && request.method === "GET") {
      const key = url.pathname.replace("/assets/", "");
      const object = await env.ASSETS.get(key);
      if (!object) return new Response("Not Found", { status: 404 });
      return new Response(object.body);
    }

    return new Response("Not Found", { status: 404 });
  },
};
```

## ポイント

- `resources` に `d1` と `r2` を定義すると、デプロイ時に自動作成されます
- `binding` で指定した名前（`DB`, `ASSETS`）が Worker の `env` に注入されます
- Worker の `bindings` セクションで、どのリソースを使うか明示的に指定します
- マイグレーションは `.takos/migrations/<resource-name>/` 配下に配置します

## リソースの種類

D1 と R2 以外にも、以下のリソースが使えます。

| type | 用途 | 追加フィールド |
| --- | --- | --- |
| `d1` | SQL データベース | `migrations` |
| `r2` | オブジェクトストレージ | - |
| `kv` | Key-Value ストア | - |
| `queue` | メッセージキュー | `queue.maxRetries` |
| `vectorize` | ベクトルデータベース | `vectorize.dimensions`, `vectorize.metric` |
| `secretRef` | シークレット参照 | `generate` |

## 次のステップ

- Docker コンテナを使いたい → [Worker + Container](/examples/worker-with-container)
- MCP Server を公開したい → [MCP Server](/examples/mcp-server)
- リソースの詳細 → [app.yml のリソース定義](/apps/manifest#resources)
