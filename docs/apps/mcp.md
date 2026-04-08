# MCP Server

app が MCP endpoint を公開するには `publish` で `type: McpServer` を宣言する。

## 基本

```yaml
routes:
  - path: /mcp
    target: main

publish:
  - type: McpServer
    path: /mcp
```

`path` は app のルートからの相対 path。
route は `routes` に宣言しておく必要がある。

## 認証付き

```yaml
storage:
  mcp-auth-secret:
    type: secret
    bind: MCP_AUTH_TOKEN
    generate: true

routes:
  - target: main
    path: /mcp

publish:
  - type: McpServer
    path: /mcp
    authSecretRef: MCP_AUTH_TOKEN
```

認証トークンは `type: secret` resource で生成し、workload 側で検証する。`authSecretRef` は client 向け discovery metadata で、対応する env 変数名 (`MCP_AUTH_TOKEN`) を宣言する。

## Transport

`transport` は publish のオプショナルなメタデータ。manifest に含めても省略してもよい。
現在は `streamable-http` のみサポートしている。

```yaml
publish:
  - type: McpServer
    path: /mcp
    transport: streamable-http   # optional
```

## 実 URL の導出

各 group は routing layer から割り当てられた自身の hostname を持ちます。
MCP endpoint の実 URL は group の hostname + `path` で構成されます。

```
name: takos-storage
path: /mcp
→ 実 URL: https://{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}/mcp
```

group の hostname は auto (`{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`)、custom slug、custom domain のいずれか。
kernel domain ではなく、group 自身の hostname で解決されます。

## env injection による発見

他の app やクライアントが MCP endpoint を発見するには、deploy 時に kernel が注入する環境変数を使います。
kernel は `publish` で宣言された情報を、**space 内のすべての group の env に inject** します（scoping や dependency declaration なし）。runtime discovery API は使いません。

## 次のステップ

- [File Handlers](/apps/file-handlers) --- ファイルハンドラーの公開方法
- [マニフェスト](/apps/manifest) --- app.yml の全体像
