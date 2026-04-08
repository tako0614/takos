# File Handlers

特定の MIME type や拡張子のファイルをアプリで開けるようにするには `publish` で `type: FileHandler` を宣言する。

## 基本

```yaml
publish:
  - type: FileHandler
    mimeTypes: [text/markdown]
    extensions: [.md]
    path: /files/:id
```

ユーザーがファイルを開くと `path` にリダイレクトされる。`:id` がファイル ID に置換される。

## 複数ハンドラー

```yaml
publish:
  - type: FileHandler
    name: markdown
    mimeTypes: [text/markdown]
    extensions: [.md]
    path: /files/:id
  - type: FileHandler
    name: image
    mimeTypes: [image/png, image/jpeg, image/gif]
    extensions: [.png, .jpg, .jpeg, .gif]
    path: /viewer/:id
```

`publish` に複数の `FileHandler` を並べればよい。同 group + 同 type の publication が複数ある場合、`name` field が **required** (これにより env 名 `TAKOS_*_*_*_URL` が一意になる)。

## フィールド

publication は generic object であり固定の schema はないが、`FileHandler` では以下の field を使う。

| field | required | 説明 |
| --- | --- | --- |
| `type` | yes | `FileHandler` 固定 |
| `mimeTypes` | conditional | 対応する MIME type のリスト (`mimeTypes` または `extensions` の最低 1 つが必須) |
| `extensions` | conditional | 対応するファイル拡張子のリスト (`mimeTypes` または `extensions` の最低 1 つが必須) |
| `path` | yes | ファイルを開く際の path (`:id` がファイル ID に置換) |
| `name` | conditional | 同 group + 同 type の publication が複数ある場合 required |

`path` は app のルートからの相対 path。

## Publication の仕組み

kernel は `type` の意味を解釈しない。
`FileHandler` を理解するのは利用する側（takos-agent 等）の役割。

他の app が FileHandler を発見するには、deploy 時に kernel が注入する環境変数を使います。
kernel は `publish` で宣言された情報を、**space 内のすべての group の env に inject** します（scoping や dependency declaration なし）。

## Discovery API selection ranking

`GET /api/spaces/:spaceId/storage/file-handlers?mime=...&ext=...` で複数の handler が match した場合、以下の order で sort される (rank 0 が最優先):

| rank | 条件 |
|---|---|
| 0 | mime + ext 両方が exact match |
| 1 | mime のみ match (ext 不問) |
| 2 | extension のみ match (mime 不問) |
| 3 | filter 無し (no params) |

同 rank 内では declaration order (DB 登録順、`created_at ASC`) で tie-break。

## 次のステップ

- [MCP Server](/apps/mcp) --- MCP Server の公開方法
- [マニフェスト](/apps/manifest) --- app.yml の全体像
