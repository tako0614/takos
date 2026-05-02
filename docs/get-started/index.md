# はじめる

> このページでわかること: Takos が何をするプラットフォームで、どう始めるか。

Takos は、AIエージェントによるサービスとソフトウェアの民主化基盤です。worker
ベースの service は group deploy で配備し、resource は同じ control plane の
resource API / runtime binding で管理・利用できます。

group を構成するときは `.takos/app.yml` と `.takos/workflows/`
を使いますが、Takos Docs は manifest だけの説明書ではありません。この章では、CLI
のセットアップから最初の deploy まで、Takos を使い始める流れを揃えます。

## 3 分で始める

### 1. CLI をインストール

Takos CLI は `takos-cli/` repository が基準です。現時点では JSR package release
flow は未整備のため、compiled binary か direct Deno 実行を使います。開発用の
ecosystem checkout では、`takos/` と同じ階層にある `takos-cli/` から install
します。

```bash
# takos-ecosystem checkout root で実行
cd takos-cli
deno install -gA -n takos src/index.ts
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

### 3. deploy manifest を書く

プロジェクトのルートに、Takos の deploy manifest `.takos/app.yml` を作ります。

```yaml
# .takos/app.yml
name: my-app

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

routes:
  - id: web
    expose: { component: web, contract: ui }
    via:
      ref: route.https@v1
      config: { path: / }
```

`routes` で `/` を `web` component の `interface.http@v1` instance に紐づける
ことで、 ドメイン直下が公開されます。 ドメインはシステムが自動付与します。

### 4. ビルドワークフローを書く

manifest の `artifact.workflow-bundle@v1.config.workflow` で参照する
workflow を作ります。

```yaml
# .takos/workflows/deploy.yml
name: deploy
jobs:
  bundle:
    runs-on: ubuntu-latest
    steps:
      - name: Install dependencies
        run: npm install
      - name: Build
        run: npm run build
    artifacts:
      web:
        path: dist/worker
```

このワークフローが build artifact を生成し、Takos がそれを Worker として deploy
します。

### 5. デプロイ

```bash
takos deploy --env staging --space SPACE_ID
```

`takos deploy` は default で manifest を 1 つの Deployment として resolve し、
そのまま apply まで進めます (Heroku 風の sugar)。reviewer flow が必要な場合は
`takos deploy --resolve-only` で resolved Deployment record だけ作って、
`takos diff <id>` / `takos apply <id>` で確認・適用を分離できます。手元で
manifest だけ検証したい場合は `takos deploy --preview` を使います。

ステージング環境にデプロイされます。URL
がターミナルに表示されるので、ブラウザで開いてみましょう。`routes` で宣言した
`/` がそのまま開きます。`TAKOS_SPACE_ID` または `.takos-session` で既定 space
が決まっている場合は `--space` を省略できます。

## 次のステップ

- [Takos 全体像](/overview/) --- Space / Repo / Worker / Run
  などの基本単位から理解する
- [はじめての group](/get-started/your-first-app) --- 実際に group
  を作ってデプロイするチュートリアル
- [プロジェクト構成](/get-started/project-structure) --- `.takos/`
  ディレクトリの中身を理解する
- [ローカル開発](/get-started/local-development) --- ローカル環境をセットアップ
- [Deploy 構成](/apps/) --- deploy manifest と周辺 public surface のガイド
- [サンプル集](/examples/) --- コピペで始められるサンプル
