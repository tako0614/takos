# ランタイム / エージェント

> このページでわかること: エージェント実行とランタイムの責務分担。

Takos のランタイム実行は、エージェントサービス、Takosumi kernel、operator が
選ぶ implementation binding、runtime-agent の責務に分かれています。

## 各コンポーネントの役割

| コンポーネント         | 役割                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `takos-agent`          | エージェントの実行と Takos 固有の挙動                                                           |
| Takosumi kernel        | デプロイのライフサイクル、plan/apply/status、provider 調整                                      |
| implementation binding | ターゲット別のリソース materialize。takosumi.com reference implementation では provider adapter |
| runtime-agent          | ワークロードホストのライフサイクルと実装 RPC                                                    |

Takos のコードは、wire shape を所有するサービスの contract
を経由して呼び出します。サービス間で型を generic
な共通パッケージに複製しません。

## ローカル実行

ローカル開発のサービス構成は
[ローカル開発ガイド](/get-started/local-development) を参照してください。
本番のホスティング設計は [ホスティング](/hosting/) を参照してください。
