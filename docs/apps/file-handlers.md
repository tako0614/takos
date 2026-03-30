# File Handlers

特定の MIME type や拡張子のファイルをアプリで開けるようにする。

## 基本

```yaml
fileHandlers:
  - name: markdown
    mimeTypes: [text/markdown]
    extensions: [.md]
    openPath: /files/:id
```

ユーザーがファイルを開くと `openPath` にリダイレクトされる。`:id` がファイル ID に置換される。

## 複数ハンドラー

```yaml
fileHandlers:
  - name: markdown
    mimeTypes: [text/markdown]
    extensions: [.md]
    openPath: /files/:id
  - name: images
    mimeTypes: [image/png, image/jpeg, image/gif]
    extensions: [.png, .jpg, .jpeg, .gif]
    openPath: /viewer/:id
```

## フィールド

| field | required | 説明 |
| --- | --- | --- |
| `name` | yes | ファイルハンドラー名 |
| `mimeTypes` | yes | 対応する MIME type のリスト |
| `extensions` | yes | 対応するファイル拡張子のリスト |
| `openPath` | yes | ファイルを開く際のパス (`:id` がファイル ID に置換) |

## 次のステップ

- [MCP Server](/apps/mcp) --- MCP Server の公開方法
- [マニフェスト](/apps/manifest) --- app.yml の全体像
