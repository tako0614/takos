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
  /    → built frontend / static asset surface (deployment mount)
```

default app manifest は UI の built frontend / static asset surface だけを
publish する。source tree には standalone MCP server (`src/server.ts`)
もあるが、 現在の default deploy workflow artifact には含めない。

## Publications

`path: /` は built frontend / static asset surface の mount point を表し、server
entrypoint 自体の root route を意味しない。

```yaml
publish:
  - name: docs-ui
    type: UiSurface
    publisher: web
    path: /
    title: Docs
```

`UiSurface` は custom route publication type であり、deploy manifest の
`publish` entry で catalog を管理します。

## Capability grants

`takos-api` は route / interface publication ではなく、kernel API への access を
受け取る capability grant です。

```yaml
publish:
  - name: takos-api
    publisher: takos
    type: api-key
    spec:
      scopes:
        - files:read
        - files:write
```

## UI と standalone MCP server の分離

default app manifest / workflow は UI の built frontend / static asset surface
だけを publish する。source tree の standalone MCP server は同じ app source に
含まれるが、現在の default deploy surface では `GET /healthz` / `POST /mcp`
route として公開しない。

## Storage との連携

takos-docs は `takos-api` capability grant を consume して kernel API の
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
