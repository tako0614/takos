# MCP Server

> このページでわかること: MCP (Model Context Protocol) Server を公開するアプリの作り方。

MCP Server を公開すると、AI エージェントからツールとして呼び出せるようになります。認証トークンの自動生成もサポートしています。

この例は現行の `takos deploy-group` と control-plane parser に合わせています。`route` / `endpoint` の排他は設計上の契約として扱い、実運用では片方に寄せてください。

## app.yml

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: my-tools
spec:
  version: 0.1.0
  description: MCP tools for AI agents
  category: service

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
    - name: mcp-endpoint
      target: web
      path: /mcp

  resources:
    mcp-auth-secret:
      type: secretRef
      binding: MCP_AUTH_TOKEN
      generate: true

  mcpServers:
    - name: my-tools
      route: mcp-endpoint
      transport: streamable-http
      authSecretRef: mcp-auth-secret
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
interface Env {
  MCP_AUTH_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // MCP エンドポイント
    if (url.pathname === "/mcp") {
      // 認証チェック
      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${env.MCP_AUTH_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }

      // MCP リクエストを処理
      const body = await request.json();
      return handleMcpRequest(body);
    }

    // 通常のエンドポイント
    return new Response("MCP Server is running", {
      headers: { "content-type": "text/plain" },
    });
  },
};

function handleMcpRequest(body: unknown): Response {
  // MCP プロトコルに従ったレスポンスを返す
  return Response.json({
    jsonrpc: "2.0",
    result: {
      tools: [
        {
          name: "search",
          description: "Search for documents",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
            },
            required: ["query"],
          },
        },
      ],
    },
  });
}
```

## ポイント

- `mcpServers` で MCP Server を宣言すると、Takos が自動的に公開設定を行います
- `authSecretRef` に `secretRef` リソースを指定すると、認証トークンが自動生成されます
- `generate: true` を指定した `secretRef` は、デプロイ時にランダムトークンが生成されて Worker に注入されます
- `transport` は現在 `streamable-http` のみサポートしています

## mcpServers の設定

| field | required | 説明 |
| --- | --- | --- |
| `name` | yes | MCP Server 名。Store での表示名になります |
| `route` | yes* | 対象ルート名（`routes` の `name` を参照）。`endpoint` と排他 |
| `endpoint` | yes* | 対象エンドポイント。`route` と排他 |
| `transport` | yes | 現在は `streamable-http` |
| `authSecretRef` | no | 認証トークンに使う `secretRef` リソース名 |

## 次のステップ

- MCP の詳細 → [MCP ガイド](/apps/mcp)
- Worker だけのシンプルな構成 → [Simple Worker](/examples/simple-worker)
- DB を追加したい → [Worker + D1 データベース](/examples/worker-with-db)
