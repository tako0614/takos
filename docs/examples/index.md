# サンプル集

アプリの種類ごとに、Capsule の install がどう進むかを例で示します。どの例でも
流れは同じです。Git リポジトリを Source として登録し、plan の差分を確認してから
apply し、結果は Run / StateVersion / Output として Takosumi に残ります。

## 例の一覧

| 例 | 見せること |
| --- | --- |
| [シンプルな Worker](/examples/simple-worker) | 最小構成の install。Git URL と ref だけで始める |
| [Worker + DB](/examples/worker-with-db) | DB の接続情報を module の Output から受け取る |
| [Worker + Container](/examples/worker-with-container) | Container 実行を伴う module を policy 経由で動かす |
| [MCP Server](/examples/mcp-server) | Interface と InterfaceBinding まで含む、いちばん完全な例 |
| [マルチサービス構成](/examples/multi-service) | module path を指定して複数サービスの graph を install する |

アプリの探し方と install の入口は [Capsule を発見して install する](/platform/store)、
外部ツールの接続は [ツールと接続](/apps/mcp) を参照してください。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
