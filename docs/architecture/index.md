# アーキテクチャ

> このページでわかること: Takos の内部構造とサービス間の関係。

## ページ一覧

- [システムアーキテクチャ](./system-architecture.md) —サービスの境界と役割分担
- [サービストポロジー](./service-topology.md) —
  ローカル環境のサービス構成とポート
- [アプリメタデータ](./app-publications.md) — アプリ情報と public Source v1 の境界
- [ランタイム / エージェント](./runtime-service.md) —エージェント実行の仕組み
- [図](./diagrams.md) —図で全体像を確認

## 関連ドキュメント

| 内容                                                 | 詳細ドキュメント                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Takosumi Installation Lifecycle / Installation / runtime modes | [ecosystem docs](https://github.com/tako0614/takos-ecosystem/tree/master/docs/platform) |
| Takosumi Accounts / billing / OIDC issuer            | [Takosumi entry point](https://takosumi.com/docs/reference/takosumi)        |
| takosumi kernel / Source / installer API                     | [Core Specification](https://takosumi.com/docs/reference/core-spec)                     |
| production deploy runbook / secrets                  | [takos-private docs](https://github.com/tako0614/takos-private/tree/master/docs)        |

Takos docs から外部仕様を説明するときは、ここに概要だけ置き、詳細は owning docs
にリンクします。
