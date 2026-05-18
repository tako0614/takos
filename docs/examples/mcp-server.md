# MCP Server

> このページでわかること: MCP Server を Worker として install し、Takos app から使えるようにするサンプル。

MCP endpoint の catalog / install UI / client discovery は Takos app layer と
Installation layer で扱います。AppSpec は HTTP entrypoint と MCP interface を
宣言します。

## AppSpec

```yaml
apiVersion: takosumi.dev/v1
kind: App
metadata:
  id: example.my-tools
  name: My Tools
components:
  mcp:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    routes:
      - tools.example.com/*
interfaces:
  mcp:
    target: mcp
    path: /mcp
  health:
    target: mcp
    path: /healthz
```

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

## Catalog / Client Discovery

Takos app に MCP endpoint として見せる場合、AppSpec component schema ではなく app
metadata / runtime registry 側で endpoint descriptor を materialize します。

```yaml
mcp:
  endpoints:
    - name: my-tools
      transport: streamable-http
      url: https://tools.example.com/mcp
```

関連:

- [AppSpec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [MCP App Surface](/apps/mcp)
