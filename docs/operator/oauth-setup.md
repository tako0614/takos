# OAuth Setup

Takos の OAuth 設定は 2 種類あります。

- **Operator login**: Takos admin Web に入るための Google OAuth
- **Takos OAuth server**: tenant app / default app / 外部 client が Takos API
  へアクセスするための `/oauth/*`

このページは operator login を先に成立させ、その後 Takos OAuth server
の公開 URL と client secret 経路を確認する runbook です。

## Required Values

`apps/control` の現在の Web/auth route は次の env を参照します。

| key                             | secret | 用途                                                              |
| ------------------------------- | ------ | ----------------------------------------------------------------- |
| `ADMIN_DOMAIN`                  | no     | Takos admin Web / OAuth issuer の host。例: `admin.example.com`   |
| `TENANT_BASE_DOMAIN`            | no     | tenant app の base domain。例: `app.example.com`                  |
| `AUTH_PUBLIC_BASE_URL`          | no     | external auth page が home link として使う public origin          |
| `AUTH_ALLOWED_REDIRECT_DOMAINS` | no     | `/auth/external` が許可する redirect host の allowlist            |
| `GOOGLE_CLIENT_ID`              | no     | Google OAuth client ID                                            |
| `GOOGLE_CLIENT_SECRET`          | yes    | Google OAuth client secret                                        |
| `SESSION_DO`                    | binding | browser session store                                            |
| `DB`                            | binding | account / session / OAuth state persistence                       |

Cloudflare Workers profile では non-secret は `wrangler.toml` の `[vars]`、
secret は `wrangler secret put` で入れます。本番・staging の実値は
`takos-private/` 側の deploy / secret 管理を正本にしてください。

## Google OAuth

Google OAuth client の redirect URI は admin domain に対して固定です。

```text
https://<ADMIN_DOMAIN>/auth/callback
```

外部 service login handoff を使う場合は、同じ Google OAuth client に次の redirect
URI も登録します。

```text
https://<ADMIN_DOMAIN>/auth/external/callback
```

`GOOGLE_CLIENT_ID` は non-secret var、`GOOGLE_CLIENT_SECRET` は secret です。
Cloudflare profile の例:

```bash
wrangler secret put GOOGLE_CLIENT_SECRET --config apps/control/wrangler.toml
```

`ADMIN_DOMAIN` と redirect URI の host は一致させます。staging と production
で domain が違う場合は、Google OAuth client も分けるか、両方の redirect URI
を明示登録してください。

## Public Origins

`AUTH_PUBLIC_BASE_URL` は login / external auth HTML が Takos admin へ戻すための
public origin です。通常は `https://<ADMIN_DOMAIN>` にします。

```env
ADMIN_DOMAIN=admin.example.com
AUTH_PUBLIC_BASE_URL=https://admin.example.com
```

`AUTH_ALLOWED_REDIRECT_DOMAINS` は `/auth/external` で外部 service へ token
handoff するときの allowlist です。カンマ区切りで operator が管理する tenant
app / default app の host を入れます。

```env
AUTH_ALLOWED_REDIRECT_DOMAINS=app.example.com,docs.example.com
```

未設定時でも fallback として `ADMIN_DOMAIN`, `localhost`, `127.0.0.1`
は許可されますが、production では明示 allowlist を置いてください。

## Takos OAuth Server

Takos OAuth server は admin origin 上の `/oauth/*` と `/.well-known/*`
で公開されます。

| endpoint                                  | 用途                                   |
| ----------------------------------------- | -------------------------------------- |
| `/.well-known/oauth-authorization-server` | OAuth server metadata                  |
| `/.well-known/openid-configuration`       | OIDC discovery                         |
| `/.well-known/jwks.json`                  | JWT 検証用 JWK                         |
| `/oauth/authorize`                        | Authorization Code Flow                |
| `/oauth/token`                            | authorization code / refresh / device  |
| `/oauth/register`                         | Dynamic Client Registration            |
| `/oauth/device`                           | Device Authorization UI                |

tenant app が OAuth client を必要とする場合、Takos Web の OAuth client 管理
または `/api/me/oauth/clients` / `/oauth/register` を使います。manifest から
client を要求する場合は `takos.oauth-client` publication を consume します。

## Smoke Checks

設定後に admin domain から確認します。

```bash
curl -fsS https://<ADMIN_DOMAIN>/health
curl -fsS https://<ADMIN_DOMAIN>/.well-known/oauth-authorization-server
```

browser では次を確認します。

1. `https://<ADMIN_DOMAIN>/auth/login` が Google OAuth へ redirect する
2. Google callback が `https://<ADMIN_DOMAIN>/auth/callback` へ戻る
3. 初回ユーザーが `/setup` に進む
4. setup 完了後に Takos Web の main app が表示される

## Migration Note

`apps/api` は auth / OAuth route の移行先ですが、現時点では full auth surface
を持っていません。Google login、OAuth server、account/profile/billing の多くは
`apps/control` の legacy compatibility route で動きます。callback URL は移行後も
変えず、既存 OAuth client の再発行を避けます。
