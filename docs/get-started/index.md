# はじめる

> このページでわかること: Takos が何をするプラットフォームで、どう始めるか。

Takos は、AIエージェントによるサービスとソフトウェアの民主化基盤です。AI app と
worker ベースの service を、同じ control plane で管理・配備・実行できます。

アプリを構成するときは `.takos/app.yml` と `.takos/workflows/`
を使いますが、Takos Docs は manifest だけの説明書ではありません。この章では、CLI
のセットアップから最初の deploy まで、Takos を使い始める流れを揃えます。

## 3 分で始める

### 1. CLI をインストール

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

### 3. アプリ定義を書く

プロジェクトのルートに、Takos の app manifest `.takos/app.yml` を作ります。

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

ステージング環境にデプロイされます。URL
がターミナルに表示されるので、ブラウザで開いてみましょう。

## 次のステップ

- [Takos 全体像](/overview/) --- Workspace / Repo / Worker / Run
  などの基本単位から理解する
- [はじめてのアプリ](/get-started/your-first-app) ---
  実際にアプリを作ってデプロイするチュートリアル
- [プロジェクト構成](/get-started/project-structure) --- `.takos/`
  ディレクトリの中身を理解する
- [ローカル開発](/get-started/local-development) --- ローカル環境をセットアップ
- [アプリ構成](/apps/) --- アプリマニフェストと周辺 public surface のガイド
- [サンプル集](/examples/) --- コピペで始められるサンプル
