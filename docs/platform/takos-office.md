# takos-office

takos-office は、docs・slide・sheet の 3 つのエディタを 1 つの worker に統合した
office suite の Capsule アプリです。Workspace に install すると、ドキュメントの作成・
編集が自分の環境で行え、agent は MCP 経由でファイルを直接編集できます。

## 提供するもの

- `/docs`、`/slide`、`/sheet` の 3 つのエディタ UI と、それらを束ねる unified worker
- `.docx` / `.pptx` / `.xlsx` の import とダウンロード
- agent から 3 エディタを操作できる 1 つの MCP endpoint (`/mcp`)
- file handler の公開 — Workspace のファイルを対応エディタで開ける

## 依存するもの

ファイルの保存先は takos-office 自身ではなく、別途 install した `takos-storage`
Capsule が提供する `storage.object` です。bind 時に Takosumi が
`OBJECT_STORAGE_API_URL`、prefix 限定の bearer (`OBJECT_STORAGE_ACCESS_TOKEN`)、
割り当てられた object prefix を注入します。

## 次に読む

- [takos-office repository](https://github.com/tako0614/takos-office)
- [office.takos.jp](https://office.takos.jp/)
- [Bundled Apps](/platform/featured-apps)
- [ファイルを開くアプリ](/apps/file-handlers)
