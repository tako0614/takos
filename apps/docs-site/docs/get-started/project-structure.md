# プロジェクト構成

> このページでわかること: `.takos/` ディレクトリの構成と各ファイルの役割。

Takos アプリのプロジェクト構成はシンプルです。プロジェクトルートに `.takos/` ディレクトリを置いて、その中にアプリ定義とワークフローを配置します。

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
├── src/                     ← アプリのソースコード
│   └── index.ts
├── package.json
└── ...
```

## 各ファイルの役割

### `.takos/app.yml`

アプリの構成定義ファイルです。「何をデプロイするか」を宣言します。

- どんな Worker / Container を動かすか
- どんなリソース（DB, Storage）を使うか
- どのパスで公開するか
- 環境変数は何が必要か

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

詳しくは [アプリ開発](/apps/) を参照してください。

### `.takos/workflows/deploy.yml`

ビルドとデプロイのワークフロー定義です。Worker のビルド手順と artifact の出力先を記述します。

```yaml
name: deploy
jobs:
  bundle:
    steps:
      - name: Install dependencies
        run: npm install
      - name: Build
        run: npm run build
    artifacts:
      web:
        path: dist/worker
```

`app.yml` の `build.fromWorkflow` がこのファイルの job と artifact を参照します。

### `.takos/migrations/`

D1 データベースを使う場合のマイグレーションファイルを配置します。

```text
.takos/migrations/
└── primary-db/           ← app.yml の resource 名に対応
    ├── up/               ← マイグレーション適用
    │   ├── 0001_init.sql
    │   └── 0002_add_users.sql
    └── down/             ← マイグレーション巻き戻し
        ├── 0001_init.sql
        └── 0002_add_users.sql
```

`app.yml` で以下のように参照します。

```yaml
resources:
  primary-db:
    type: d1
    binding: DB
    migrations:
      up: .takos/migrations/primary-db/up
      down: .takos/migrations/primary-db/down
```

## 制約

- `app.yml` は `.takos/` 直下に配置してください
- `workflows/` は `.takos/workflows/` 配下に配置してください。それ以外のパスを指定するとバリデーションエラーになります
- `app.yml` の `kind` は `App` 固定です

## 次のステップ

- [アプリ開発](/apps/) --- app.yml の各セクションを詳しく
- [Workers](/apps/workers) --- Worker の定義方法
- [Containers](/apps/containers) --- Container の定義方法
- [デプロイ](/deploy/deploy-group) --- デプロイコマンドの詳細
