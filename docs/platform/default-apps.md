# バンドルアプリ

> このページでわかること: 新しい Space
> に自動インストールされるアプリの一覧と仕組み。

バンドルアプリは、新しい Space
を作成したときに自動的にインストールされるアプリです。通常のアプリと同じ仕組み
(Installation) で管理されるため、不要ならアンインストールできます。

## 定義

**bundled apps (= Takosumi installer 経由で新 Space 作成時 auto-install される 5
product)** は、 Takos distribution と一緒に ship される 1st-party app
集合です。通常の Installation entry として記録され、 user は不要なら uninstall
できます。 default set に含まれても kernel primitive や group
が特権化されるわけではなく、 third-party app と同じ install lifecycle
を通ります。

canonical 5 bundled apps:

- **takos-docs** —リッチテキストエディタ
- **takos-slide** —プレゼンテーション
- **takos-excel** —スプレッドシート
- **takos-computer** — browser automation / sandbox computer
- **yurucommu** — ActivityPub / community social

Takos product の core feature (Agent / Chat / Git / Storage / Store) は bundled
app distribution には **含まれません** (= Takos product の shell が直接 host
する内部 service、個別 Installation として記録されない)。これは「bundled app」
(= AppSpec で declare、 Installation として記録される 1 app) と「Takos product
core feature」 (= Takos product shell の内部 service) の layer 区別です。

## 一覧

| app                                        | 既定 ref     | 役割                                  | AppSpec component / listen                    | Takos metadata                |
| ------------------------------------------ | ------------ | ------------------------------------- | --------------------------------------------- | ----------------------------- |
| [takos-docs](/platform/takos-docs)         | `v0.1.2` tag | リッチテキストエディタ                | worker / gateway / object-store / OIDC listen | launcher / MCP / file handler |
| [takos-excel](/platform/takos-excel)       | `v0.1.2` tag | スプレッドシート                      | worker / gateway / object-store / OIDC listen | launcher / MCP / file handler |
| [takos-slide](/platform/takos-slide)       | `v0.1.2` tag | プレゼンテーション                    | worker / gateway / object-store / OIDC listen | launcher / MCP / file handler |
| [takos-computer](/platform/takos-computer) | `v2.1.2` tag | browser automation / sandbox computer | worker / sandbox runtime / OIDC listen        | launcher / MCP                |
| [yurucommu](/platform/yurucommu)           | `v1.2.6` tag | ActivityPub / community social        | web / postgres / object-store / OIDC listen   | launcher                      |

## 動作原理

1. Space 作成時に bundled app entry の Git URL / ref を解決する
2. build が必要な source は build service / CI が prepared source archive にする
3. takosumi-cloud (operator account plane / リファレンス実装: Takosumi Accounts)
   が Installation を作成する
4. `POST /v1/installations` が source ref または prepared archive payload
   `source.digest` を pin し、dry-run 後の apply は `expected.sourceDigest` /
   `expected.manifestDigest` で source bytes と AppSpec bytes を guard する
5. `.takosumi.yml` から AppSpec `publish` / `listen` と binding material の
   dry-run を作る
6. Takosumi kernel が Deployment record と public non-secret outputs を記録する
7. retained implementation/operator evidence を参照しながら、account plane が
   Installation projection を更新する

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
の surface です。Deployment output の public endpoint publication と runtime
path を 参照します。

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
