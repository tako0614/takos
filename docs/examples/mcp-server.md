# MCP Server

MCP Server を公開する最小構成です。 `publication.mcp-server@v1` ref の
publication を `publications[]` に declaration し、 必要なら他 component が
explicit `bindings[].from.publication` で consume します。

## deploy manifest

```yaml
name: my-tools

components:
  web:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
        config:
          source:
            ref: artifact.workflow-bundle@v1
            config:
              workflow: .takos/workflows/deploy.yml
              job: bundle
              artifact: web
              entry: dist/worker.js
          readiness: /mcp
      mcp:
        ref: interface.http@v1

routes:
  - id: mcp
    expose: { component: web, contract: mcp }
    via: { ref: route.https@v1, config: { path: /mcp } }

publications:
  - name: my-tools
    ref: publication.mcp-server@v1
    outputs:
      url: { from: { route: mcp } }
    spec:
      transport: streamable-http
```

`readiness: /mcp` は root path が 200 を返さない MCP-only component で
よく使います。

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

bearer token は `resource.secret@v1` を作って component に env binding し、
component 側で検証します。 publication 側で auth を declarative に宣言する
場合は、 `publication.mcp-server@v1` descriptor の `spec.auth` schema が
受け付ける場合のみその field を使います。

```yaml
resources:
  mcp-token:
    ref: resource.secret@v1
    config: { generate: true }

bindings:
  - from: { secret: mcp-token }
    to: { component: web, env: MCP_AUTH_TOKEN }
```

Takos の MCP client は publication metadata から token source を解決して
`Authorization: Bearer ...` を送るので、 component 側でも同じ token を
検証してください。

## ローカルテスト

```bash
npm run build
npx wrangler dev dist/worker/index.js
```
