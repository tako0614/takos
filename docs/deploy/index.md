# デプロイ

> このページでわかること: Takos にアプリをデプロイする方法の全体像。

build が必要なアプリは、Installer API の前に build service / CI が prepared source archive を作ります。AppSpec は
runtime intent、component kind、`publish` / `listen` の接続を表します。

アプリのデプロイは Git URL と ref を指定して始めます。 Takosumi が source root の `.takosumi.yml` (= AppSpec) を読み、
Space に Installation を作り、 apply ごとに Deployment を記録します。

## 使う入口

| 目的                                       | 入口                                        | 所有者                                                          |
| ------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------- |
| bundled / third-party app を install する  | `POST /v1/installations` または install UI  | Takosumi (kernel installer) + operator account plane (Accounts) |
| Git URL から AppSpec を install する       | `takosumi install --source git:<url>#<ref>` | Takosumi CLI                                                    |
| 既存 Installation に upgrade を apply する | `takosumi deploy <installation-id>`         | Takosumi CLI                                                    |
| 過去 Deployment へ rollback する           | `takosumi rollback <inst-id> <deploy-id>`   | Takosumi CLI                                                    |

Takos product は Web UI / public API / bundled app lifecycle を提供します。 Git fetch、AppSpec
evaluation、operator-selected apply、Installation / Deployment record の persist は Takosumi 本体の責務です。build
service は prepared source を Installer API に渡す operator/CI 側の前段です。

## デプロイの流れ

1. app author は `.takosumi.yml` に metadata、 components (各 component の `kind` / `spec` / `publish` / `listen`)
   を書く
2. install dry-run で source identity、 changes、推定コスト、 expected guard を確認する。git source は
   `expected.commit` + `expected.manifestDigest`、 prepared source は `expected.sourceDigest` +
   `expected.manifestDigest`、local source は `expected.manifestDigest` を使う
3. user approval 後に `POST /v1/installations` で Installation を作成
4. Takosumi が source を fetch、AppSpec を evaluate、operator-selected execution で apply
5. Takosumi core が resolved source identity と manifest digest を Deployment に記録し、account plane が Installation projection を更新
6. 以降の更新は `POST /v1/installations/{id}/deployments` で Deployment 履歴を append

## 1 つの manifest

| ファイル        | 読む主体 | 役割                                                                                        |
| --------------- | -------- | ------------------------------------------------------------------------------------------- |
| `.takosumi.yml` | Takosumi | AppSpec (`apiVersion: v1`)。 metadata / components (`kind` / `spec` / `publish` / `listen`) |

AppSpec は 1 ファイルです。 source root の runtime intent と `publish` / `listen` declarations
はここに集約します。build command は build service / CI の convention に置きます。

## 関連ページ

- [Git / Store install](/deploy/store-deploy)
- [AppSpec deployment lifecycle](/deploy/deploy)
- [Takos AppSpec examples](/deploy/manifest)
- [環境変数](/deploy/environment)
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
