# MCP Server

`mcpServers` で app.yml 内の workload を MCP endpoint として公開できます。

## 基本

```yaml
routes:
  - name: mcp-endpoint
    target: web
    path: /mcp

mcpServers:
  - name: my-tools
    route: mcp-endpoint
    transport: streamable-http
```

`route` は `spec.routes[].name` を参照します。`route` と `endpoint` は排他です。

## 認証付き

```yaml
resources:
  mcp-auth-secret:
    type: secret
    binding: MCP_AUTH_TOKEN
    generate: true

mcpServers:
  - name: my-tools
    route: mcp-endpoint
    transport: streamable-http
    authSecretRef: mcp-auth-secret
```

`authSecretRef` は `type: secret` resource を参照します。

## フィールド

| field | required | 説明 |
| --- | --- | --- |
| `name` | yes | MCP Server 名 |
| `route` | yes* | `spec.routes[].name` を参照 |
| `endpoint` | yes* | 外部 URL を直接指定 |
| `transport` | yes | 現在は `streamable-http` のみ |
| `authSecretRef` | no | 認証トークン用 `secret` resource 名 |

`route` と `endpoint` のどちらか一方だけを指定します。
