# takos-excel

> このページでわかること: バンドルアプリ takos-excel の概要。

Google Sheets のようなスプレッドシートエディタです。

## 役割

- スプレッドシートの作成・編集
- セル操作・範囲操作・書式設定
- 数式の評価・計算
- CSV / JSON エクスポート
- source tree の standalone MCP server で 26 tools を提供
- app metadata でスプレッドシート UI / MCP / file handler を提供
- group に所属しなくても動作可能

## Takosumi 上での動作

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

takos-excel は app-layer storage grant から Takos Storage API の endpoint と
credential を受け取り、Storage API を呼び出してスプレッドシートファイルを
読み書きします。managed Takos installation では `TAKOS_STORAGE_API_URL` と
`TAKOS_STORAGE_ACCESS_TOKEN` が自動的に渡されます。

Storage UI からスプレッドシートファイルを開くときは、file handler metadata
の `/files/:id` route を使います。新規作成・保存するファイルは `.takossheet`
拡張子と `application/vnd.takos.excel+json` MIME type を使います。

API / UI / MCP リクエストは `space_id` または `spaceId` query parameter を
優先します。指定がなければ env `TAKOS_SPACE_ID` をデフォルト Storage space
として使い、どちらもない場合は `space_id is required` エラーになります。

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

## リソース

スプレッドシートのストレージは kernel Storage に委譲します。アプリ自身が持つ
リソースは `excel-session-secret` 1 つだけで、`APP_SESSION_SECRET` に bind
して cookie / session 署名に使います。

## 参照

- [OIDC Consumer](/apps/oidc-consumer)
- [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
- [Binding Catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md)
