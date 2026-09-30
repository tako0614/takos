# takos-computer

takos-computer は、agent が使えるコンテナ化サンドボックス実行環境を、MCP と簡易
ダッシュボードで公開する Capsule アプリです。Cloudflare Workers + Containers 上で動き、
セッションごとに隔離された環境でコマンド実行やファイル操作を任せられます。

## できること

- agent 専用のサンドボックスセッションを作り、状態を確認し、破棄する
- サンドボックス内でシェルコマンドを実行する
- サンドボックスのファイルを読む・書く・一覧する・メタデータを取得する
- 実行中プロセスの一覧と停止
- ダッシュボードからセッションの様子を確認する

## 境界

サンドボックス / MCP 表面は Takos 固有の結合を持たず、任意の MCP 対応エージェント
ホストから使えます。Workspace には利用者が明示的に install する通常の Capsule App で、
Takosumi 上で動作します。

## 次に読む

- [takos-computer repository](https://github.com/tako0614/takos-computer)
- [Bundled Apps](/platform/featured-apps)
- [ツールと接続](/apps/mcp)
