# MCP Server

MCP Server を公開する最小構成です。現行 contract では route publication を
`publish` に書き、必要なら他 compute が explicit consume します。

## deploy manifest

```yaml
name: my-tools

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    readiness: /mcp

routes:
  - target: web
    path: /mcp

publish:
  - name: my-tools
    type: McpServer
    publisher: web
    path: /mcp
    spec:
      transport: streamable-http
```

`readiness: /mcp` は root path が 200 を返さない MCP-only Worker
でよく使います。

## Worker のコード

```typescript
const TOOLS = [
  {
    name: "get_current_time",
    description: "現在の UTC 時刻を返す",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const body = await request.json() as {
      method: string;
      id?: string | number;
    };

    switch (body.method) {
      case "initialize":
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "my-tools", version: "0.1.0" },
          },
        });
      case "tools/list":
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: TOOLS },
        });
      default:
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: "Method not found" },
        });
    }
  },
};
```

## auth を付けたい場合

`authSecretRef` は publication `spec` 内の metadata です。実際の token 値は
service env settings か secret resource / runtime binding から供給します。

```yaml
publish:
  - name: my-tools
    type: McpServer
    publisher: web
    path: /mcp
    spec:
      transport: streamable-http
      authSecretRef: MCP_AUTH_TOKEN
```

## ローカルテスト

```bash
npm run build
npx wrangler dev dist/worker/index.js
```
