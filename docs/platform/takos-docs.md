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
  /                         → built frontend / static asset surface (deployment mount)
  /api                      → app API, OAuth callback, session routes
  /api/auth/callback        → Takos OAuth callback
  /mcp                      → Docs MCP server (streamable HTTP)
  /files/:id                → Storage file handler open route
```

default app manifest は UI の built frontend / static asset surface と MCP
server (`/mcp`) と app API (`/api`) と file handler open route (`/files/:id`)
を同じ worker artifact で publish する。

## Publications

`outputs.url.routeRef` が参照する `/` route は built frontend / static asset
surface の mount point を表し、 server entrypoint 自体の root route
を意味しない。

```yaml
routes:
  - id: ui
    target: web
    path: /
  - id: api
    target: web
    path: /api
  - id: mcp
    target: web
    path: /mcp
  - id: file-open
    target: web
    path: /files/:id

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
  - name: docs-file-handler
    type: takos.file-handler.v1
    display:
      title: Docs
    outputs:
      url:
        kind: url
        routeRef: file-open
    spec:
      mimeTypes:
        - application/vnd.takos.docs+json
      extensions:
        - .takosdoc
```

`takos.ui-surface.v1` / `takos.mcp-server.v1` /
`takos.file-handler.v1` の canonical 定義は
[publication types](/reference/glossary#publication-types) を参照。`takos.mcp-server.v1` entry は agent runtime
が参照する MCP catalog entry です。

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
      - publication: takos.oauth-client
        as: docs-oauth
        request:
          clientName: Takos Docs
          redirectUris:
            - /api/auth/callback
          scopes:
            - openid
            - profile
            - email
```

## UI と MCP server

default app manifest / workflow は UI と `/mcp` を同じ worker に含める。 MCP
publication は `auth.bearer.secretRef: MCP_AUTH_TOKEN` を宣言し、control plane
が worker-scoped secret env を用意する。実装は `MCP_AUTH_TOKEN` が未設定、かつ
`MCP_ALLOW_UNAUTHENTICATED=true` が明示されていない場合に fail closed する。
manifest の `routes` は `/`、`/api`、`/mcp`、`/files/:id` を `web` target
に向ける。`/api` は app session API と OAuth callback を含む。manifest は
generated secret resource を `APP_SESSION_SECRET` として `web` に bind し、OAuth consume の
client/issuer/token/userinfo env を `OAUTH_CLIENT_ID`、`OAUTH_CLIENT_SECRET`、
`OAUTH_ISSUER_URL`、`OAUTH_TOKEN_URL`、`OAUTH_USERINFO_URL` に inject する。

## Storage との連携

takos-docs は `takos-api` built-in provider consume から kernel API の endpoint
/ credential を受け取り、Storage API を呼び出してファイルの読み書きを行う。
Takos managed deploy では consume env として `TAKOS_STORAGE_API_URL` /
`TAKOS_STORAGE_ACCESS_TOKEN` が inject される。

Storage UI から document file を開く場合は `takos.file-handler.v1` publication
の `/files/:id` route を使う。新規作成または保存する Takos document file は
`.takosdoc` extension と `application/vnd.takos.docs+json` MIME type を使う。
既存 file を読む場合もこの MIME type を canonical contract として扱う。

API / UI / MCP request は `space_id` または `spaceId` query parameter を優先し、
指定がない場合は optional env `TAKOS_SPACE_ID` を default Storage space として
使う。どちらもない request は `space_id is required` として失敗する。

## Scopes

| scope         | 用途                                            |
| ------------- | ----------------------------------------------- |
| `files:read`  | kernel Storage からドキュメントファイル読み取り |
| `files:write` | kernel Storage へドキュメントファイル書き込み   |
| `openid`      | Takos OAuth sign-in                             |
| `profile`     | ユーザープロフィール取得                        |
| `email`       | メールアドレス取得                              |

## 所有する data

takos-docs 自体は永続データを持たない。ドキュメントデータは kernel の Storage
に保存される。

## Resources

takos-docs の document storage は kernel の Storage に委譲する。app 自体の
generated secret resource として `docs-session-secret` を持ち、
`APP_SESSION_SECRET` に bind して cookie/session signing に使う。
