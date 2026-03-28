# はじめてのアプリ

> このページでわかること: プロジェクトを作って、app.yml を書いて、デプロイするまでの全手順。

このチュートリアルでは、シンプルな Worker アプリを 1 つ作って staging 環境にデプロイします。所要時間は 10 分程度です。

## 前提

- `@takos/cli` がインストール済み（[Get Started](/get-started/) 参照）
- `takos login` でログイン済み
- Cloudflare アカウント ID と API トークンを用意

## 1. プロジェクトを作る

```bash
mkdir my-first-app && cd my-first-app
npm init -y
```

## 2. Worker のコードを書く

`src/index.ts` を作りましょう。

```typescript
// src/index.ts
export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    return new Response("Hello from Takos!", {
      headers: { "content-type": "text/plain" },
    });
  },
};
```

## 3. .takos/app.yml を書く

`.takos` ディレクトリを作って、`app.yml` を配置します。

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
  description: My first Takos app
  category: app

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

ポイント:

- `metadata.name` がアプリの識別名になります
- `workers.web` で Worker を 1 つ定義しています
- `routes` でルートパス `/` を Worker `web` に割り当てています
- ドメインは書かなくて OK。システムが自動付与します

## 4. ワークフローを書く

`.takos/workflows/deploy.yml` にビルド手順を定義します。

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

## 5. ビルドスクリプトを用意する

`package.json` にビルドスクリプトを追加します。

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
npm install
```

## 6. ローカルでビルドを確認

```bash
npm run build
```

`dist/worker/index.js` が生成されれば OK です。

## 7. staging にデプロイ

```bash
takos deploy-group --env staging \
  --account-id $CLOUDFLARE_ACCOUNT_ID \
  --api-token $CLOUDFLARE_API_TOKEN
```

::: tip 環境変数で指定する場合
`CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` を環境変数にセットしておけば、`--account-id` と `--api-token` フラグは省略できます。
:::

## 8. 結果を確認

デプロイが成功すると、ターミナルに Worker の URL が表示されます。

```text
✓ Worker "my-first-app-web" deployed
  https://my-first-app-web.your-subdomain.workers.dev
```

ブラウザで開いて "Hello from Takos!" が表示されれば成功です。

## デプロイ前に確認したいとき

実際にデプロイせず、内容だけ確認できます。

```bash
takos deploy-group --env staging --dry-run
```

## うまくいかないとき

- [デプロイのトラブルシューティング](/deploy/troubleshooting) --- よくあるエラーと対処法

## 次のステップ

- [プロジェクト構成](/get-started/project-structure) --- `.takos/` ディレクトリの全体像
- [Worker + Database](/examples/worker-with-db) --- D1 データベースを追加する
- [Worker + Container](/examples/worker-with-container) --- Docker コンテナを組み合わせる
- [deploy-group の詳細](/deploy/deploy-group) --- デプロイコマンドのオプション一覧
