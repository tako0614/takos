# ファイルを開くアプリ

install したアプリは、Workspace 内の特定のファイル種別を開いたり編集したりする
file handler を提供できます。Takos はこれを Takos 固有の manifest ではなく、
Capsule の output projection を通じて発見します。

## 見つかるまでの流れ

1. アプリを Git から Capsule として install し、Takosumi の plan を確認して apply する。
2. アプリが `interface.file.handler` のような capability として、非 secret の
   service metadata を公開する。
3. Takos は bind された export を読み、Workspace 内で対応するファイルに
   その handler を表示する。
4. 実行に必要な権限は、OpenTofu の output 値ではなく deploy された
   runtime / account-plane の境界から供給される。

たとえば takos-office は `.docx` / `.pptx` / `.xlsx` の handler を公開し、
Workspace のファイルを対応するエディタで開けます。

## 次に読む

- [takos-office](/platform/takos-office) — handler を公開する first-party アプリ
- [インストール方法](/apps/install-paths)
- [ツールと接続](/apps/mcp)
