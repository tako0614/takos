# アプリ開発

`.takos/app.yml` を書いてアプリをデプロイする。

## 最小構成

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

## セクション別ガイド

| ガイド | 内容 |
| --- | --- |
| [マニフェスト](/apps/manifest) | app.yml の全体像、パターン、完全な例 |
| [Workers](/apps/workers) | CF Workers の定義、ビルド、バインディング |
| [Containers](/apps/containers) | Docker コンテナの定義、Worker との紐づけ |
| [Routes](/apps/routes) | HTTP エンドポイントの公開 |
| [環境変数](/apps/environment) | テンプレート変数、値の注入 |
| [MCP Server](/apps/mcp) | MCP Server の公開と認証 |
| [File Handlers](/apps/file-handlers) | ファイルハンドラーの登録 |
| [OAuth](/apps/oauth) | OAuth client の自動登録 |

## 次のステップ

- [マニフェスト](/apps/manifest) --- まずはここから
- [サンプル集](/examples/) --- コピペで始められるサンプル
