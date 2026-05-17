# MCP Server

> このページでわかること: MCP Server を Worker としてデプロイし、Takos app から使えるようにするサンプル。

MCP Server を `worker@v1` resource として公開する最小構成です。current compiled Shape manifest では top-level
`publications[]` を使いません。MCP endpoint の catalog / install UI / client discovery は Takos app 側の metadata と
Installation layer で扱い、kernel manifest は HTTP entrypoint を materialize するだけです。

## Deploy Manifest

```yaml
apiVersion: '1.0'
kind: Manifest
metadata:
  name: my-tools
resources:
  - shape: worker@v1
    name: mcp
    provider: '@takos/cloudflare-workers'
    spec:
      artifact:
        kind: js-bundle
        hash: PLACEHOLDER
      compatibilityDate: '2026-05-09'
      routes:
        - tools.example.com/mcp
      env:
        MCP_AUTH_TOKEN: ${secret-ref:mcp-auth-token}
    workflowRef:
      file: .takosumi/workflows/deploy.yml
      job: bundle
      artifact: mcp
      target: spec.artifact.hash
```

`workflowRef` は takosumi-git の authoring extension です。kernel に届く compiled manifest では `spec.artifact.hash` が
concrete digest になり、`workflowRef` は存在しません。

## Worker のコード

```typescript
const TOOLS = [
  {
    name: 'get_current_time',
    description: '現在の UTC 時刻を返す',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

export default {
  async fetch(
    request: Request,
    env: { MCP_AUTH_TOKEN?: string },
  ): Promise<Response> {
    if (env.MCP_AUTH_TOKEN) {
      const auth = request.headers.get('Authorization');
      if (auth !== `Bearer ${env.MCP_AUTH_TOKEN}`) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = await request.json() as {
      method: string;
      id?: string | number;
    };

    switch (body.method) {
      case 'initialize':
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'my-tools', version: '0.1.0' },
          },
        });
      case 'tools/list':
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: TOOLS },
        });
      default:
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: 'Method not found' },
        });
    }
  },
};
```

## Catalog / Client Discovery

Takos app に MCP endpoint として見せる場合、kernel manifest ではなく app metadata / install metadata
側で次の情報を登録します。

```yaml
mcp:
  endpoints:
    - name: my-tools
      transport: streamable-http
      url: ${ref:mcp.url}
      auth:
        kind: bearer
        tokenRef: mcp-auth-token
```

この metadata は Takos app / installer が読む layer であり、takosumi kernel の closed manifest top-level field
ではありません。

## ローカルテスト

```bash
npm run build
npx wrangler dev dist/worker/index.js
```

関連:

- [Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)
- [App YAML Spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)
- [MCP App Surface](/apps/mcp)
