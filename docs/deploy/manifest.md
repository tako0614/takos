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

- `apiVersion: takosumi.dev/v1` は必須 (= AppSpec root の discriminator)
- runtime-bearing unit は `components.<name>` として書き、 `kind` を catalog から選ぶ
  (= catalog は extensible で、 alias / URI による拡張可)
- workflow / CI / cron は AppSpec に内包しない (= `component.build` の最小 recipe のみ表現可)
- component 間の依存は namespace pub/sub (`publish` / `listen`) で構造的に宣言する
  (= 文字列 placeholder / `use:` edge は廃止)

## Worker

```yaml
apiVersion: takosumi.dev/v1
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
    listen:
      com.example.api.db:
        as: env
        prefix: DB_
  db:
    kind: postgres
    publish:
      - com.example.api.db
    spec:
      class: standard
```

## OIDC consumer

```yaml
apiVersion: takosumi.dev/v1
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
    listen:
      operator.identity.oidc:
        as: env

interfaces:
  launch:
    target: web
    path: /api/auth/login
  health:
    target: web
    path: /healthz
```

`listen: { operator.identity.oidc: { as: env } }` が宣言されると、 Installation 作成時に
takosumi-cloud が publish する `operator.identity.oidc` namespace から per-Installation
OIDC client が発行され、 `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
`OIDC_REDIRECT_URIS` が worker の env に inject されます。 OIDC kind 自身は AppSpec に
書かず、 takosumi-cloud (operator account plane) が provider として提供します。

## 関連ページ

- [AppSpec spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [Component Kind Catalog](https://github.com/tako0614/takosumi/blob/master/docs/reference/component-kind-catalog.md)
- [Installer API (5 endpoint)](https://github.com/tako0614/takosumi/blob/master/docs/reference/installer-api.md)
