# サンプル集

> このページでわかること: コピペで始められるサンプルアプリの一覧。

Takos でよく使われる構成パターンをサンプルとしてまとめました。それぞれの
`app.yml` はそのままコピーして使えます。

## サンプル一覧

### [Worker だけのシンプルなアプリ](/examples/simple-worker)

Worker を 1 つだけデプロイする最小構成です。まずはここから始めましょう。

- Worker 1 つ
- ルート 1 つ
- リソースなし

---

### [Worker + SQL / Object Store](/examples/worker-with-db)

Worker に SQL database と object storage を接続する構成です。データを保存するアプリに。

- Worker 1 つ
- sql + object-store
- マイグレーション設定あり

---

### [Worker + Container](/examples/worker-with-container)

Worker と Docker
コンテナを組み合わせる構成です。ブラウザ自動化やヘビーな処理に。

- Worker 1 つ + Container 1 つ
- worker-attached container workload を実行
- takos-agent と同じアーキテクチャ

---

### [MCP Server](/examples/mcp-server)

MCP (Model Context Protocol) Server を公開する構成です。AI
エージェントからツールとして呼び出せます。

- Worker 1 つ
- MCP Server 公開
- 認証トークンの自動生成

### [マルチサービス構成](/examples/multi-service)

複数 Worker + 共有 storage の実践的な構成です。API
サーバーとバックグラウンドワーカー (queue consumer) を連携。

- Worker 2 つ (api + jobs)
- 共有 storage: sql / object-store / queue / analytics-engine
- queue trigger で job worker が起動

container 構成は [Worker + Container](/examples/worker-with-container)、MCP Server は [MCP Server](/examples/mcp-server) を参照。

---

## Default Group 構成

Takos の default group として preinstall される 4 つの group の manifest 例。
（Agent / Chat, Git, Storage, Store は kernel features であり group ではない。）

### [takos-computer](/platform/takos-computer)

ブラウザ自動化 / サンドボックス。UiSurface + McpServer を publish。

### [takos-docs](/platform/takos-docs)

リッチテキストエディタ。UiSurface + McpServer を publish。

### [takos-excel](/platform/takos-excel)

スプレッドシート。UiSurface + McpServer を publish。

### [takos-slide](/platform/takos-slide)

プレゼンテーション。UiSurface + McpServer を publish。

---

## 次のステップ

- [はじめてのアプリ](/get-started/your-first-app) ---
  ステップバイステップのチュートリアル
- [アプリ構成](/apps/) --- アプリマニフェストと周辺 public surface のガイド
- [deploy の詳細](/deploy/deploy) --- `takos deploy` のオプション
