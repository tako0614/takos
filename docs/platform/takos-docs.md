# takos-docs

> このページでわかること: バンドルアプリ takos-docs の概要。

Google Docs のようなリッチテキストドキュメントエディタです。

## 役割

- Tiptap ベースのリッチテキストエディタ
- ドキュメントの作成・編集・閲覧
- source tree の standalone MCP server でドキュメント操作 tools を提供
- kernel の Storage 機能に依存（files:read / files:write）
- group に所属しなくても動作可能

## Takosumi 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

例: `team-a-my-docs.app.example.com` or `docs.mycompany.com`

```text
{hostname}
  /                         → built frontend / static asset surface (deployment mount)
  /api                      → app API, OIDC callback, session routes
  /api/auth/callback        → OIDC callback (Takosumi Accounts 経由)。詳細: [OIDC Consumer](/apps/oidc-consumer)
  /mcp                      → Docs MCP server (streamable HTTP)
  /files/:id                → Storage file handler open route
```

bundled app manifest は UI の built frontend / static asset surface と MCP
server (`/mcp`) と app API (`/api`) と file handler open route (`/files/:id`)
を同じ worker artifact で publish する。

## App Metadata And Bindings

launcher / MCP / file handler は kernel manifest の `publications[]` ではなく、
Takos app catalog / runtime registry の metadata として登録します。workload
自体は `.takosumi/manifest.yml` の Shape resource で deploy します。

```yaml
launcher:
  name: docs-ui
  title: Docs
  url: ${ref:web.url}/
mcp:
  endpoints:
    - name: docs-mcp
      title: Docs MCP
      transport: streamable-http
      url: ${ref:web.url}/mcp
      auth:
        kind: bearer
        tokenRef: mcp-auth-token
fileHandlers:
  - name: docs-file-handler
    title: Docs
    url: ${ref:web.url}/files/:id
    mimeTypes:
      - application/vnd.takos.docs+json
    extensions:
      - .takosdoc
```

OIDC sign-in は `.takosumi/app.yml` の `identity.oidc@v1` AppBinding
で宣言します
([`reference/app-yml-spec.md`](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)
/
[`reference/binding-catalog.md`](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md)
を参照)。

```yaml
bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /api/auth/callback
    allowedScopes:
      - openid
      - profile
      - email
```

## UI と MCP server

UI と `/mcp` は同じ worker にまとめて配置します。MCP registry には bearer
token ref が付き、installer が worker scope の secret env を用意します。
`MCP_AUTH_TOKEN` が未設定で `MCP_ALLOW_UNAUTHENTICATED=true` も指定されていない
場合は fail-closed (アクセス拒否) になります。

Shape manifest の route は `/`、`/api`、`/mcp`、`/files/:id` を `web` resource
に向けます (`/api` には app session API と OIDC callback が含まれます)。
installer は次の env を runtime に渡します:

- `APP_SESSION_SECRET` — 自動生成される署名鍵
- `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_ISSUER_URL` / `OIDC_REDIRECT_URI`
  — `identity.oidc@v1` AppBinding から渡される OIDC client 情報

## Storage との連携

takos-docs は app-layer storage grant から Takos Storage API の endpoint /
credential を受け取り、Storage API を呼び出してファイルの読み書きを行います。
managed Takos installation では `TAKOS_STORAGE_API_URL` /
`TAKOS_STORAGE_ACCESS_TOKEN` が materialize されます。

Storage UI からドキュメントファイルを開くときは、file handler metadata の
`/files/:id` route を使います。新規作成・保存するファイルは `.takosdoc`
拡張子と `application/vnd.takos.docs+json` MIME type を使います。既存ファイル
も同じ MIME type で識別します。

API / UI / MCP リクエストは `space_id` または `spaceId` query parameter を
優先します。指定がなければ env `TAKOS_SPACE_ID` をデフォルト Storage space
として使い、どちらもない場合は `space_id is required` エラーになります。

## Scopes

| scope         | 用途                                            |
| ------------- | ----------------------------------------------- |
| `files:read`  | kernel Storage からドキュメントファイル読み取り |
| `files:write` | kernel Storage へドキュメントファイル書き込み   |
| `openid`      | Takosumi Accounts OIDC sign-in                  |
| `profile`     | ユーザープロフィール取得                        |
| `email`       | メールアドレス取得                              |

## 永続データ

takos-docs 自体は永続データを持ちません。ドキュメントデータはすべて kernel
Storage に保存されます。

## リソース

ドキュメントストレージは kernel Storage に委譲します。アプリ自身が持つ
リソースは `docs-session-secret` 1 つだけで、`APP_SESSION_SECRET` に bind
して cookie / session 署名に使います。

## 参照

- [OIDC Consumer](/apps/oidc-consumer)
- [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
- [Binding Catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md)
