# AppSpec deployment lifecycle

> このページでわかること: `.takosumi.yml` から Installation / Deployment が作られる流れ。

必要な build は Installer API の前に build service / CI が実行し、prepared source archive を `source.kind=prepared`
として渡します。AppSpec は runtime intent と component 接続を表します。

Takos でアプリを追加・更新する入口は Git URL と ref です。Takosumi が source root の `.takosumi.yml` (= AppSpec)
を読み、Space に Installation を作り、apply ごとに Deployment を記録します。ユーザー向け docs では unmanaged な中間
manifest を案内しません。

## 入口

| 目的                                       | 入口                                                  | 所有者                                      |
| ------------------------------------------ | ----------------------------------------------------- | ------------------------------------------- |
| bundled / third-party app を install する  | `POST /v1/installations` または install UI            | Takosumi installer + operator account plane |
| Git URL から AppSpec を install する       | `takosumi install --source git:<url>#<ref>`           | Takosumi CLI                                |
| 既存 Installation に upgrade を apply する | `takosumi deploy <installation-id>`                   | Takosumi CLI                                |
| 過去 Deployment へ rollback する           | `takosumi rollback <installation-id> <deployment-id>` | Takosumi CLI                                |

Takos product は Web UI / public API / bundled app lifecycle を提供します。Git fetch、AppSpec
evaluation、operator-selected apply、Installation / Deployment record の保存は Takosumi 本体の責務です。build service は
prepared source を Installer API に渡す operator/CI 側の前段です。

## 流れ

1. app author は `.takosumi.yml` に `metadata`、 `components` (各 component の `kind` / `spec` / `publish` / `listen`)
   を書く
2. install dry-run で source identity、component changes、推定コスト、expected guard を確認する。git source は
   `expected.commit` + `expected.manifestDigest`、prepared source は `expected.sourceDigest` +
   `expected.manifestDigest`、local source は `expected.manifestDigest` を使う
3. user approval 後に `POST /v1/installations` で Installation を作成する
4. Takosumi が source を fetch し、AppSpec を evaluate し、operator-selected execution に apply を依頼する
5. Takosumi core が resolved source identity と manifest digest を Deployment に記録し、account plane が Installation projection を更新する
6. 以降の更新は `POST /v1/installations/{id}/deployments` で Deployment 履歴を append する

## 1 つの manifest

| ファイル        | 読む主体 | 役割                                                                                        |
| --------------- | -------- | ------------------------------------------------------------------------------------------- |
| `.takosumi.yml` | Takosumi | AppSpec (`apiVersion: v1`)。 metadata / components (`kind` / `spec` / `publish` / `listen`) |

AppSpec は 1 ファイルです。 source root の runtime intent と `publish` / `listen` declarations
はここに集約します。build command は build service / CI の convention に置きます。

## 関連ページ

- [Git / Store install](/deploy/store-deploy)
- [Takos AppSpec examples](/deploy/manifest)
- [環境変数](/deploy/environment)
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
