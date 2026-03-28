# プラットフォーム

> このページでわかること: Takos プラットフォームが提供する機能の全体像。

Takos は、アプリの宣言的デプロイだけでなく、AI エージェント実行、リソース管理、マルチテナント分離などの機能を提供するプラットフォームです。

## プラットフォーム機能

### デプロイ

`.takos/app.yml` に書いた構成を Cloudflare 上にデプロイします。

- **Worker**: Cloudflare Workers (V8 isolate) として実行
- **Container**: CF Containers (Docker) として実行
- **リソース**: D1, R2, KV, Queue, Vectorize を自動プロビジョニング
- **ルート**: HTTP エンドポイントを自動設定

詳しくは [デプロイ](/deploy/deploy-group) を参照してください。

### リソース管理

アプリが使うバッキングリソースを宣言的に管理します。

| リソース | 用途 |
| --- | --- |
| D1 | SQL データベース |
| R2 | オブジェクトストレージ |
| KV | Key-Value ストア |
| Queue | メッセージキュー |
| Vectorize | ベクトルデータベース |
| secretRef | シークレット参照 |

### AI エージェント実行

Thread / Run モデルで AI エージェントを実行します。

- **Thread**: 会話のコンテキスト
- **Run**: エージェントの実行単位
- **Artifact**: 実行結果の保存

### MCP Server

MCP (Model Context Protocol) Server を公開して、AI エージェントからツールとして呼び出せるようにします。

詳しくは [MCP Server](/apps/mcp) を参照してください。

### マルチテナント

dispatch namespace を使って、テナントごとに Worker を論理分離できます。

詳しくは [Dispatch Namespace](/deploy/namespaces) を参照してください。

### Store

アプリを Store に公開して、他のユーザーがインストール・利用できるようにします。

- OAuth client の自動登録
- MCP Server の自動公開
- ファイルハンドラーの登録

### ローカル開発

Docker Compose ベースのローカル開発環境を提供します。

詳しくは [ローカル開発ガイド](/get-started/local-development) を参照してください。

## 実行環境

Takos は Cloudflare を primary surface としつつ、以下の環境をサポートしています。

| 環境 | 状態 |
| --- | --- |
| Cloudflare Workers / Containers | primary |
| local-platform (Docker Compose) | 開発用 |
| Helm / OCI orchestrator | 投影中 |

provider ごとの差分は [Platform Compatibility Matrix](/platform/compatibility) と [互換性と制限](/architecture/compatibility) を参照してください。

## 次のステップ

- [Get Started](/get-started/) --- 3 分で始める
- [アプリ開発](/apps/) --- app.yml の詳細ガイド
- [アーキテクチャ](/architecture/) --- 内部構成の詳細
