# プロジェクト構成

Takos プロジェクトで使う `.takos/` ディレクトリと関連ファイルの役割を整理する。

## ディレクトリ構成

```text
my-app/
├── .takos/
│   ├── app.yml              ← アプリの構成定義
│   └── workflows/
│       └── deploy.yml       ← ビルド・デプロイのワークフロー
├── src/
│   └── index.ts
└── ...
```

## 各ファイルの役割

### アプリマニフェスト (`.takos/app.yml`)

Takos で「何をデプロイするか」を宣言する flat manifest。compute、routes、
publish、env、overrides を定義する。

`.takos/app.yml` は deploy/runtime contract です。

```yaml
name: my-app
version: 0.1.0

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: primary-db
        env:
          endpoint: DATABASE_URL
          apiKey: DATABASE_API_KEY

publish:
  - name: primary-db
    provider: takos
    kind: sql
    spec:
      resource: primary-db
      permission: write

routes:
  - target: web
    path: /
```

詳しくは [アプリマニフェスト](/apps/manifest) を参照。フィールド一覧は
[マニフェストリファレンス](/reference/manifest-spec)。kernel と app の境界は
[Kernel](/architecture/kernel) を参照。

### `.takos/workflows/deploy.yml`

ビルド手順と artifact の出力先を記述。`app.yml` の `build.fromWorkflow`
がこのファイルを参照する。

stateful resource の schema や初期化手順は provider-backed publication とその
consumer 側のコードで扱う。manifest 側に専用の stateful-resource
フィールドはなく、 `.takos/migrations/` は current contract には含まれない。

## 制約

- `app.yml` は `.takos/` 直下に配置
- `workflows/` は `.takos/workflows/`
  配下に配置（それ以外はバリデーションエラー）
- `name` はトップレベルに記述（flat manifest）

## 次のステップ

- [Takos 全体像](/overview/) -- platform と用語を先に整理する
- [アプリ構成](/apps/) -- app manifest と周辺 public surface を確認する
- [Workers](/apps/workers) -- Worker の定義方法
- [Containers](/apps/containers) -- Container の定義方法
