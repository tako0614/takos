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
    mimeTypes: [text/markdown]
    extensions: [.md]
    path: /files/:id
  - type: FileHandler
    mimeTypes: [image/png, image/jpeg, image/gif]
    extensions: [.png, .jpg, .jpeg, .gif]
    path: /viewer/:id
```

`publish` に複数の `FileHandler` を並べればよい。

## フィールド

publication は generic object であり固定の schema はないが、`FileHandler` では以下の field を使う。

| field | required | 説明 |
| --- | --- | --- |
| `type` | yes | `FileHandler` 固定 |
| `mimeTypes` | yes | 対応する MIME type のリスト |
| `extensions` | yes | 対応するファイル拡張子のリスト |
| `path` | yes | ファイルを開く際の path (`:id` がファイル ID に置換) |

`path` は app のルートからの相対 path。

## Publication の仕組み

kernel は `type` の意味を解釈しない。
`FileHandler` を理解するのは利用する側（takos-agent 等）の役割。

他の app が FileHandler を発見するには、deploy 時に kernel が注入する環境変数を使います。
kernel は `publish` で宣言された情報を、**space 内のすべての group の env に inject** します（scoping や dependency declaration なし）。

## 次のステップ

- [MCP Server](/apps/mcp) --- MCP Server の公開方法
- [マニフェスト](/apps/manifest) --- app.yml の全体像
