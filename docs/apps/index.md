# アプリ構成

> このページでわかること: Takos におけるアプリの種類と構成。

Takos では "app" という言葉が 2 つの意味で出ます。

| 呼び方      | 意味                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| Catalog App | Store / launcher / file handler / MCP など、Takos UI に出る product label。 |
| AppSpec     | `.takosumi.yml` で宣言され、operator account plane に install される単位。 |

1 つの AppSpec が、Takos UI 上では複数の launcher entry や file handler
を公開しても構いません。

## この章のページ

- [Install Paths](./install-paths.md) — Use Takos / Install from Git / Self-host
  の入口。
- [OIDC Consumer](./oidc-consumer.md) — Takos app が OIDC consumer
  として必要とする env / route。
- [MCP Server](./mcp.md) — Takos に MCP endpoint を公開する app の形。
- [File Handlers](./file-handlers.md) — file type と handler UI の接続。

## 関連する外部仕様

| 内容                    | 詳細ドキュメント                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Takosumi Installation Lifecycle   | [ecosystem platform docs](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)    |
| Installation ledger     | [Takosumi Cloud Installation docs](https://github.com/tako0614/takos-ecosystem/blob/main/takosumi-cloud/docs/architecture/app-installation.md) |
| `.takosumi.yml`         | [Takosumi AppSpec](https://takosumi.com/docs/reference/manifest)                              |
| Takosumi official type catalog | [Takosumi Official Type Catalog](https://takosumi.com/docs/reference/type-catalog) |
| AppSpec publish/listen  | [Takosumi AppSpec publish/listen](https://takosumi.com/docs/reference/manifest)               |
| launch token            | [Takosumi Cloud launch token docs](https://github.com/tako0614/takos-ecosystem/blob/main/takosumi-cloud/docs/ja/apps/launch-token.md) |
