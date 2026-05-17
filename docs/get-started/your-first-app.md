# はじめてのアプリ

> このページでわかること: シンプルな Worker アプリを作って Takos にデプロイするまでの手順。所要時間 10 分。

## 作るもの

- HTTP で "Hello" を返すシンプルな Worker アプリ
- ログインは Takosumi Accounts の OIDC を利用 (自前で認証を実装する必要なし)
- インストール直後に再ログインなしでアプリが開く (launch token)

## 前提

- `takos-cli` がインストール済み ([はじめる](/get-started/) を参照)
- Takosumi Accounts の PAT (Personal Access Token) を設定済み

## 1. プロジェクトを作る

```bash
mkdir my-first-app && cd my-first-app
npm init -y
mkdir -p src
```

## 2. Worker のコードを書く

```typescript
// src/index.ts
export default {
  async fetch(
    request: Request,
    env: {
      OIDC_ISSUER_URL?: string;
      OIDC_CLIENT_ID?: string;
      OIDC_CLIENT_SECRET?: string;
      OIDC_REDIRECT_URI?: string;
      TAKOS_INSTALLATION_ID?: string;
    },
  ): Promise<Response> {
    return new Response(
      `Hello from Takos! (installation=${env.TAKOS_INSTALLATION_ID ?? "n/a"})`,
      { headers: { "content-type": "text/plain" } },
    );
  },
};
```

環境変数はすべてインストール時にマニフェストから注入されます。
アプリコードでは標準的な OIDC client ライブラリで `OIDC_ISSUER_URL` を使うだけです。

## 3. マニフェストを書く

```bash
mkdir -p .takosumi/workflows
```

### デプロイするリソースの定義

```yaml
# .takosumi.yml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: my-first-app
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: PLACEHOLDER
      compatibilityDate: "2026-05-09"
      routes:
        - my-first-app.example.com/*
      env:
        AUTH_DRIVER: oidc
        OIDC_ISSUER_URL: https://accounts.example.com
        OIDC_CLIENT_ID: takos_inst_abc
        OIDC_CLIENT_SECRET: resolved-client-secret
        OIDC_REDIRECT_URI: https://my-first-app.example.com/auth/oidc/callback
        TAKOS_INSTALLATION_ID: inst_abc
    workflowRef:
      file: .takosumi/workflows/deploy.yml
      job: bundle
      artifact: web
      target: spec.artifact.hash
```

`PLACEHOLDER` と `workflowRef` はビルド時に自動で解決されます。

### アプリのメタデータと権限

```yaml
# .takosumi.yml
apiVersion: app.takosumi.dev/v1
kind: App
id: examples.my-first-app
name: My First App
bindings:
  auth:
    type: identity.oidc@v1
    redirectPaths:
      - /auth/oidc/callback
  bootstrap:
    type: install-launch-token@v1
```

## 4. ビルドワークフローを書く

```yaml
# .takosumi/workflows/deploy.yml
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

```bash
npm pkg set scripts.build="esbuild src/index.ts --bundle --outdir=dist/worker --format=esm"
npm install --save-dev esbuild
npm run build
```

`dist/worker/index.js` が生成されれば OK です。

## 6. インストールプレビューとデプロイ

```bash
# インストール内容のプレビュー
takosumi-git install preview --cwd . --json

# デプロイ
takosumi-git install apply \
  --cwd . \
  --accounts-url "$TAKOSUMI_ACCOUNTS_URL" \
  --account-id "$TAKOSUMI_ACCOUNT_ID" \
  --space-id "$TAKOSUMI_SPACE_ID" \
  --subject "$TAKOSUMI_SUBJECT" \
  --source-commit "$(git rev-parse HEAD)" \
  --runtime-base-url "$RUNTIME_BASE_URL" \
  --endpoint "$TAKOSUMI_ENDPOINT" \
  --deploy-token "$TAKOSUMI_DEPLOY_TOKEN"
```

成功すると Installation が `ready` になり、アプリが利用可能になります。

## 認証の仕組み

このアプリは認証を自分で実装していません。代わりに:

- **通常ログイン**: `/auth/oidc/login` から Takosumi Accounts にリダイレクトされ、
  コールバックでセッションが作られます
- **初回インストール直後**: launch token で自動的にセッションが作られるため、
  再ログイン不要でアプリが開きます

OIDC の設定 (clientId, clientSecret 等) は `.takosumi.yml` の `bindings.auth` で
宣言するだけで、インストール時に自動で払い出されます。

詳しくは [OIDC consumer](/apps/oidc-consumer) を参照。

## 次のステップ

- [プロジェクト構成](/get-started/project-structure) — `.takosumi/` の全体像
- [Worker + Database](/examples/worker-with-db) — DB を追加する
- [Worker + Container](/examples/worker-with-container) — Docker コンテナと組み合わせる
- [サンプル集](/examples/) — その他のサンプル
