# AppSpec deployment lifecycle

> このページでわかること: `.takosumi.yml` から Installation / Deployment が作られる流れ。

Takos でアプリを追加・更新する入口は Git URL と ref です。Takosumi が source root の
`.takosumi.yml` (= AppSpec) を読み、Space に Installation を作り、apply ごとに Deployment を記録します。
ユーザー向け docs では unmanaged な中間 manifest を案内しません。

## 入口

| 目的 | 入口 | 所有者 |
| --- | --- | --- |
| bundled / third-party app を install する | `POST /v1/installations` または install UI | Takosumi installer + operator account plane |
| Git URL から AppSpec を install する | `takosumi install --source git:<url>#<ref>` | Takosumi CLI |
| 既存 Installation に upgrade を apply する | `takosumi deploy <installation-id>` | Takosumi CLI |
| 過去 Deployment へ rollback する | `takosumi rollback <installation-id> <deployment-id>` | Takosumi CLI |

Takos product は Web UI / public API / bundled app lifecycle を提供します。Git fetch、`component.build` 実行、
provider materialization、Installation / Deployment record の保存は Takosumi 本体の責務です。

## 流れ

1. app author は `.takosumi.yml` に `metadata`、 `components` (各 component の `publish` / `listen`)、 `interfaces`、 `permissions` を書く
2. install dry-run で source commit、component changes、推定コスト、`expected.commit` を確認する
3. user approval 後に `POST /v1/installations` で Installation を作成する
4. Takosumi が source を fetch し、必要な `component.build` を実行し、provider に materialize を依頼する
5. Installation ledger に source commit と manifest digest を pin し、最初の Deployment を記録する
6. 以降の更新は `POST /v1/installations/{id}/deployments` で Deployment 履歴を append する

## 1 つの manifest

| ファイル | 読む主体 | 役割 |
| --- | --- | --- |
| `.takosumi.yml` | Takosumi | AppSpec (`apiVersion: takosumi.dev/v1` / `kind: App`)。 metadata / components (`kind` / `publish` / `listen`) / interfaces / permissions |

AppSpec は 1 ファイルです。 source root にはこのファイルだけを置き、 build や namespace
pub/sub (`publish` / `listen`) もここに集約します。

## 関連ページ

- [Git / Store install](/deploy/store-deploy)
- [マニフェスト](/deploy/manifest)
- [環境変数](/deploy/environment)
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
