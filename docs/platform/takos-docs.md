# takos-docs

リッチテキストドキュメントエディタ app（Google Docs 代替）。

## 役割

- Tiptap ベースのリッチテキストエディタ
- ドキュメントの作成・編集・閲覧
- MCP Server でドキュメント操作をエージェントに公開
- kernel の Storage 機能に依存（files:read / files:write）
- standalone でも動作可能

## Takos 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

例: `team-a-my-docs.app.example.com` or `docs.mycompany.com`

```text
{hostname}
  /    → built frontend / static asset surface (deployment mount)
  /mcp → MCP Server endpoint
```

単一の web worker で MCP と health を公開し、UI は deployment 側で built frontend / static asset として mount される。

## Publications

`path: /` は built frontend / static asset surface の mount point を表し、server entrypoint 自体の root route を意味しない。

```yaml
publish:
  - name: docs-ui
    type: UiSurface
    path: /
    title: Docs
  - name: docs-mcp
    type: McpServer
    path: /mcp
```

## 他 app からの利用

kernel 等がドキュメント操作を行いたい場合:

1. env injection で takos-docs の URL を得る
2. MCP プロトコルで接続し tool を呼び出す

## UI と runtime の分離

UI は build 済みの frontend / static asset surface として mount される想定で、server entrypoint 自体は `GET /healthz` と `POST /mcp` を公開する。

## Storage との連携

takos-docs は `takos-api` publication を consume して kernel API の endpoint /
credential を受け取り、Storage API を呼び出してファイルの読み書きを行う。

## Scopes

| scope         | 用途                                            |
| ------------- | ----------------------------------------------- |
| `files:read`  | kernel Storage からドキュメントファイル読み取り |
| `files:write` | kernel Storage へドキュメントファイル書き込み   |
| `mcp:invoke`  | 他 group の MCP server を呼ぶ (group 間連携)    |

## 所有する data

takos-docs 自体は永続データを持たない。 ドキュメントデータは kernel の Storage
に保存される。

## Resources

takos-docs 固有のリソースはない。ストレージは kernel の Storage に委譲する。
