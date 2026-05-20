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

環境変数はすべてインストール時に AppSpec から注入されます。
アプリコードでは標準的な OIDC client ライブラリで `OIDC_ISSUER_URL` を使うだけです。

## 3. マニフェストを書く

```yaml
# .takosumi.yml
apiVersion: v1
metadata:
  id: examples.my-first-app
  name: my-first-app
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    routes:
      - my-first-app.example.com/*
    listen:
      operator.identity.oidc:
        as: env
interfaces:
  launch:
    target: web
    path: /
  health:
    target: web
    path: /healthz
```

## 4. ビルドスクリプトを用意

```bash
npm pkg set scripts.build="esbuild src/index.ts --bundle --outfile=dist/worker.mjs --format=esm"
npm install --save-dev esbuild
npm run build
```

`dist/worker.mjs` が生成されれば OK です。

## 5. Install dry-run と apply

```bash
# インストール内容の dry-run
takosumi install dry-run --source . --space "$TAKOSUMI_SPACE_ID" --json

# デプロイ
takosumi install --source . --space "$TAKOSUMI_SPACE_ID"
```

成功すると Installation が作成され、最初の Deployment が記録されます。

## 認証の仕組み

このアプリは認証を自分で実装していません。代わりに:

- **通常ログイン**: `/auth/oidc/login` から Takosumi Accounts にリダイレクトされ、
  コールバックでセッションが作られます
- **初回インストール直後**: launch token で自動的にセッションが作られるため、
  再ログイン不要でアプリが開きます

OIDC の設定 (clientId, clientSecret 等) は AppSpec で `listen: { operator.identity.oidc: { as: env } }`
を宣言するだけで、 takosumi-cloud (operator account plane) が provider として publish して
インストール時に自動で払い出されます。 worker は `OIDC_*` env を読むだけです。

詳しくは [OIDC consumer](/apps/oidc-consumer) を参照。

## 次のステップ

- [プロジェクト構成](/get-started/project-structure) — `.takosumi.yml` の全体像
- [Worker + Database](/examples/worker-with-db) — DB を追加する
- [Worker + Container](/examples/worker-with-container) — Docker コンテナと組み合わせる
- [サンプル集](/examples/) — その他のサンプル
