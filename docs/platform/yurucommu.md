# yurucommu

> このページでわかること: バンドルアプリ yurucommu の概要。

yurucommu はセルフホスト型の ActivityPub / コミュニティソーシャルアプリです。
新しい Space を作ると自動インストールされます。

## 役割

- social / community UI
- **Takosumi Accounts OIDC consumer (`kind: oidc` component)** で sign-in
- ActivityPub federation、 posts、 media、 DM、 community 機能を app 側で管理
- PostgreSQL / object-store / OIDC component を AppSpec で宣言

## AppSpec (`.takosumi.yml`)

```yaml
apiVersion: takosumi.dev/v1
kind: App

metadata:
  id: com.yurucommu.app
  name: Yurucommu
  publisher: takos

components:
  web:
    kind: worker
    build:
      command: deno task build:worker
      output: dist/worker.mjs
    routes:
      - /
      - /api
      - /ap
      - /users
      - /communities
      - /inbox
    use:
      db:
        envPrefix: DB_
      media:
        envPrefix: MEDIA_
      auth:
        mount: oidc

  db:
    kind: postgres

  media:
    kind: object-store

  auth:
    kind: oidc
    redirectPaths:
      - /api/auth/callback/takos
    scopes:
      - openid
      - profile
      - email

interfaces:
  launch:
    target: web
    path: /api/auth/login/takos
  health:
    target: web
    path: /readyz
```

## OIDC consumer

`use: { mount: oidc }` で auth component を `web` component に bind すると、
Installation 作成時に Takosumi が Takosumi Accounts に per-Installation OIDC client
を登録し、 worker に `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
`OIDC_REDIRECT_URIS` を env で inject します。 redirect URI は
`/api/auth/callback/takos`、 要求する scope は `openid` / `profile` / `email`。

ActivityPub actor URL や callback URL など自分の public origin が必要な処理は、
worker の routes から導出される `APP_URL` を参照します。

## 関連ページ

- [AppSpec spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [Component Kind Catalog](https://github.com/tako0614/takosumi/blob/master/docs/reference/component-kind-catalog.md)
- [OIDC Consumer](/apps/oidc-consumer)
