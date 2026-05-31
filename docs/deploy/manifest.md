# Takos AppSpec 例 (`.takosumi.yml`)

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: Takos app で使う `.takosumi.yml` の最小例。

source root に置く `.takosumi.yml` (= AppSpec) が唯一のマニフェストです。 1
ファイルで install + deploy + rollback まで動きます。

このページは Takos product docs の短い実例です。field / schema の正本は
[Takosumi AppSpec](https://takosumi.com/docs/reference/manifest)、
[takosumi.com Official Catalog](https://takosumi.com/docs/reference/catalog)、
[Takosumi Cloud entry point](https://takosumi.com/docs/reference/takosumi-cloud)
を参照してください。

## 基本原則

- `apiVersion: v1` は必須 (= AppSpec root の discriminator)
- runtime / resource / ingress は `components.<name>` として書き、 `kind` は
  operator の alias map または URI で解決する
- workflow / CI / cron / build command は AppSpec に内包しない。build service /
  CI は prepared source archive を Installer API に渡す
- component 間の依存は AppSpec `connect.<binding>.output` で構造的に宣言する
  (= 文字列 placeholder / `use:` edge は廃止)
- public app endpoint は workload の `http` output を `gateway` のような
  ingress component が `connect` して listener / gateway descriptor intent を持つ
- The route list in gateway `spec` は adopted gateway descriptor の open `spec`
  であり、 AppSpec core field ではない
- `spec.entrypoint` は resolved source / prepared archive 内に既に存在する
  runtime file を指し、build declaration ではない

## Takos product manifest

Takos product 自体の installable source root は repository root です。実際の
manifest は `.takosumi.yml` に置き、`takos-worker` / `takos-git` /
`takos-agent` を `web-service` component、Postgres と object storage を
resource component、public HTTP entry を `gateway` component として宣言します。

この manifest は build 手順ではありません。OCI image の作成、tag pinning、
prepared source archive の作成は CI / operator build service が行い、Installer
API には source と expected guard を渡します。

## Worker

```yaml
apiVersion: v1
metadata:
  id: com.example.simple-worker
  name: Simple Worker
components:
  web:
    kind: worker
    spec:
      entrypoint: src/worker/index.ts
  public:
    kind: gateway
    connect:
      upstream:
        output: web.http
        inject: upstream
    spec:
      listeners:
        public:
          protocol: https
          host: simple-worker.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

## DB 付き Worker

```yaml
apiVersion: v1
metadata:
  id: com.example.api
  name: API
components:
  api:
    kind: worker
    spec:
      entrypoint: src/worker/index.ts
    connect:
      db:
        output: db.connection
        inject: secret-env
        prefix: DB
  db:
    kind: postgres
    spec:
      class: standard
  public:
    kind: gateway
    connect:
      upstream:
        output: api.http
        inject: upstream
    spec:
      listeners:
        public:
          protocol: https
          host: api.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

## OIDC consumer

```yaml
apiVersion: v1
metadata:
  id: com.example.notes
  name: Notes
components:
  web:
    kind: worker
    spec:
      entrypoint: src/worker/index.ts
    listen:
      oidc:
        path: identity.primary.oidc
        kind: identity.oidc@v1
        inject: secret-env
        prefix: OIDC
        required: true
  public:
    kind: gateway
    connect:
      upstream:
        output: web.http
        inject: upstream
    spec:
      listeners:
        public:
          protocol: https
          host: notes.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

`listen.oidc.path: identity.primary.oidc` が宣言されると、 Installation
作成時に takosumi-cloud の operator-owned platform service から
per-Installation OIDC client が発行されます。 `OIDC_ISSUER_URL` /
`OIDC_CLIENT_ID` / `OIDC_REDIRECT_URI` は non-secret runtime
config、`OIDC_CLIENT_SECRET` は `secretRef` / `secret-env` 経由の secret
material です。OIDC は operator account plane (リファレンス実装: Takosumi Accounts) の platform service
として受け取ります。

adopted gateway/ingress component は public endpoint を作ります。OIDC login / callback /
logout、launcher、health の runtime path は worker 実装と Takos product 内部 app
metadata で扱います。

## 関連ページ

- [Takosumi AppSpec](https://takosumi.com/docs/reference/manifest)
- [takosumi.com Official Catalog](https://takosumi.com/docs/reference/catalog)
- [Takosumi Cloud entry point](https://takosumi.com/docs/reference/takosumi-cloud)
- [Installer API (5 endpoint)](https://takosumi.com/docs/reference/installer-api)
