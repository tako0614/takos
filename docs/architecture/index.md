# アーキテクチャ

> このページでわかること: Takos の内部構造とサービス間の関係。

## ページ一覧

- [システムアーキテクチャ](./system-architecture.md) —サービスの境界と役割分担
- [サービストポロジー](./service-topology.md) —
  ローカル環境のサービス構成とポート
- [アプリメタデータ](./app-metadata.md) — アプリ情報を Takos と Takosumi のどちらが持つかの境界
- [ランタイム / エージェント](./runtime-service.md) —エージェント実行の仕組み
- [内部トラスト境界](./internal-trust-boundaries.md) — 単一 worker での internal call の正本メカニズム（binding 境界 / 署名 envelope / per-run token）
- [図](./diagrams.md) —図で全体像を確認

## 関連ドキュメント

| 内容                                      | 詳細ドキュメント                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Takosumi Capsule / typed Runs model  | [Takosumi model](https://takosumi.com/docs/reference/model)                                                                                  |
| Takosumi Accounts / billing / OIDC issuer | [Takosumi operator model](https://takosumi.com/docs/reference/operator)                                                                       |
| Takosumi deploy-control API               | [Deploy Control API](https://takosumi.com/docs/reference/deploy-control-api)                                                                 |
| production deploy runbook / secrets       | `takosumi-private/operations/` and operator-local secret store                                                                                |

Takos docs から外部仕様を説明するときは、ここに概要だけ置き、詳細は owning docs
にリンクします。
