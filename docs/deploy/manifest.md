# Takos AppSpec 例 (`.takosumi.yml`)

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: Takos app で使う `.takosumi.yml` の最小例。

source root に置く `.takosumi.yml` (= AppSpec) が唯一のマニフェストです。 1
ファイルで install + deploy + rollback まで動きます。

このページは Takos product docs の短い実例です。field / schema の正本は
[Takosumi AppSpec](https://takosumi.com/docs/reference/app-spec)、
[takosumi.com Type Catalog](https://takosumi.com/docs/reference/type-catalog)、
[Takosumi Cloud entry point](https://takosumi.com/docs/reference/takosumi-cloud)
を参照してください。

## 基本原則

- `apiVersion: v1` は必須 (= AppSpec root の discriminator)
- runtime / resource / ingress は `components.<name>` として書き、 `kind` は
  operator の alias map または URI で解決する
- workflow / CI / cron / build command は AppSpec に内包しない。build service /
  CI は prepared source archive を Installer API に渡す
- component 間の依存は AppSpec `publish.<name>.as` / `listen.<binding>.from`
  で構造的に宣言する (= 文字列 placeholder / `use:` edge は廃止)
- public app endpoint は workload が `http-endpoint` を publish し、`gateway`
  のような ingress component が listen して listener / gateway descriptor intent を持つ
- The route list in gateway `spec` は adopted gateway descriptor の open `spec`
  であり、 AppSpec core field ではない
- `spec.entrypoint` は resolved source / prepared archive 内に既に存在する
  runtime file を指し、build declaration ではない

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
      entrypoint: src/worker.ts
    publish:
      http:
        as: http-endpoint
  public:
    kind: gateway
    listen:
      upstream:
        from: web.http
        as: upstream
    publish:
      public:
        as: http-endpoint
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
      entrypoint: src/worker.ts
    publish:
      http:
        as: http-endpoint
    listen:
      db:
        from: db.connection
        as: secret-env
        prefix: DB
  db:
    kind: postgres
    publish:
      connection:
        as: service-binding
    spec:
      class: standard
  public:
    kind: gateway
    listen:
      upstream:
        from: api.http
        as: upstream
    publish:
      public:
        as: http-endpoint
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
      entrypoint: src/worker.ts
    publish:
      http:
        as: http-endpoint
    listen:
      oidc:
        from: operator.identity.oidc
        as: secret-env
        prefix: OIDC
        required: true
  public:
    kind: gateway
    listen:
      upstream:
        from: web.http
        as: upstream
    publish:
      public:
        as: http-endpoint
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

`listen.oidc.from: operator.identity.oidc` が宣言されると、 Installation
作成時に takosumi-cloud の operator-owned external publication から
per-Installation OIDC client が発行されます。 `OIDC_ISSUER_URL` /
`OIDC_CLIENT_ID` / `OIDC_REDIRECT_URI` は non-secret runtime
config、`OIDC_CLIENT_SECRET` は `secretRef` / `secret-env` 経由の secret
material です。OIDC は operator account plane の external publication
として受け取ります。

adopted gateway/ingress component は public endpoint を作ります。OIDC login / callback /
logout、launcher、health の runtime path は worker 実装と Takos product 内部 app
metadata で扱います。

## 関連ページ

- [Takosumi AppSpec](https://takosumi.com/docs/reference/app-spec)
- [takosumi.com Type Catalog](https://takosumi.com/docs/reference/type-catalog)
- [Takosumi Cloud entry point](https://takosumi.com/docs/reference/takosumi-cloud)
- [Installer API (5 endpoint)](https://takosumi.com/docs/reference/installer-api)
