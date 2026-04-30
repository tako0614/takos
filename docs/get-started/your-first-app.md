# はじめての group

シンプルな Worker group を作って staging にデプロイし、Takos
の基本的な流れを一通り触る。所要時間 10 分。

## 前提

- `takos-cli` がインストール済み（[Get Started](/get-started/) 参照）
- `takos login` でログイン済み

Takos endpoint に `takos login` で認証していれば、追加の operator backend
設定は不要です。Takos kernel をセルフホストする operator 向けの設定は
[Hosting](/hosting/) を参照してください。

## 1. プロジェクトを作る

```bash
mkdir my-first-group && cd my-first-group
npm init -y
mkdir -p src
```

## 2. Worker のコードを書く

```typescript
// src/index.ts
export default {
  async fetch(
    request: Request,
    env: Record<string, unknown>,
  ): Promise<Response> {
    return new Response("Hello from Takos!", {
      headers: { "content-type": "text/plain" },
    });
  },
};
```

## 3. Takos の deploy manifest を書く

```bash
mkdir -p .takos/workflows
```

```yaml
# .takos/app.yml
name: my-first-group

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - id: web
    target: web
    path: /
```

## 4. ワークフローを書く

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

## 5. ビルドスクリプトを用意

`package.json` に build script を追加し、`esbuild` を dev dependency として
install します。

```bash
npm pkg set scripts.build="esbuild src/index.ts --bundle --outdir=dist/worker --format=esm"
npm install --save-dev esbuild
npm run build
```

`package.json` には次のような内容が追加されます。

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --outdir=dist/worker --format=esm"
  },
  "devDependencies": {
    "esbuild": "^0.20.0"
  }
}
```

`dist/worker/index.js` が生成されれば OK。

## 6. デプロイ

```bash
takos login
takos deploy --env staging --space SPACE_ID
```

::: tip CLI は Takos の認証情報を使います。`takos login` 後は `--account-id` や
`--api-token` を渡す必要はありません。
:::

デプロイ成功すると URL が表示される。ブラウザで開いて "Hello from Takos!"
が出れば成功。`takos deploy` は default で resolve + apply を 1 step
で実行する Heroku 風 sugar です。

manifest の整合性だけ先に確認したい場合:
`takos deploy --preview --space SPACE_ID` (in-memory preview)。
reviewer に渡したい場合は `takos deploy --resolve-only --space SPACE_ID`
で resolved Deployment record を作り、`takos diff <id>` / `takos apply <id>`
で確認・適用を分離できます。

::: tip flat manifest `app.yml` は flat 構造です。`apiVersion` / `kind` /
`metadata` / `spec` のラッパーは不要で、`name` をトップレベルに書きます。
:::

## 次のステップ

- [Takos 全体像](/overview/) -- platform の基本単位を確認する
- [プロジェクト構成](/get-started/project-structure) -- `.takos/`
  ディレクトリの全体像
- [Worker + Database](/examples/worker-with-db) -- D1 を追加する
- [Worker + Container](/examples/worker-with-container) -- Docker
  コンテナを組み合わせる
