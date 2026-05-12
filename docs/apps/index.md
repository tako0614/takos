# アプリ構成

この章は Takos product から見た app の扱いを説明します。

Takos では "app" という言葉が 2 つの意味で出ます。

| 呼び方         | 意味                                                                        |
| -------------- | --------------------------------------------------------------------------- |
| App            | Store / launcher / file handler / MCP など、Takos UI に出る product label。 |
| InstallableApp | `.takosumi/app.yml` で宣言され、Takosumi Account に install される単位。    |

1 つの InstallableApp が、Takos UI 上では複数の App や file handler を公開しても構いません。

## この章のページ

- [Install Paths](./install-paths.md) — Use Takos / Install from Git / Self-host の入口。
- [OIDC Consumer](./oidc-consumer.md) — Takos app が OIDC consumer として必要とする env / route。
- [MCP Server](./mcp.md) — Takos に MCP endpoint を公開する app の形。
- [File Handlers](./file-handlers.md) — file type と handler UI の接続。

## 関連する外部仕様

| 内容                   | 正本                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Installable App Model  | [ecosystem platform docs](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)   |
| AppInstallation ledger | [ecosystem AppInstallation docs](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/app-installation.md) |
| `.takosumi/app.yml`    | [takosumi-git app.yml spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)            |
| binding kinds          | [ecosystem binding catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md)      |
| launch token           | [takosumi-cloud launch token docs](https://github.com/tako0614/takosumi-cloud/blob/master/docs/apps/launch-token.md)        |
| kernel manifest        | [takosumi manifest spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)                  |
