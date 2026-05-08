# takos-excel

Google Sheets alternative のスプレッドシートエディタ。default app distribution
metadata を持つが、primitive や group は特権化されない。

## 役割

- スプレッドシートの作成・編集
- セル操作・範囲操作・書式設定
- 数式の評価・計算
- CSV / JSON エクスポート
- source tree の standalone MCP server で 26 tools を提供
- app metadata でスプレッドシート UI / MCP / file handler を提供
- group に所属しなくても動作可能

## Takos 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

例: `team-a-my-excel.app.example.com` or `sheets.mycompany.com`

single worker (web) 構成。

```text
{hostname}
  /                         → built frontend / static asset surface (deployment mount)
  /api                      → app API, OIDC callback, session routes
  /api/auth/callback        → OIDC callback (Takosumi Accounts 経由)。詳細: [OIDC Consumer](/apps/oidc-consumer)
  /mcp                      → Excel MCP server (streamable HTTP)
  /files/:id                → Storage file handler open route
```

## App Metadata And Bindings

launcher / MCP / file handler は kernel manifest の `publications[]` ではなく、
Takos app catalog / runtime registry の metadata として登録します。workload
自体は `.takosumi/manifest.yml` の Shape resource で deploy します。

```yaml
launcher:
  name: excel-ui
  title: Excel
  url: ${ref:web.url}/
mcp:
  endpoints:
    - name: excel-mcp
      title: Excel MCP
      transport: streamable-http
      url: ${ref:web.url}/mcp
      auth:
        kind: bearer
        tokenRef: mcp-auth-token
fileHandlers:
  - name: excel-file-handler
    title: Excel
    url: ${ref:web.url}/files/:id
    mimeTypes:
      - application/vnd.takos.excel+json
    extensions:
      - .takossheet
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

takos-excel は app-layer storage grant から Takos Storage API の endpoint /
credential を受け取り、Storage API を呼び出して spreadsheet file を読み書き
します。Takos managed deploy では `TAKOS_STORAGE_API_URL` /
`TAKOS_STORAGE_ACCESS_TOKEN` が materialize されます。

Storage UI から spreadsheet file を開く場合は file handler metadata の
`/files/:id` route を使います。新規作成または保存する Takos spreadsheet file は
`.takossheet` extension と `application/vnd.takos.excel+json` MIME type
を使う。既存 file を読む場合もこの MIME type を canonical contract として扱う。

API / UI / MCP request は `space_id` または `spaceId` query parameter を優先し、
指定がない場合は optional env `TAKOS_SPACE_ID` を default Storage space として
使う。どちらもない request は `space_id is required` として失敗する。

## MCP tools

| tool                          | 内容                   |
| ----------------------------- | ---------------------- |
| sheet_list                    | シート一覧             |
| sheet_create                  | シート作成             |
| sheet_get                     | シート取得             |
| sheet_delete                  | シート削除             |
| sheet_set_title               | タイトル変更           |
| sheet_add_tab                 | タブ追加               |
| sheet_remove_tab              | タブ削除               |
| sheet_rename_tab              | タブ名変更             |
| sheet_get_cell                | セル取得               |
| sheet_set_cell                | セル書き込み           |
| sheet_get_range               | 範囲取得               |
| sheet_set_range               | 範囲書き込み           |
| sheet_clear_range             | 範囲クリア             |
| sheet_format_cell             | セル書式設定           |
| sheet_format_range            | 範囲書式設定           |
| sheet_evaluate                | 数式評価               |
| sheet_get_computed            | 計算済み値取得         |
| sheet_set_column_width        | 列幅設定               |
| sheet_set_row_height          | 行高設定               |
| sheet_screenshot              | スクリーンショット     |
| sheet_import_csv              | CSV インポート         |
| sheet_export_csv              | CSV エクスポート       |
| sheet_export_json             | JSON エクスポート      |
| sheet_add_conditional_rule    | 条件付き書式ルール追加 |
| sheet_remove_conditional_rule | 条件付き書式ルール削除 |
| sheet_list_conditional_rules  | 条件付き書式ルール一覧 |

## Scopes

| scope       | 用途                                   |
| ----------- | -------------------------------------- |
| files:read  | kernel の Storage からファイル読み取り |
| files:write | kernel の Storage へファイル書き込み   |
| openid      | Takosumi Accounts OIDC sign-in         |
| profile     | ユーザープロフィール取得               |
| email       | メールアドレス取得                     |

## Resources

takos-excel の spreadsheet storage は kernel の Storage に委譲する。app 自体の
generated secret resource として `excel-session-secret` を持ち、
`APP_SESSION_SECRET` に bind して cookie/session signing に使う。

## 参照

- [OIDC Consumer](/apps/oidc-consumer)
- [Takosumi Accounts](/architecture/takosumi-accounts)
- [Binding Catalog](/reference/binding-catalog)
