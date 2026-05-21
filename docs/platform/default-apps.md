# バンドルアプリ

> このページでわかること: 新しい Space
> に自動インストールされるアプリの一覧と仕組み。

> **Wave N planned (2026-05-21 RFC stage)**: 本動作原理に含まれる
> `components.<name>.build` artifact 生成 step は takosumi Wave N で削除予定 (=
> kernel pure contract executor 化、 build は別 `kind: build` component に移管、
> artifact は namespace pub/sub 経由で consumer に届く)。 詳細 design は
> takosumi [RFC 0001](https://takosumi.com/docs/rfc/0001-kernel-kind-agnostic)
> を参照。

バンドルアプリは、新しい Space
を作成したときに自動的にインストールされるアプリです。 通常のアプリと同じ仕組み
(Installation) で管理されるため、不要ならアンインストールできます。

## 定義

**bundled apps (= Takosumi installer 経由で 新 Space 作成時 auto-install される
5 product)** は、 Takos distribution と一緒に ship される 1st-party app
集合です。 通常の Installation entry として記録され、 user は不要なら
uninstall できます。 default set に含まれても kernel primitive や group が
特権化されるわけではなく、 third-party app と同じ install lifecycle を通ります。

canonical 5 bundled apps:

- **takos-docs** — リッチテキストエディタ
- **takos-slide** — プレゼンテーション
- **takos-excel** — スプレッドシート
- **takos-computer** — browser automation / sandbox computer
- **yurucommu** — ActivityPub / community social

Takos product の core feature (Agent / Chat / Git / Storage / Store) は
bundled app distribution には **含まれません** (= Takos product の shell が
直接 host する内部 service、 個別 Installation として記録されない)。 これは
「bundled app」 (= AppSpec で declare、 Installation として記録される 1 app)
と 「Takos product core feature」 (= Takos product shell の内部 service)
の layer 区別です。

## 一覧

| app                                        | 既定 ref     | 役割                                  | 主な component / namespace listen                                       |
| ------------------------------------------ | ------------ | ------------------------------------- | ----------------------------------------------------------------------- |
| [takos-docs](/platform/takos-docs)         | `v0.1.2` tag | リッチテキストエディタ                | launcher / MCP / file handler / object-store / `operator.identity.oidc` |
| [takos-excel](/platform/takos-excel)       | `v0.1.2` tag | スプレッドシート                      | launcher / MCP / file handler / object-store / `operator.identity.oidc` |
| [takos-slide](/platform/takos-slide)       | `v0.1.2` tag | プレゼンテーション                    | launcher / MCP / file handler / object-store / `operator.identity.oidc` |
| [takos-computer](/platform/takos-computer) | `v2.1.2` tag | browser automation / sandbox computer | launcher / MCP / sandbox runtime / `operator.identity.oidc`             |
| [yurucommu](/platform/yurucommu)           | `v1.2.6` tag | ActivityPub / community social        | postgres / object-store / `operator.identity.oidc`                      |

## 動作原理

1. Space 作成時に bundled app entry の Git URL / ref を解決する
2. takosumi-cloud (operator account plane / リファレンス実装: Takosumi Accounts)
   が Installation を作成する
3. `POST /v1/installations` が source ref を commit に pin する
4. `.takosumi.yml` から namespace pub/sub (`publish` / `listen`) / grant /
   permission dry-run を作る
5. `components.<name>.build` が必要な artifact を作る
6. Takosumi kernel が Deployment record と provider outputs を記録する
7. Installation ledger に source commit / AppSpec digest / Deployment evidence
   を記録する

bundled app も third-party app と同じ install lifecycle を通ります。default set
に含まれても kernel primitive や group が特権化されるわけではありません。

## Office file contracts

office 系 bundled apps は Storage の file handler registry に登録されます。

| app         | route        | extension     | MIME type                          |
| ----------- | ------------ | ------------- | ---------------------------------- |
| takos-docs  | `/files/:id` | `.takosdoc`   | `application/vnd.takos.docs+json`  |
| takos-excel | `/files/:id` | `.takossheet` | `application/vnd.takos.excel+json` |
| takos-slide | `/files/:id` | `.takosslide` | `application/vnd.takos.slide+json` |

launcher / MCP / file handler metadata は Takos app catalog / runtime registry
の surface です。kernel manifest の field ではありません。

## Operator overrides

Product distribution profile は `defaultApps.entries` に repository ref
を持ちます。 operator は環境ごとに preinstall 対象を選べます。

| env                                          | 説明                                                           |
| -------------------------------------------- | -------------------------------------------------------------- |
| `TAKOS_DEFAULT_APPS_PREINSTALL`              | `false` のときだけ bundled app preinstall を止める kill switch |
| `TAKOS_DEFAULT_APP_INSTALL_URL`              | Takosumi installer の `POST /v1/installations` endpoint        |
| `TAKOS_DEFAULT_APP_INSTALL_TOKEN`            | install endpoint の bearer token                               |
| `TAKOS_DEFAULT_APP_INSTALL_SUBJECT`          | Accounts ledger の `createdBySubject`                          |
| `TAKOS_DEFAULT_APP_INSTALL_ACCOUNT_ID`       | install apply request の account override                      |
| `TAKOS_DEFAULT_APP_INSTALL_MODE`             | optional runtime mode                                          |
| `TAKOS_DEFAULT_APP_INSTALL_RUNTIME_BASE_URL` | optional runtime base URL                                      |

## Related

- [Install Paths](/apps/install-paths)
- [Store](/platform/store)
- [Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md)
