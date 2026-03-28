# MCP Server

app.yml で MCP Server を公開すると、AI エージェントがアプリのツールを呼び出せるようになる。

## 基本

```yaml
mcpServers:
  - name: my-tools
    route: mcp-endpoint
    transport: streamable-http
```

`route` は `spec.routes` の `name` を参照する。

## 認証付き

`secretRef` と組み合わせて認証トークンを自動生成できる。

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

`generate: true` でデプロイ時にランダムトークンが生成され、Worker の `env.MCP_AUTH_TOKEN` に注入される。

## フィールド

| field | required | 説明 |
| --- | --- | --- |
| `name` | yes | MCP Server 名 |
| `route` | yes* | 対象ルート名 (`endpoint` と排他) |
| `endpoint` | yes* | 対象エンドポイント (`route` と排他) |
| `transport` | yes | 現在は `streamable-http` のみ |
| `authSecretRef` | no | 認証トークンに使う `secretRef` リソース名 |

## 次のステップ

- [File Handlers](/apps/file-handlers) --- ファイルハンドラーの登録
- [Routes](/apps/routes) --- ルートの定義方法
