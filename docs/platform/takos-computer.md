# takos-computer

takos-computer は、AI エージェントが MCP 経由で使うサンドボックス実行環境です。
Cloudflare Workers + Containers の上で動き、サンドボックスコンテナと、worker 側の
ダッシュボード / プロキシ層に分かれています。利用者が Takos Workspace に明示的に
install する普通の Capsule アプリで、MCP 対応のエージェントホストなら Takos 以外からも
利用できます。

## できること

- エージェント専用のサンドボックスセッションを作り、状態を確認し、破棄できます
- サンドボックス内でシェルコマンドを実行できます
- サンドボックスのファイルを読む・書く・一覧する・メタデータを取得できます
- 実行中プロセスの一覧と停止ができます
- ダッシュボードからセッションの様子を確認できます

## Runtime contract

サンドボックス / MCP の公開面は Takos 固有の結合を持ちません。install は他の
Capsule アプリと同じく、Git リポジトリを Source として登録し、reviewed な
plan / apply の Run を通して行います。実行記録は Takosumi が Run / StateVersion /
Output として残します。

## 関連ページ

- [Installable Apps](/platform/featured-apps)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
