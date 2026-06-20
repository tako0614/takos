# データベース所有権

> このページでわかること: どのプロダクトがどのデータを所有しているか。

## 所有関係

| データ領域             | 所有者                  | 備考                                                                                    |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| account identity       | Takosumi Accounts       | user / organization / OIDC subject / account profile                                    |
| billing                | Takosumi Accounts       | BillingPort / Stripe customer マッピング                                                |
| Installation ledger    | Takosumi Accounts       | source identity / app plan snapshot digest / retained evidence refs / grants / bindings |
| deployment 記録        | Takosumi deploy-control | Deployment / activation pointer / provider observation / operation journal              |
| Git リポジトリ         | Git service profile     | リポジトリ metadata / refs / object storage 参照。Takos は UX/profile を所有する        |
| agent run              | Agent runtime profile   | プロダクト agent ワークフロー状態。Takos は UX/profile を所有する                       |
| app-local プロファイル | Takos app               | Takos UI プロファイルとプロダクトローカル設定                                           |
| bundled app データ     | 各 bundled app          | docs / slide / excel / computer / yurucommu が自身のデータを所有                        |

## ルール

- Takos app は account / billing / Installation ledger テーブルを所有しません。
- Takosumi kernel はプロダクトユーザーのプロファイルや billing
  テーブルを所有しません。
- `takosumi-private/` は operator state only の private repo であり、publish 済みパッケージ・image・API・source
  経由で接続します。
- サービス間の wire shape は所有サービスの contract パッケージから取得します。

## 参考

- [API Reference](/reference/api)
- [Takosumi operator model](https://takosumi.com/docs/reference/operator)
- [Takosumi model](https://takosumi.com/docs/reference/model)
- [Installation ledger](https://takosumi.com/docs/reference/model)
