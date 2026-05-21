# デプロイ

> このページでわかること: Takos にアプリをデプロイする方法の全体像。

> **Wave N planned (2026-05-21 RFC stage)**: 本ドキュメント以下の deploy guide
> で説明する `component.build` と curated 4 kind catalog は、 takosumi Wave N で
> 削除予定 (= kernel pure contract executor 化、 build は別 `kind: build`
> component に移管、 specific kind は operator distribution が JSON-LD + plugin
> で持ち込む)。 詳細 design は takosumi
> [RFC 0001](https://takosumi.com/docs/rfc/0001-kernel-kind-agnostic) を参照。

アプリのデプロイは Git URL と ref を指定して始めます。 Takosumi が source root
の `.takosumi.yml` (= AppSpec) を読み、 Space に Installation を作り、 apply
ごとに Deployment を記録します。

## 使う入口

| 目的                                       | 入口                                        | 所有者                                                          |
| ------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------- |
| bundled / third-party app を install する  | `POST /v1/installations` または install UI  | Takosumi (kernel installer) + operator account plane (Accounts) |
| Git URL から AppSpec を install する       | `takosumi install --source git:<url>#<ref>` | Takosumi CLI                                                    |
| 既存 Installation に upgrade を apply する | `takosumi deploy <installation-id>`         | Takosumi CLI                                                    |
| 過去 Deployment へ rollback する           | `takosumi rollback <inst-id> <deploy-id>`   | Takosumi CLI                                                    |

Takos product は Web UI / public API / bundled app lifecycle を提供します。 Git
fetch、 component.build 実行、 provider materialize、 Installation / Deployment
record の persist は Takosumi 本体の責務です。

## デプロイの流れ

1. app author は `.takosumi.yml` に metadata、 components (各 component の
   `publish` / `listen`)、 permissions を書く
2. install dry-run で source commit、 changes、 推定コスト、 expected.commit
   を確認する
3. user approval 後に `POST /v1/installations` で Installation を作成
4. Takosumi が source を fetch、 `component.build` を実行、 provider plugin で
   resource を materialize
5. Installation ledger に source commit と manifest digest を pin し、 最初の
   Deployment を記録
6. 以降の更新は `POST /v1/installations/{id}/deployments` で Deployment 履歴を
   append

## 1 つの manifest

| ファイル        | 読む主体 | 役割                                                                               |
| --------------- | -------- | ---------------------------------------------------------------------------------- |
| `.takosumi.yml` | Takosumi | AppSpec (`apiVersion: v1`)。 metadata / components (`kind` / `publish` / `listen`) |

AppSpec は 1 ファイルです。 source root にはこのファイルだけを置き、 build や
namespace pub/sub (`publish` / `listen`) もここに集約します。

## 関連ページ

- [Git / Store install](/deploy/store-deploy)
- [AppSpec deployment lifecycle](/deploy/deploy)
- [マニフェスト](/deploy/manifest)
- [環境変数](/deploy/environment)
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
