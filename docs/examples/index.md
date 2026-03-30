# サンプル集

> このページでわかること: コピペで始められるサンプルアプリの一覧。

Takos でよく使われる構成パターンをサンプルとしてまとめました。それぞれの `app.yml` はそのままコピーして使えます。

## サンプル一覧

### [Worker だけのシンプルなアプリ](/examples/simple-worker)

Worker を 1 つだけデプロイする最小構成です。まずはここから始めましょう。

- Worker 1 つ
- ルート 1 つ
- リソースなし

---

### [Worker + D1 データベース](/examples/worker-with-db)

Worker に D1 と R2 を接続する構成です。データを保存するアプリに。

- Worker 1 つ
- D1 + R2
- マイグレーション設定あり

---

### [Worker + Container](/examples/worker-with-container)

Worker と Docker コンテナを組み合わせる構成です。ブラウザ自動化やヘビーな処理に。

- Worker 1 つ + Container 1 つ
- CF Containers で Docker を実行
- takos-computer と同じアーキテクチャ

---

### [MCP Server](/examples/mcp-server)

MCP (Model Context Protocol) Server を公開する構成です。AI エージェントからツールとして呼び出せます。

- Worker 1 つ
- MCP Server 公開
- 認証トークンの自動生成

### [マルチサービス構成](/examples/multi-service)

複数 Worker + 複数 Container + リソース共有の実践的な構成です。API サーバーとバックグラウンドワーカーをキューで連携。

- Worker 2 つ + Container 2 つ
- D1 / R2 / queue / analyticsEngine
- MCP Server + テンプレート変数

## 次のステップ

- [はじめてのアプリ](/get-started/your-first-app) --- ステップバイステップのチュートリアル
- [アプリ開発](/apps/) --- app.yml の詳細ガイド
- [apply の詳細](/deploy/apply) --- `takos apply` のオプション
