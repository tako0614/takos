# MCP Server

> このページでわかること: app.yml で MCP Server を公開する方法と認証の設定。

MCP (Model Context Protocol) Server を公開すると、AI エージェントがアプリのツールを呼び出せるようになります。Takos は MCP Server の公開と認証を宣言的に管理します。

## 基本的な書き方

```yaml
mcpServers:
  - name: my-tools
    route: mcp-endpoint
    transport: streamable-http
```

`route` は `spec.routes` の `name` を参照します。対応するルートが MCP エンドポイントとして公開されます。

## 認証付きの設定

`secretRef` リソースと組み合わせることで、認証トークンを自動生成できます。

```yaml
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

`generate: true` を指定した `secretRef` は、デプロイ時にランダムトークンが生成されて Worker の `env.MCP_AUTH_TOKEN` に注入されます。

## 全フィールド

| field | required | 説明 |
| --- | --- | --- |
| `name` | yes | MCP Server 名。Store での表示名になります |
| `route` | yes* | 対象ルート名（`routes` の `name` を参照）。`endpoint` と排他 |
| `endpoint` | yes* | 対象エンドポイント。`route` と排他 |
| `transport` | yes | 現在は `streamable-http` のみ |
| `authSecretRef` | no | 認証トークンに使う `secretRef` リソース名 |

## 実際の例: takos-computer

takos-computer では、ブラウザ自動化の MCP Server を公開しています。

```yaml
routes:
  - name: browser-mcp
    target: browser-host
    path: /mcp

resources:
  mcp-auth-secret:
    type: secretRef
    binding: MCP_AUTH_TOKEN
    generate: true

mcpServers:
  - name: takos-computer
    route: browser-mcp
    transport: streamable-http
    authSecretRef: mcp-auth-secret
```

## Worker 側の実装

Worker 側で認証チェックと MCP プロトコルのハンドリングを実装します。

```typescript
interface Env {
  MCP_AUTH_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${env.MCP_AUTH_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }

      // MCP プロトコルに従ったレスポンスを返す
      const body = await request.json();
      return handleMcpRequest(body);
    }

    return new Response("Not Found", { status: 404 });
  },
};
```

## 次のステップ

- [MCP Server サンプル](/examples/mcp-server) --- 完全なサンプル
- [File Handlers](/apps/file-handlers) --- ファイルハンドラーの登録
- [Routes](/apps/routes) --- ルートの定義方法
