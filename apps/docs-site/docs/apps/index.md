# アプリ開発

> このページでわかること: app.yml で定義できること全体と、各ガイドページへの案内。

Takos のアプリ開発は `.takos/app.yml` を書くことから始まります。このセクションでは、app.yml の各セクションを詳しく解説します。

## app.yml の全体像

app.yml は「何をデプロイするか」を宣言するファイルです。ビルド手順書ではなく、デプロイ後に何が起動し、どこで公開され、何が接続されるかを表します。

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: my-app
spec:
  version: 0.1.0
  containers: ...    # Docker コンテナ
  workers: ...       # CF Workers
  routes: ...        # HTTP エンドポイント
  resources: ...     # DB, Storage, Queue, ...
  env: ...           # 環境変数
  mcpServers: ...    # MCP Server 公開
  fileHandlers: ...  # ファイルハンドラー
  oauth: ...         # OAuth client
```

## セクション別ガイド

| ガイド | 内容 |
| --- | --- |
| [Workers](/apps/workers) | CF Workers の定義、ビルド、バインディング、トリガー |
| [Containers](/apps/containers) | Docker コンテナの定義、Worker との紐づけ、独立稼働 |
| [Routes](/apps/routes) | HTTP エンドポイントの公開設定 |
| [環境変数](/apps/environment) | 必須変数、テンプレート変数、値の注入 |
| [MCP Server](/apps/mcp) | MCP Server の公開方法と認証 |
| [File Handlers](/apps/file-handlers) | ファイルハンドラーの登録 |

## 構成の決め方

**何で動かす?**

- CF Workers だけで済む → `workers` だけ書く
- Docker が必要 → `containers` + `workers` を書く
- Docker だけで済む → `containers` に `ipv4: true` を付けて独立稼働

**データを保存する?**

- はい → `resources` に `d1` / `r2` / `kv` などを追加して、Worker の `bindings` で参照

**外部に公開する?**

- はい → `routes` を追加。ドメインはシステムが自動付与

**他のアプリから呼ばれたい?**

- MCP Server として → `mcpServers` を追加
- OAuth で認証 → `oauth` を追加
- ファイルを開く → `fileHandlers` を追加

## 最小構成

Worker 1 つだけの最小構成はこれだけです。

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: my-app
spec:
  version: 0.1.0
  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: bundle
          artifact: web
          artifactPath: dist/worker
```

## 次のステップ

- [Workers](/apps/workers) --- Worker の定義方法
- [サンプル集](/examples/) --- コピペで始められるサンプル
- [マニフェストリファレンス](/reference/manifest-spec) --- 全フィールドの一覧
