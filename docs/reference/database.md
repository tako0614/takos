# データベース所有権

> このページでわかること: どのプロダクトがどのデータを所有しているか。

## 所有関係

| データ領域             | 所有者                  | 備考                                                                               |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| account identity       | Takosumi Accounts       | user / organization / OIDC subject / account profile                               |
| billing                | Takosumi Accounts       | BillingPort / Stripe customer マッピング                                           |
| Installation ledger    | Takosumi Accounts       | source identity / app plan snapshot digest / retained evidence refs / grants / bindings |
| deployment 記録        | Takosumi kernel         | Deployment / activation pointer / provider observation / operation journal         |
| Git リポジトリ         | Takos Git hosting       | リポジトリ metadata / refs / object storage 参照                                   |
| agent run              | Takos agent / Takos app | プロダクト agent ワークフロー状態                                                  |
| app-local プロファイル | Takos app               | Takos UI プロファイルとプロダクトローカル設定                                      |
| bundled app データ     | 各 bundled app          | docs / slide / excel / computer / yurucommu が自身のデータを所有                   |

## ルール

- Takos app は account / billing / Installation ledger テーブルを所有しません。
- Takosumi kernel はプロダクトユーザーのプロファイルや billing
  テーブルを所有しません。
- `takos-private/` は publish 済みパッケージ・image・API・source
  経由で接続します。
- サービス間の wire shape は所有サービスの contract パッケージから取得します。

## 参考

- [API Reference](/reference/api)
- [Takosumi Accounts](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/operator-account-plane-contract.md)
- [Takosumi kernel storage schema](https://github.com/tako0614/takosumi/blob/main/docs/reference/storage-schema.md)
- [Installation ledger](https://takosumi.com/docs/reference/model)
