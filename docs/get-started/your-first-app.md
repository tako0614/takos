# はじめての group

シンプルな Worker group を作って staging にデプロイし、Takos
の基本的な流れを一通り触る。所要時間 10 分。

## このチュートリアルで作るもの

- 1 つの `worker@v1` resource (HTTP "Hello" を返す Worker)
- 認証は **OIDC consumer** として `takosumi.account.auth@v1` で解決される
  Takosumi Accounts を consume する形。app に OAuth provider を組み込む必要は
  ありません ([apps/oidc-consumer](/apps/oidc-consumer))。
- install 完了後の初回 UX は **launch token** で繋ぐので、ユーザーは install
  直後に再度ログインする必要なく chat (= 本 app) が開きます
  ([apps/launch-token](/apps/launch-token))。

```text
[Install] → AppInstallation 作成 → OIDC client binding 発行
        → launch token 発行 → /_takosumi/launch で owner session 作成
        → そのまま app が開く
```

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
    env: {
      OIDC_ISSUER_URL?: string;
      OIDC_CLIENT_ID?: string;
      OIDC_CLIENT_SECRET?: string;
      OIDC_REDIRECT_URI?: string;
      TAKOS_INSTALLATION_ID?: string;
    },
  ): Promise<Response> {
    return new Response(
      `Hello from Takos! (installation=${
        env.TAKOS_INSTALLATION_ID ?? "n/a"
      }, ` +
        `oidc=${env.OIDC_ISSUER_URL ?? "n/a"})`,
      { headers: { "content-type": "text/plain" } },
    );
  },
};
```

env はすべて install 時に compile された `.takosumi/manifest.yml` から
注入されます (placeholder の正本は
[reference/manifest-spec § Compile-time placeholders](/reference/manifest-spec#compile-time-placeholders))。
app コードからは Takosumi 専用 SDK を使わず、標準的な OIDC client library で
`OIDC_ISSUER_URL` を consume するだけにします。

## 3. Takos の deploy manifest を書く

```bash
mkdir -p .takosumi/workflows
```

```yaml
# .takosumi/manifest.yml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: my-first-group
imports:
  - alias: account-auth
    service: takosumi.account.auth@v1
serviceResolvers:
  - kind: anchor
    url: https://anchor.example.com/v1/services/
    publicKey: BASE64_ED25519_PUBLIC_KEY
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
        - my-first-group.example.com/*
      env:
        AUTH_DRIVER: oidc
        OIDC_ISSUER_URL: ${imports.account-auth.endpoints.oidc-issuer.url}
        OIDC_CLIENT_ID: ${bindings.auth.clientId}
        OIDC_CLIENT_SECRET: ${secrets.auth.clientSecret}
        OIDC_REDIRECT_URI: ${bindings.auth.redirectUri}
        TAKOS_INSTALLATION_ID: ${installation.id}
    workflowRef:
      file: .takosumi/workflows/deploy.yml
      job: bundle
      artifact: web
      target: spec.artifact.hash
```

`workflowRef` は takosumi-git の private extension です。workflow を実行して
`spec.artifact.hash` を埋め、`workflowRef` を strip してから kernel の
`POST /v1/deployments` に渡します。

installable app として配布する場合は `.takosumi/app.yml` に OIDC / launch token
binding も宣言します。

```yaml
# .takosumi/app.yml
apiVersion: app.takosumi.dev/v1
kind: InstallableApp
id: examples.my-first-group
name: My First Group
bindings:
  auth:
    type: identity.oidc@v1
    redirectPaths:
      - /auth/oidc/callback
  bootstrap:
    type: install-launch-token@v1
```

## 4. ワークフローを書く

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

## 6. 認証 (OIDC consumer + launch token)

このチュートリアル app は OAuth provider を **持ちません**。代わりに、

- 通常ログイン: `/auth/oidc/login` → Takosumi Accounts (または self-host 時は
  Keycloak / Authentik 等) へ redirect → `/auth/oidc/callback` で session を作る
  ([apps/oidc-consumer](/apps/oidc-consumer))。
- 初回 install 直後だけは launch token で owner session を作る:
  `/_takosumi/launch?token=...` ([apps/launch-token](/apps/launch-token))。

OIDC client (clientId / clientSecret / redirectUri) は `.takosumi/app.yml` の
`bindings.auth` で `identity.oidc@v1` として宣言し、AppInstallation ごとに
Takosumi Accounts が払い出します。app コード側では `OIDC_ISSUER_URL` /
`OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` env
を読むだけです。

## 7. デプロイ

```bash
takos login
takos deploy --env staging --space SPACE_ID
```

::: tip CLI は Takos の認証情報を使います。`takos login` 後は `--account-id` や
`--api-token` を渡す必要はありません。 :::

デプロイ成功すると URL が表示される。ブラウザで開いて "Hello from Takos!"
が出れば成功。`takos deploy` は default で resolve + apply を 1 step で実行する
Heroku 風 sugar です。

manifest の整合性だけ先に確認したい場合:
`takos deploy --preview --space SPACE_ID` (in-memory preview)。 reviewer
に渡したい場合は `takos deploy --resolve-only --space SPACE_ID` で resolved
Deployment record を作り、`takos diff <id>` / `takos apply <id>`
で確認・適用を分離できます。

::: tip `.takosumi/manifest.yml` には `apiVersion: "1.0"` と `kind: Manifest`
が必須です。`workflowRef` や `${bindings.*}` は authoring-time extension
なので、kernel-bound manifest に到達する前に materialize / strip されます。 :::

## 次のステップ

- [Installable App Model](/architecture/installable-app-model) -- app が
  AppInstallation として install される仕組み
- [apps/oidc-consumer](/apps/oidc-consumer) -- OIDC consumer 化の正本
- [apps/launch-token](/apps/launch-token) -- install 直後の owner session 生成
- [Takos 全体像](/overview/) -- platform の基本単位を確認する
- [プロジェクト構成](/get-started/project-structure) -- `.takosumi/`
  ディレクトリの全体像
- [Worker + Database](/examples/worker-with-db) -- D1 を追加する
- [Worker + Container](/examples/worker-with-container) -- Docker
  コンテナを組み合わせる
