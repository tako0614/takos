# Bundled App Distribution

Takos の bundled app distribution は、新規 Space 作成時に提示または自動 install
する app 候補の初期セットです。install は Takosumi Accounts の AppInstallation
API と `takosumi-git` installer pipeline を通ります。

## 一覧

| app | 既定 ref | 役割 | 主な bindings |
| --- | --- | --- | --- |
| [takos-docs](/platform/takos-docs) | `v0.1.2` tag | リッチテキストエディタ | launcher / MCP / file handler / storage grant |
| [takos-excel](/platform/takos-excel) | `v0.1.2` tag | スプレッドシート | launcher / MCP / file handler / storage grant |
| [takos-slide](/platform/takos-slide) | `v0.1.2` tag | プレゼンテーション | launcher / MCP / file handler / storage grant |
| [takos-computer](/platform/takos-computer) | `v2.1.2` tag | browser automation / sandbox computer | launcher / MCP / sandbox runtime / Takos API grant |
| [yurucommu](/platform/yurucommu) | `v1.2.6` tag | ActivityPub / community social | `identity.oidc@v1` / DB / object-store / queue |

Agent、Chat、Git、Storage、Store は Takos product の core feature であり、
bundled app distribution には含めません。

## 動作原理

1. Space 作成時に bundled app entry の Git URL / ref を解決する
2. Takosumi Accounts が AppInstallation を作成する
3. `takosumi-git install apply` が source ref を commit に pin する
4. `.takosumi/app.yml` から binding / grant / permission preview を作る
5. `.takosumi/manifest.yml` と workflow artifact を compile する
6. compiled manifest を Takosumi kernel に apply する
7. AppInstallation ledger に source commit / app manifest digest / compiled manifest digest を記録する

bundled app も third-party app と同じ install lifecycle を通ります。default set
に含まれても kernel primitive や group が特権化されるわけではありません。

## Office file contracts

office 系 bundled apps は Storage の file handler registry に登録されます。

| app | route | extension | MIME type |
| --- | --- | --- | --- |
| takos-docs | `/files/:id` | `.takosdoc` | `application/vnd.takos.docs+json` |
| takos-excel | `/files/:id` | `.takossheet` | `application/vnd.takos.excel+json` |
| takos-slide | `/files/:id` | `.takosslide` | `application/vnd.takos.slide+json` |

launcher / MCP / file handler metadata は Takos app catalog / runtime registry の
surface です。kernel manifest の field ではありません。

## Operator overrides

Product distribution profile は `defaultApps.entries` に repository ref を持ちます。
operator は環境ごとに preinstall 対象を選べます。

| env | 説明 |
| --- | --- |
| `TAKOS_DEFAULT_APPS_PREINSTALL` | bundled app preinstall の opt-in |
| `TAKOS_DEFAULT_APP_INSTALL_APPLY_URL` | `takosumi-git serve` の install apply endpoint |
| `TAKOS_DEFAULT_APP_INSTALL_APPLY_TOKEN` | install apply endpoint の bearer token |
| `TAKOS_DEFAULT_APP_INSTALL_SUBJECT` | Accounts ledger の `createdBySubject` |
| `TAKOS_DEFAULT_APP_INSTALL_ACCOUNT_ID` | install apply request の account override |
| `TAKOS_DEFAULT_APP_INSTALL_MODE` | optional runtime mode |
| `TAKOS_DEFAULT_APP_INSTALL_RUNTIME_BASE_URL` | optional runtime base URL |

## Related

- [Install Paths](/apps/install-paths)
- [Store](/platform/store)
- [Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md)
