# yurucommu

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: バンドルアプリ yurucommu の概要。

yurucommu はセルフホスト型の ActivityPub /
コミュニティソーシャルアプリです。新しい Space
を作ると自動インストールされます。

## 役割

- social / community UI
- **`operator.identity.oidc` を listen** し、 Takosumi Accounts OIDC consumer
  として sign-in
- ActivityPub federation、 posts、 media、 DM、 community 機能を app 側で管理
- PostgreSQL / object-store component を AppSpec で宣言し、OIDC は
  `operator.identity.oidc` を listen する

## AppSpec (`.takosumi.yml`)

`spec.entrypoint` points to a runtime file inside the resolved source. Managed
install uses the prepared source produced by the build service when that file is
generated; direct Git/local apply is valid only when the file is already present
in the source snapshot.

```yaml
apiVersion: v1

metadata:
  id: com.yurucommu.app
  name: Yurucommu
  publisher: takos

components:
  web:
    kind: worker
    spec:
      entrypoint: dist/worker.js
    publish:
      http:
        as: http-endpoint
    listen:
      db:
        from: db.connection
        as: secret-env
        prefix: DB
      media:
        from: media.bucket
        as: secret-env
        prefix: MEDIA
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
      routes:
        - listener: public
          path: /
          to: upstream

  db:
    kind: postgres
    spec:
      size: small
    publish:
      connection:
        as: service-binding

  media:
    kind: object-store
    spec:
      name: yurucommu-media
    publish:
      bucket:
        as: object-store
```

gateway は public endpoint を作り、worker が ActivityPub / API / auth /
readiness の runtime path を処理します。 Takos product metadata は launcher
metadata を登録します。

## OIDC consumer

`listen.oidc.from: operator.identity.oidc` を web component
に宣言すると、Installation 作成時に takosumi-cloud (operator account plane) が
per-Installation OIDC client を Takosumi Accounts に登録し、 worker に
`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
`OIDC_REDIRECT_URI` を secretRef-mediated runtime env で inject します。
redirect URI は `/api/auth/callback/takos`、要求する scope は `openid` /
`profile` / `email`。

ActivityPub actor URL や callback URL など自分の public origin
が必要な処理は、operator runtime config の `APP_URL` を参照します。値は operator
domain policy と exposure activation 後に確定した public origin に合わせます。

## 関連ページ

- [AppSpec spec](https://takosumi.com/docs/reference/app-spec)
- [takosumi.com Type Catalog](https://takosumi.com/docs/reference/type-catalog)
- [OIDC Consumer](/apps/oidc-consumer)
