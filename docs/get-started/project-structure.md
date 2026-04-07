# プロジェクト構成

Takos プロジェクトで使う `.takos/` ディレクトリと関連ファイルの役割を整理する。

## ディレクトリ構成

```text
my-app/
├── .takos/
│   ├── app.yml              ← アプリの構成定義
│   ├── workflows/
│   │   └── deploy.yml       ← ビルド・デプロイのワークフロー
│   └── migrations/          ← DB マイグレーション（sql storage を使う場合）
│       └── primary-db/
│           ├── 0001_create_users.sql
│           └── 0002_add_email_index.sql
├── src/
│   └── index.ts
├── package.json
└── ...
```

## 各ファイルの役割

### アプリマニフェスト (`.takos/app.yml`)

Takos
で「何をデプロイするか」を宣言するファイル。compute、storage、routes、publish、環境変数を定義する。

`.takos/app.yml` は deploy/runtime contract です。

```yaml
name: my-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
```

詳しくは [アプリマニフェスト](/apps/manifest) を参照。フィールド一覧は
[マニフェストリファレンス](/reference/manifest-spec)。kernel と app の境界は
[Kernel](/architecture/kernel) を参照。

### `.takos/workflows/deploy.yml`

ビルド手順と artifact の出力先を記述。`app.yml` の `build.fromWorkflow`
がこのファイルを参照する。

### `.takos/migrations/`

`sql` storage 用のマイグレーションファイル。ディレクトリ名が `app.yml` の
storage 名に対応する。各 storage ディレクトリ直下に `.sql`
ファイルをファイル名順で配置する （forward-only。`up/` `down/`
のサブディレクトリは存在せず、rollback による schema
巻き戻しはサポートしない。schema を戻したい場合は新しい migration として書く）。

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
