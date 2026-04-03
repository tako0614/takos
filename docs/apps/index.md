# アプリ構成

Takos を使ってサービスやソフトウェアを構成するときに使う public surface
をまとめた章です。中心になるのは `.takos/app.yml` ですが、manifest だけでなく
Workers、Containers、Routes、環境変数、MCP、OAuth、File Handlers
の関係もここで扱います。

この章が扱うのは app の deploy/runtime contract です。workspace shell、app
launcher、canonical URL と shell launch URL の分離は現時点では `.takos/app.yml`
に入れず、[Kernel / Workspace Shell / Apps](/architecture/kernel-shell)
で定義します。

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

| ガイド                               | 内容                                          |
| ------------------------------------ | --------------------------------------------- |
| [アプリマニフェスト](/apps/manifest) | `.takos/app.yml` の全体像、パターン、完全な例 |
| [Workers](/apps/workers)             | CF Workers の定義、ビルド、バインディング     |
| [Containers](/apps/containers)       | Docker コンテナの定義、Worker との紐づけ      |
| [Routes](/apps/routes)               | HTTP エンドポイントの公開                     |
| [環境変数](/apps/environment)        | テンプレート変数、値の注入                    |
| [MCP Server](/apps/mcp)              | MCP Server の公開と認証                       |
| [File Handlers](/apps/file-handlers) | ファイルハンドラーの登録                      |
| [OAuth](/apps/oauth)                 | OAuth client の自動登録                       |

## 次のステップ

- [Takos 全体像](/overview/) --- platform と用語から理解する
- [Kernel / Workspace Shell / Apps](/architecture/kernel-shell) --- Takos 本体と
  installable apps の境界を確認する
- [アプリマニフェスト](/apps/manifest) --- アプリ定義の中心となる spec
  を確認する
- [サンプル集](/examples/) --- コピペで始められるサンプル
