# takos-excel

Google Sheets alternative のスプレッドシートエディタ。default app distribution
metadata を持つが、primitive や group は特権化されない。

## 役割

- スプレッドシートの作成・編集
- セル操作・範囲操作・書式設定
- 数式の評価・計算
- CSV / JSON エクスポート
- source tree の standalone MCP server で 26 tools を提供
- UiSurface でスプレッドシート UI を提供
- group に所属しなくても動作可能

## Takos 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

例: `team-a-my-excel.app.example.com` or `sheets.mycompany.com`

single worker (web) 構成。

```text
{hostname}
  /     → built frontend / static asset surface (deployment mount)
```

## Publications

`path: /` は built frontend / static asset surface の mount point を表し、server
entrypoint 自体の root route を意味しない。

```yaml
publish:
  - name: excel-ui
    type: UiSurface
    publisher: web
    path: /
    title: Excel
```

`UiSurface` は custom route publication type であり、deploy manifest の
`publish` entry で catalog を管理します。source tree には standalone MCP server
もあるが、現在の default deploy workflow artifact には含めない。

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

default app manifest / workflow は UI の built frontend / static asset surface
だけを publish する。source tree の standalone MCP server は同じ app source に
含まれるが、現在の default deploy surface では MCP / health route
として公開しない。 `/` を UI 直下として扱うのは deployment
側の責務で、entrypoint そのものの責務ではない。

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
