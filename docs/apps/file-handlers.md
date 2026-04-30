# File Handlers

特定の MIME type や拡張子のファイルを handler UI で開けるようにするには
`publish` で `type: takos.file-handler.v1` を宣言する。`takos.file-handler.v1`
catalog は deploy manifest の `publish` entry で管理します。

## 基本

```yaml
routes:
  - id: file-open
    target: web
    path: /files/:id

publish:
  - type: takos.file-handler.v1
    name: markdown
    display:
      title: Markdown
    outputs:
      url:
        kind: url
        routeRef: file-open
    spec:
      mimeTypes: [text/markdown]
      extensions: [.md]
```

ユーザーがファイルを開くと `outputs.url.routeRef` が参照する route にリダイレクトされる。`:id` が URL encode
されたファイル ID に置換される。`:id` は path segment として必須で、`:id`
を含まない `takos.file-handler.v1` publication は storage の handler catalog には出ない。current
storage UI は起動時に `space_id` query parameter も付ける。file ID を `file_id`
query parameter で渡す fallback はありません。

## 複数ハンドラー

```yaml
routes:
  - id: file-open
    target: web
    path: /files/:id
  - id: image-viewer
    target: web
    path: /viewer/:id

publish:
  - type: takos.file-handler.v1
    name: markdown
    display:
      title: Markdown
    outputs:
      url:
        kind: url
        routeRef: file-open
    spec:
      mimeTypes: [text/markdown]
      extensions: [.md]
  - type: takos.file-handler.v1
    name: image
    display:
      title: Images
    outputs:
      url:
        kind: url
        routeRef: image-viewer
    spec:
      mimeTypes: [image/png, image/jpeg, image/gif]
      extensions: [.png, .jpg, .jpeg, .gif]
```

`publish` に複数の `takos.file-handler.v1` entry を並べればよい。同一 manifest
内で publication 名は一意である必要があります。

## フィールド

route publication は core では generic object です。`takos.file-handler.v1`
を解釈する platform / app は `spec` 内で以下の field を使います。

| field             | required    | 説明                                                                               |
| ----------------- | ----------- | ---------------------------------------------------------------------------------- |
| `type`            | yes         | standard type 名 (`takos.file-handler.v1`)。canonical / legacy alias は [Publication types](/reference/glossary#publication-types) 参照 |
| `routeRef`        | yes         | 対応する `routes[].id`                                                             |
| `outputs`         | yes         | ファイルを開く route output (`:id` path segment が必須。ファイル ID に置換)        |
| `name`            | yes         | publication 名。storage UI の handler 表示名にも使われる                           |
| `display.title`   | no          | discovery metadata。storage API response には含まれるが、current UI 表示は `name`  |
| `spec.mimeTypes`  | conditional | 対応する MIME type のリスト (`mimeTypes` または `extensions` の最低 1 つが必須)    |
| `spec.extensions` | conditional | 対応するファイル拡張子のリスト (`mimeTypes` または `extensions` の最低 1 つが必須) |

`outputs.*.routeRef` は `routes[].id` を参照します。route publication の output `url`
は group の auto hostname とこの route から生成され、`:id` などの template segment は
template URL のまま consumer に渡ります。storage の file handler discovery は
`:id` path segment を含む handler だけを返します。current storage UI はこの
template URL の `:id` を file ID に置換し、`space_id` query parameter を追加して
開きます。handler 側は path segment の file ID を primary contract として扱い、
必要なら `space_id` を補助情報として読めます。

## Publication の仕組み

kernel は多くの `type` の意味を解釈しない。`takos.file-handler.v1` は platform /
app が解釈する standard route publication type です。`takos.file-handler.v1`
を理解するのは利用する側（agent runtime や storage UI 等）の役割。`publish` は
generic plugin resolver ではなく、manifest で宣言した route metadata の catalog
です。

他の primitive が file handler を使うには、その publication を `consume` するか、
既存の storage endpoint (`GET /api/spaces/:spaceId/storage/file-handlers`)
から参照します。この endpoint は manifest publication catalog を参照して handler
を選択します。kernel は未参照の publication を自動で space 全体へ inject
しません。control plane API で `takos.file-handler.v1` route publication を直接
作る運用は推奨しません。

## Discovery API selection ranking

`GET /api/spaces/:spaceId/storage/file-handlers?mime=...&ext=...` で複数の
handler が match した場合、以下の order で sort される (rank 0 が最優先):

| rank | 条件                             |
| ---- | -------------------------------- |
| 0    | mime + ext 両方が exact match    |
| 1    | mime のみ match (ext 不問)       |
| 2    | extension のみ match (mime 不問) |
| 3    | filter 無し (no params)          |

同 rank 内では declaration order (DB 登録順、`created_at ASC`) で tie-break。

## 次のステップ

- [MCP Server](/apps/mcp) --- MCP Server の公開方法
- [Deploy Manifest](/apps/manifest) --- `.takos/app.yml` の全体像
