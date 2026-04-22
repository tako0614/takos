# takos-docs

Google Docs 代替のリッチテキストドキュメントエディタ。default app distribution
metadata を持つが、primitive や group は特権化されない。

## 役割

- Tiptap ベースのリッチテキストエディタ
- ドキュメントの作成・編集・閲覧
- source tree の standalone MCP server でドキュメント操作 tools を提供
- kernel の Storage 機能に依存（files:read / files:write）
- group に所属しなくても動作可能

## Takos 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

例: `team-a-my-docs.app.example.com` or `docs.mycompany.com`

```text
{hostname}
  /     → built frontend / static asset surface (deployment mount)
  /mcp  → Docs MCP server (streamable HTTP)
```

default app manifest は UI の built frontend / static asset surface と MCP
server (`/mcp`) を同じ worker artifact で publish する。

## Publications

`outputs.url.route: /` は built frontend / static asset surface の mount point を表し、
server entrypoint 自体の root route を意味しない。

```yaml
publish:
  - name: docs-ui
    type: UiSurface
    publisher: web
    outputs:
      url:
        route: /
    title: Docs
  - name: docs-mcp
    type: McpServer
    publisher: web
    outputs:
      url:
        route: /mcp
    title: Docs MCP
    spec:
      transport: streamable-http
      authSecretRef: MCP_AUTH_TOKEN
```

`UiSurface` は custom route publication type であり、deploy manifest の
`publish` entry で catalog を管理します。`McpServer` は agent runtime が
参照する MCP catalog entry です。

## Takos system publication

`takos-api` は route / interface publication ではなく、kernel API への access を
受け取る local consume 名です。

```yaml
compute:
  web:
    consume:
      - publication: takos.api-key
        as: takos-api
        request:
          scopes:
            - files:read
            - files:write
```

## UI と MCP server

default app manifest / workflow は UI と `/mcp` を同じ worker に含める。 MCP
publication は `authSecretRef: MCP_AUTH_TOKEN` を宣言し、control plane が
worker-scoped secret env を用意する。`compute.web.env` には
`MCP_AUTH_REQUIRED=1` を設定し、manifest の `routes` は `/` と `/mcp` の両方を
`web` target に向ける。

## Storage との連携

takos-docs は `takos-api` system consume から kernel API の
endpoint / credential を受け取り、Storage API
を呼び出してファイルの読み書きを行う。

## Scopes

| scope         | 用途                                            |
| ------------- | ----------------------------------------------- |
| `files:read`  | kernel Storage からドキュメントファイル読み取り |
| `files:write` | kernel Storage へドキュメントファイル書き込み   |

## 所有する data

takos-docs 自体は永続データを持たない。ドキュメントデータは kernel の Storage
に保存される。

## Resources

takos-docs 固有のリソースはない。ストレージは kernel の Storage に委譲する。
