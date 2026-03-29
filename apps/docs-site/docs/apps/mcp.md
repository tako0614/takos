# MCP Server

app.yml で MCP Server を公開すると、AI エージェントがアプリのツールを呼び出せるようになる。

## 基本

```yaml
mcpServers:
  - name: my-tools
    route: mcp-endpoint
    transport: streamable-http
```

`route` は `spec.routes` の `name` を参照する。現行 parser は `route` / `endpoint` の排他を厳密に検証しないので、実運用ではどちらか 1 つに寄せるのが安全。

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

## endpoint と route の使い分け

MCP Server のエンドポイント指定には `route` と `endpoint` の 2 つの方法がある。設計上は排他だが、現行 parser はこの制約を強制しない。

### route（推奨）

`spec.routes` の `name` を参照する。ルーティングをマニフェスト内で一元管理できるのでこちらが推奨。

```yaml
routes:
  - name: mcp-endpoint
    target: web
    path: /mcp

mcpServers:
  - name: my-tools
    route: mcp-endpoint          # routes の name を参照
    transport: streamable-http
```

### endpoint

外部 URL を直接指定する。routes を使わずに外部の MCP Server を登録したいときに使う。

```yaml
mcpServers:
  - name: external-tools
    endpoint: https://external.example.com/mcp   # 外部 URL を直接指定
    transport: streamable-http
```

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
