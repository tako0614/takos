# File Handlers

> このページでわかること: app.yml でファイルハンドラーを登録する方法。

ファイルハンドラーを登録すると、特定の MIME type や拡張子のファイルをアプリで開けるようになります。

## 基本的な書き方

```yaml
fileHandlers:
  - name: markdown
    mimeTypes:
      - text/markdown
    extensions:
      - .md
    openPath: /files/:id
```

## 全フィールド

| field | required | 説明 |
| --- | --- | --- |
| `name` | yes | ファイルハンドラー名 |
| `mimeTypes` | yes | 対応する MIME type のリスト |
| `extensions` | yes | 対応するファイル拡張子のリスト |
| `openPath` | yes | ファイルを開く際のパス。`:id` がファイル ID に置換されます |

## 動作

ファイルハンドラーを登録すると:

1. 登録した MIME type / 拡張子のファイルが、アプリで開けるものとしてマークされます
2. ユーザーがファイルを開くと、`openPath` で指定したパスにリダイレクトされます
3. `:id` パラメータがファイルの ID に置換されます

## 複数ハンドラーの例

```yaml
fileHandlers:
  - name: markdown
    mimeTypes:
      - text/markdown
    extensions:
      - .md
    openPath: /files/:id
  - name: images
    mimeTypes:
      - image/png
      - image/jpeg
      - image/gif
    extensions:
      - .png
      - .jpg
      - .jpeg
      - .gif
    openPath: /viewer/:id
```

## 次のステップ

- [MCP Server](/apps/mcp) --- MCP Server の公開方法
- [アプリ開発](/apps/) --- app.yml の全体像
- [マニフェストリファレンス](/reference/manifest-spec) --- 全フィールドの一覧
