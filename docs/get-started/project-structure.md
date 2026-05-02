# プロジェクト構成

Takos プロジェクトで使う `.takos/` ディレクトリと関連ファイルの役割を整理する。

## ディレクトリ構成

```text
my-app/
├── .takos/
│   ├── app.yml              ← deploy manifest
│   └── workflows/
│       └── deploy.yml       ← ビルド・デプロイのワークフロー
├── src/
│   └── index.ts
└── ...
```

## 各ファイルの役割

### Deploy Manifest (`.takos/app.yml`)

Takos で「何をデプロイするか」を宣言する flat manifest。 components /
routes / resources / bindings / publications / environments / policy を
定義する。

`.takos/app.yml` は group の deploy/runtime contract です。

```yaml
name: my-app
version: 0.1.0

components:
  web:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
        config:
          source:
            ref: artifact.workflow-bundle@v1
            config:
              workflow: .takos/workflows/deploy.yml
              job: bundle
              artifact: web
              entry: dist/worker.js
      ui:
        ref: interface.http@v1

bindings:
  - from:
      publication: takos.api-key
      request:
        scopes: [files:read]
    to:
      component: web
      env:
        TAKOS_API_ENDPOINT: endpoint
        TAKOS_API_KEY: apiKey

routes:
  - id: web
    expose: { component: web, contract: ui }
    via: { ref: route.https@v1, config: { path: / } }
```

詳しくは [Deploy Manifest](/deploy/manifest) を参照。 フィールド一覧は
[マニフェストリファレンス](/reference/manifest-spec)。 kernel と group の
境界は [Kernel](/architecture/kernel) を参照。

### `.takos/workflows/deploy.yml`

ビルド手順と artifact の出力先を記述。 `app.yml` の
`artifact.workflow-bundle@v1.config.workflow` がこのファイルを参照する。

stateful resource の schema や初期化手順は `resources[]` で claim し
`bindings[]` で明示 binding する。 Takos API key / OAuth client は
`publications[]` ではなく `takos.api-key` / `takos.oauth-client` を
`bindings[].from.publication` で受け取る。

## 制約

- `app.yml` は `.takos/` 直下に配置
- `workflows/` は `.takos/workflows/`
  配下に配置（それ以外はバリデーションエラー）
- `name` はトップレベルに記述（flat manifest）

## 次のステップ

- [Takos 全体像](/overview/) -- platform と用語を先に整理する
- [Deploy 構成](/apps/) -- deploy manifest と周辺 public surface を確認する
