# yurucommu

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: バンドルアプリ yurucommu の概要。

yurucommu はセルフホスト型の ActivityPub /
コミュニティソーシャルアプリです。新しい Space
を作ると自動インストールされます。

## 役割

- social / community UI
- **`identity.primary.oidc` を listen** し、 Takosumi Accounts OIDC consumer
  として sign-in
- ActivityPub federation、 posts、 media、 DM、 community 機能を app 側で管理
- PostgreSQL / object-store component を AppSpec で宣言し、OIDC は
  `identity.primary.oidc` を listen する

## Install / launch

Browser users install yurucommu through the Takosumi Cloud install wizard:

```text
https://cloud.takosumi.com/apps/install?git=https://github.com/tako0614/yurucommu.git&ref=main&mode=shared-cell&autodryrun=1
```

The local substrate mirror rewrites that host to `cloud.takosumi.test`. The wizard performs the account-plane dry-run,
then apply, and records the Installation in the Cloud ledger before exposing the launch action.

yurucommu launch opens the activated public HTTP endpoint, for example `https://yurucommu.test` in local substrate.
Sign-in is handled by yurucommu as a Takosumi Accounts OIDC consumer. Takos' `/_takosumi/launch` token bootstrap is a
Takos product launch path and is not required for yurucommu.

## AppSpec (`.takosumi.yml`)

`spec.entrypoint` points to a runtime file inside the resolved source. Managed install uses a prepared source snapshot
where `dist/worker.js` has already been generated from `.takosumi.build.yml`; direct local apply is valid only after the
same file exists in the checkout.

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
    connect:
      db:
        output: db.connection
        inject: secret-env
        prefix: DB
      media:
        output: media.bucket
        inject: secret-env
        prefix: MEDIA
    listen:
      oidc:
        path: identity.primary.oidc
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
      routes:
        - listener: public
          path: /
          to: upstream

  db:
    kind: postgres
    spec:
      version: "16"
      size: small

  media:
    kind: object-store
    spec:
      name: yurucommu-media

publish:
  public:
    output: public.public
    path: yurucommu.http.public
```

gateway は public endpoint を作り、worker が ActivityPub / API / auth /
readiness の runtime path を処理します。 Takos product metadata は launcher
metadata を登録します。

## OIDC consumer

`listen.oidc.path: identity.primary.oidc` を web component
に宣言すると、Installation 作成時に takosumi-cloud (operator account plane、リファレンス実装: Takosumi Accounts) が
per-Installation OIDC client を Takosumi Accounts に登録し、 worker に
`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
`OIDC_REDIRECT_URI` を secretRef-mediated runtime env で inject します。
redirect URI は `/api/auth/callback/takos`、要求する scope は `openid` /
`profile` / `email`。

ActivityPub actor URL や callback URL など自分の public origin
が必要な処理は、operator runtime config の `APP_URL` を参照します。値は operator
domain policy と exposure activation 後に確定した public origin に合わせます。

Cloud install 後の起動は、Cloud の Installation detail から activated public HTTP endpoint
を開き、yurucommu 側の Takosumi Accounts OIDC sign-in で初回 user session を作る形を正本にします。Takos product の
`/_takosumi/launch` launch-token bootstrap は Takos product 用の起動 path であり、yurucommu にそのまま要求しません。

## 関連ページ

- [AppSpec spec](https://takosumi.com/docs/reference/manifest)
- [Takosumi Official Catalog](https://takosumi.com/docs/reference/catalog)
- [OIDC Consumer](/apps/oidc-consumer)
