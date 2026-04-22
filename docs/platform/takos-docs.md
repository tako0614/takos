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

`outputs.url.routeRef` が参照する `/` route は built frontend / static asset surface の mount point を表し、
server entrypoint 自体の root route を意味しない。

```yaml
routes:
  - id: ui
    target: web
    path: /
  - id: mcp
    target: web
    path: /mcp

publish:
  - name: docs-ui
    type: takos.ui-surface.v1
    display:
      title: Docs
    outputs:
      url:
        kind: url
        routeRef: ui
  - name: docs-mcp
    type: takos.mcp-server.v1
    display:
      title: Docs MCP
    outputs:
      url:
        kind: url
        routeRef: mcp
    auth:
      bearer:
        secretRef: MCP_AUTH_TOKEN
    spec:
      transport: streamable-http
```

`takos.ui-surface.v1` は UI surface publication type であり、deploy manifest の
`publish` entry で catalog を管理します。`takos.mcp-server.v1` は agent runtime が
参照する MCP catalog entry です。

## Takos built-in provider publication

`takos-api` は route / interface publication ではなく、kernel API への access を
受け取る local consume 名です。実体は `takos.api-key` built-in provider
publication の consume です。

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
publication は `auth.bearer.secretRef: MCP_AUTH_TOKEN` を宣言し、control plane が
worker-scoped secret env を用意する。実装は `MCP_AUTH_TOKEN` が未設定、かつ
`MCP_ALLOW_UNAUTHENTICATED=true` が明示されていない場合に fail closed する。
manifest の `routes` は `/` と `/mcp` の両方を `web` target に向ける。

## Storage との連携

takos-docs は `takos-api` built-in provider consume から kernel API の
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
