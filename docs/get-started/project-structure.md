# プロジェクト構成

`.takos/` ディレクトリの構成と各ファイルの役割。

## ディレクトリ構成

```text
my-app/
├── .takos/
│   ├── app.yml              ← アプリの構成定義
│   ├── workflows/
│   │   └── deploy.yml       ← ビルド・デプロイのワークフロー
│   └── migrations/          ← DB マイグレーション（D1 を使う場合）
│       └── primary-db/
│           ├── up/
│           └── down/
├── src/
│   └── index.ts
├── package.json
└── ...
```

## 各ファイルの役割

### `.takos/app.yml`

「何をデプロイするか」を宣言するファイル。Workers、Container、リソース、ルート、環境変数を定義する。

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

詳しくは [app.yml の書き方](/apps/manifest) を参照。フィールド一覧は [マニフェストリファレンス](/reference/manifest-spec)。

### `.takos/workflows/deploy.yml`

ビルド手順と artifact の出力先を記述。`app.yml` の `build.fromWorkflow` がこのファイルを参照する。

### `.takos/migrations/`

D1 を使う場合のマイグレーションファイル。ディレクトリ名が `app.yml` の resource 名に対応する。

## 制約

- `app.yml` は `.takos/` 直下に配置
- `workflows/` は `.takos/workflows/` 配下に配置（それ以外はバリデーションエラー）
- `kind` は `App` 固定

## 次のステップ

- [アプリ開発](/apps/) -- app.yml の各セクション
- [Workers](/apps/workers) -- Worker の定義方法
- [Containers](/apps/containers) -- Container の定義方法
