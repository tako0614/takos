# デプロイマニフェスト (`.takosumi.yml`)

> このページでわかること: `.takosumi.yml` の書き方と各フィールドの意味。

source root に置く `.takosumi.yml` (= AppSpec) が唯一のマニフェストです。 1 ファイルで
install + deploy + rollback まで動きます。

仕様の正本は [AppSpec
spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md) と
[Component Kind
Catalog](https://github.com/tako0614/takosumi/blob/master/docs/reference/component-kind-catalog.md)
を参照してください。

## 基本原則

- `apiVersion: takosumi.dev/v1` と `kind: App` は必須
- runtime-bearing unit は `components.<name>` として書き、 `kind` を 5 種
  (`worker` / `postgres` / `object-store` / `oidc` / `custom-domain`) から選ぶ
- workflow / CI / cron は AppSpec に内包しない (= `component.build` の最小 recipe のみ表現可)
- component 間の依存は `use:` edge で構造的に宣言する (= 文字列 placeholder は廃止)

## Worker

```yaml
apiVersion: takosumi.dev/v1
kind: App
metadata:
  id: com.example.simple-worker
  name: Simple Worker
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    routes:
      - simple-worker.example.com/*
```

## DB 付き Worker

```yaml
apiVersion: takosumi.dev/v1
kind: App
metadata:
  id: com.example.api
  name: API
components:
  api:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    routes:
      - api.example.com/*
    use:
      db:
        env: DATABASE_URL
  db:
    kind: postgres
    spec:
      class: standard
```

## OIDC consumer

```yaml
apiVersion: takosumi.dev/v1
kind: App
metadata:
  id: com.example.notes
  name: Notes
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    routes:
      - /
    use:
      auth:
        mount: oidc
  auth:
    kind: oidc
    redirectPaths:
      - /api/auth/callback
    scopes: [openid, profile, email]

interfaces:
  launch:
    target: web
    path: /api/auth/login
  health:
    target: web
    path: /healthz
```

`use: { mount: oidc }` が宣言されると、 Installation 作成時に Takosumi Accounts が
per-Installation OIDC client を発行し、 `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` /
`OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URIS` を worker の env に inject します。

## 関連ページ

- [AppSpec spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [Component Kind Catalog](https://github.com/tako0614/takosumi/blob/master/docs/reference/component-kind-catalog.md)
- [Installer API (5 endpoint)](https://github.com/tako0614/takosumi/blob/master/docs/reference/installer-api.md)
