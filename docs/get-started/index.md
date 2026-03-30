# Takos

> このページでわかること: Takos が何をするプラットフォームで、どう始めるか。

Takos は、アプリを宣言的にデプロイ・実行するプラットフォームです。

`.takos/app.yml` にアプリの構成を書くだけで、Worker / Container / データベース / ストレージをまとめてデプロイできます。ビルド手順を CLI に教える必要はありません。「何をデプロイするか」を書けば、Takos が面倒を見てくれます。

## 3 分で始める

### 1. CLI をイン���トール

```bash
deno install -gA jsr:@takos/cli
```

### 2. ログイン

```bash
takos login
# ブラウザが開いて認証 → 完了
```

ログインできたか確認しましょう。

```bash
takos whoami
```

### 3. app.yml を書く

プロジェクトのルートに `.takos/app.yml` を作ります。

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

これだけで Worker が 1 つデプロイされます。ドメインはシステムが自動付与します。

### 4. デプロイ

```bash
takos apply --env staging
```

ステージング環境にデプロイされます。URL がターミナルに表示されるので、ブラウザで開いてみましょう。

## 次のステップ

- [はじめてのアプリ](/get-started/your-first-app) --- 実際にアプリを作ってデプロイするチュートリアル
- [プロジェクト構成](/get-started/project-structure) --- `.takos/` ディレクトリの中身を理解する
- [ローカル開発](/get-started/local-development) --- ローカル環境をセットアップ
- [アプリ開発](/apps/) --- app.yml の詳細ガイド
- [サンプル集](/examples/) --- コピペで始められるサンプル
