# yurucommu

> このページでわかること: バンドルアプリ yurucommu の概要。

yurucommu はセルフホスト型の ActivityPub / コミュニティソーシャルアプリです。
新しい Space を作ると自動インストールされます。

## 役割

- social / community UI
- **takosumi-cloud が publish する `operator.identity.oidc` namespace を listen** し、
  Takosumi Accounts OIDC consumer として sign-in
- ActivityPub federation、 posts、 media、 DM、 community 機能を app 側で管理
- PostgreSQL / object-store component を AppSpec で宣言 (OIDC は AppSpec に書かない)

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
    listen:
      com.yurucommu.app.db:
        as: env
        prefix: DB_
      com.yurucommu.app.media:
        as: env
        prefix: MEDIA_
      operator.identity.oidc:
        as: env

  db:
    kind: postgres
    publish:
      - com.yurucommu.app.db

  media:
    kind: object-store
    publish:
      - com.yurucommu.app.media

interfaces:
  launch:
    target: web
    path: /api/auth/login/takos
  health:
    target: web
    path: /readyz
```

## OIDC consumer

`listen: { operator.identity.oidc: { as: env } }` を web component に宣言すると、
Installation 作成時に takosumi-cloud (operator account plane) が provider として
per-Installation OIDC client を Takosumi Accounts に登録し、 worker に
`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URIS`
を env で inject します。 redirect URI は `/api/auth/callback/takos`、 要求する scope は
`openid` / `profile` / `email`。 OIDC component を AppSpec 側に書く必要はありません。

ActivityPub actor URL や callback URL など自分の public origin が必要な処理は、
worker の routes から導出される `APP_URL` を参照します。

## 関連ページ

- [AppSpec spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [Component Kind Catalog](https://github.com/tako0614/takosumi/blob/master/docs/reference/component-kind-catalog.md)
- [OIDC Consumer](/apps/oidc-consumer)
