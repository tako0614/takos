# takos-slide

Google Slides alternative のプレゼンテーションエディタ。default app distribution
metadata を持つが、primitive や group は特権化されない。

## 役割

- プレゼンテーションの作成・編集
- スライド操作 (追加 / 削除 / 並び替え)
- テキスト・図形・画像の配置
- source tree の standalone MCP server でスライド操作 tools を提供
- app metadata でプレゼンテーション UI / MCP / file handler を提供
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
  /api                      → app API, OIDC callback, session routes
  /api/auth/callback        → OIDC callback (Takosumi Accounts 経由)。詳細: [OIDC Consumer](/apps/oidc-consumer)
  /mcp                      → Slide MCP server (streamable HTTP)
  /files/:id                → Storage file handler open route
```

## App Metadata And Bindings

launcher / MCP / file handler は kernel manifest の `publications[]` ではなく、
Takos app catalog / runtime registry の metadata として登録します。workload
自体は `.takosumi/manifest.yml` の Shape resource で deploy します。

```yaml
launcher:
  name: slide-ui
  title: Slide
  url: ${ref:web.url}/
mcp:
  endpoints:
    - name: slide-mcp
      title: Slide MCP
      transport: streamable-http
      url: ${ref:web.url}/mcp
      auth:
        kind: bearer
        tokenRef: mcp-auth-token
fileHandlers:
  - name: slide-file-handler
    title: Slide
    url: ${ref:web.url}/files/:id
    mimeTypes:
      - application/vnd.takos.slide+json
    extensions:
      - .takosslide
```

OIDC sign-in は `.takosumi/app.yml` の `identity.oidc@v1` AppBinding で宣言する
([`reference/app-yml-spec.md`](/reference/app-yml-spec) /
[`reference/binding-catalog.md`](/reference/binding-catalog) を参照)。

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

default app manifest / workflow は UI と `/mcp` を同じ worker に含めます。MCP
registry entry は bearer token ref を持ち、installer が worker-scoped secret env
を用意します。実装は `MCP_AUTH_TOKEN` が未設定、かつ
`MCP_ALLOW_UNAUTHENTICATED=true` が明示されていない場合に fail closed します。
Shape manifest の route surface は `/`、`/api`、`/mcp`、`/files/:id` を `web`
resource に向けます。`/api` は app session API と OIDC callback を含みます。
installer は generated secret を `APP_SESSION_SECRET` として materialize し、
`identity.oidc@v1` AppBinding の client/issuer env を
`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`OIDC_ISSUER_URL`、`OIDC_REDIRECT_URI`
として inject します。

## Storage との連携

takos-slide は app-layer storage grant から Takos Storage API の endpoint /
credential を受け取り、Storage API を呼び出して presentation file を読み書き
します。Takos managed deploy では `TAKOS_STORAGE_API_URL` /
`TAKOS_STORAGE_ACCESS_TOKEN` が materialize されます。

Storage UI から presentation file を開く場合は file handler metadata の
`/files/:id` route を使います。新規作成または保存する Takos presentation file は
`.takosslide` extension と `application/vnd.takos.slide+json` MIME type
を使う。既存 file を読む場合もこの MIME type を canonical contract として扱う。

API / UI / MCP request は `space_id` または `spaceId` query parameter を優先し、
指定がない場合は optional env `TAKOS_SPACE_ID` を default Storage space として
使う。どちらもない request は `space_id is required` として失敗する。

## Scopes

| scope       | 用途                                   |
| ----------- | -------------------------------------- |
| files:read  | kernel の Storage からファイル読み取り |
| files:write | kernel の Storage へファイル書き込み   |
| openid      | Takosumi Accounts OIDC sign-in         |
| profile     | ユーザープロフィール取得               |
| email       | メールアドレス取得                     |

## Resources

takos-slide の presentation storage は kernel の Storage に委譲する。app 自体の
generated secret resource として `slide-session-secret` を持ち、
`APP_SESSION_SECRET` に bind して cookie/session signing に使う。

## 参照

- [OIDC Consumer](/apps/oidc-consumer)
- [Takosumi Accounts](/architecture/takosumi-accounts)
- [Binding Catalog](/reference/binding-catalog)
