# takos-slide

Google Slides alternative のプレゼンテーションエディタ。default app distribution
metadata を持つが、primitive や group は特権化されない。

## 役割

- プレゼンテーションの作成・編集
- スライド操作 (追加 / 削除 / 並び替え)
- テキスト・図形・画像の配置
- source tree の standalone MCP server でスライド操作 tools を提供
- `publication.http-endpoint@v1` でプレゼンテーション UI を提供
- group に所属しなくても動作可能

## Takos 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

例: `team-a-my-slide.app.example.com` or `slides.mycompany.com`

single worker (web) 構成。

```text
{hostname}
  /                         → built frontend / static asset surface (deployment mount)
  /api                      → app API, OAuth callback, session routes
  /api/auth/callback        → Takos OAuth callback
  /mcp                      → Slide MCP server (streamable HTTP)
  /files/:id                → Storage file handler open route
```

## Publications

`outputs.url.routeRef` が参照する `/` route は built frontend / static asset
surface の mount point を 表し、server entrypoint 自体の root route
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

publications:
  - name: slide-ui
    type: publication.http-endpoint@v1
    display:
      title: Slide
    outputs:
      url:
        kind: url
        routeRef: ui
  - name: slide-mcp
    type: publication.mcp-server@v1
    display:
      title: Slide MCP
    outputs:
      url:
        kind: url
        routeRef: mcp
    auth:
      bearer:
        secretRef: MCP_AUTH_TOKEN
    spec:
      transport: streamable-http
  - name: slide-file-handler
    type: publication.http-endpoint@v1
    display:
      title: Slide
    outputs:
      url:
        kind: url
        routeRef: file-open
    spec:
      mimeTypes:
        - application/vnd.takos.slide+json
      extensions:
        - .takosslide
```

`publication.http-endpoint@v1` / `publication.mcp-server@v1` /
`publication.http-endpoint@v1` の canonical 定義は
[publication types](/reference/glossary#publication-types) を参照。`publication.mcp-server@v1` entry は agent runtime
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
        as: slide-oauth
        request:
          clientName: Takos Slide
          redirectUris:
            - /api/auth/callback
          scopes:
            - openid
            - profile
            - email
```

default app manifest / workflow は UI と `/mcp` を同じ worker に含める。MCP
publication は `auth.bearer.secretRef: MCP_AUTH_TOKEN` を宣言し、control plane
が worker-scoped secret env を用意する。実装は `MCP_AUTH_TOKEN` が未設定、かつ
`MCP_ALLOW_UNAUTHENTICATED=true` が明示されていない場合に fail closed する。
manifest の `routes` は `/`、`/api`、`/mcp`、`/files/:id` を `web` target
に向ける。`/api` は app session API と OAuth callback を含む。manifest は
generated secret resource を `APP_SESSION_SECRET` として `web` に bind し、OAuth consume の
client/issuer/token/userinfo env を `OAUTH_CLIENT_ID`、`OAUTH_CLIENT_SECRET`、
`OAUTH_ISSUER_URL`、`OAUTH_TOKEN_URL`、`OAUTH_USERINFO_URL` に inject する。

## Storage との連携

takos-slide は `takos-api` built-in provider consume から kernel API の endpoint
/ credential を受け取り、Storage API を呼び出して presentation file を読み書き
する。Takos managed deploy では consume env として `TAKOS_STORAGE_API_URL` /
`TAKOS_STORAGE_ACCESS_TOKEN` が inject される。

Storage UI から presentation file を開く場合は `publication.http-endpoint@v1`
publication の `/files/:id` route を使う。新規作成または保存する Takos
presentation file は `.takosslide` extension と
`application/vnd.takos.slide+json` MIME type を使う。既存 file を読む場合もこの
MIME type を canonical contract として扱う。

API / UI / MCP request は `space_id` または `spaceId` query parameter を優先し、
指定がない場合は optional env `TAKOS_SPACE_ID` を default Storage space として
使う。どちらもない request は `space_id is required` として失敗する。

## Scopes

| scope       | 用途                                   |
| ----------- | -------------------------------------- |
| files:read  | kernel の Storage からファイル読み取り |
| files:write | kernel の Storage へファイル書き込み   |
| openid      | Takos OAuth sign-in                    |
| profile     | ユーザープロフィール取得               |
| email       | メールアドレス取得                     |

## Resources

takos-slide の presentation storage は kernel の Storage に委譲する。app 自体の
generated secret resource として `slide-session-secret` を持ち、
`APP_SESSION_SECRET` に bind して cookie/session signing に使う。
