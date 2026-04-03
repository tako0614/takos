# はじめてのアプリ

シンプルな Worker アプリを作って staging にデプロイし、Takos
の基本的な流れを一通り触る。所要時間 10 分。

## 前提

- `takos-cli` がインストール済み（[Get Started](/get-started/) 参照）
- `takos login` でログイン済み
- Cloudflare アカウント ID と API トークンを用意

## 1. プロジェクトを作る

```bash
mkdir my-first-app && cd my-first-app
npm init -y
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

## 3. Takos のアプリ定義を書く

```bash
mkdir -p .takos/workflows
```

```yaml
# .takos/app.yml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: my-first-app
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
  routes:
    - name: app
      target: web
      path: /
```

## 4. ワークフローを書く

```yaml
# .takos/workflows/deploy.yml
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

## 5. ビルドスクリプトを用意

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

```bash
npm install && npm run build
```

`dist/worker/index.js` が生成されれば OK。

## 6. デプロイ

```bash
takos login
takos apply --env staging
```

::: tip CLI は Takos の認証情報を使います。`takos login` 後は `--account-id` や
`--api-token` を渡す必要はありません。 :::

デプロイ成功すると URL が表示される。ブラウザで開いて "Hello from Takos!"
が出れば成功。

manifest の整合性だけ先に確認したい場合: `takos plan`

## 次のステップ

- [Takos 全体像](/overview/) -- platform の基本単位を確認する
- [プロジェクト構成](/get-started/project-structure) -- `.takos/`
  ディレクトリの全体像
- [Worker + Database](/examples/worker-with-db) -- D1 を追加する
- [Worker + Container](/examples/worker-with-container) -- Docker
  コンテナを組み合わせる
