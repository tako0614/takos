# Account Migration

このページは、旧 Takos local account を Takosumi Account / OIDC consumer
モデルへ寄せる operator 向け移行ガイドです。Takos は OAuth/OIDC issuer ではなく、
Takosumi Accounts が発行する per-AppInstallation OIDC client を consume します。

## 移行後の正本

移行後の ownership は次の形に固定します。

| 対象 | 正本 |
| --- | --- |
| account / credential / upstream IdP | Takosumi Accounts |
| billing / AppInstallation ledger | Takosumi Accounts |
| OIDC issuer / client registration | Takosumi Accounts |
| Takos の app-local profile / session | Takos app |
| dedicated tenant の runtime binding / source pin | AppInstallation + RuntimeBinding |

Keycloak / Authentik / Auth0 などを使う場合も、Takos runtime へ直接 issuer として
渡しません。Takosumi Accounts の upstream IdP として接続し、Takos runtime の
`OIDC_ISSUER_URL` は Accounts issuer を指します。

## 移行条件

Takos app の OIDC callback は、実装上この順序で user を解決します。

1. `auth_identities` に `provider = oidc` かつ `provider_sub = <issuer>#<sub>` が
   ある場合、その `user_id` の active account を使う
2. 未リンクで、ID token または UserInfo の `email_verified = true` email がある場合、
   同じ email の active account を旧 Takos user として再利用する
3. 既存 active account がない場合、新しい app-local profile を作る
4. 解決した account に `auth_identities(provider=oidc)` を作り、以後は
   `<issuer>#<sub>` で解決する

inactive account に email が一致した場合は login を失敗させます。未検証 email は
account merge に使わず、表示・監査用の `email_snapshot` にのみ残します。

## 事前確認

移行前に次を確認します。

- `accounts.email` が重複していないこと
- 既存 operator / owner account が `status = active` であること
- Takosumi Accounts の issuer が `operator.identity.oidc` export / OIDC discovery で
  解決できること
- `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
  `OIDC_REDIRECT_URI` が AppBinding (`identity.oidc@v1`) から materialize されること
- app-local password / OAuth provider / PAT / billing owner table を current contract として
  参照している運用手順が残っていないこと

旧 `personal_access_tokens` は移行しません。automation は Takosumi Accounts が発行する
bearer / PAT へ作り直します。

## 手順

1. current database と secret store を backup する
2. Takosumi Accounts 側で AppInstallation と OIDC client を発行する
3. Takos runtime に `AUTH_DRIVER=oidc` と `OIDC_*` env を入れる
4. `/auth/oidc/login` から login し、旧 user email と同じ verified email で
   callback させる
5. session の `user_id` が旧 account id のままであることを確認する
6. `auth_identities.provider = oidc` / `provider_sub = <issuer>#<sub>` /
   `email_kind = oidc_verified` が作られたことを確認する
7. legacy local auth route / OAuth issuer route / billing owner route を公開経路から外す

dedicated tenant は account migration だけで完了しません。AppInstallation
の `mode: dedicated`、explicit `RuntimeBinding`、source pin、binding、grant、launch
token bootstrap まで含めて
[dedicated tenant AppInstallation migration runbook](https://github.com/tako0614/takos-private/blob/main/docs/operations/dedicated-tenant-appinstallation-migration.md)
に従います。

## Deprecation window

legacy route の deprecation は release window で扱います。

| window | 目的 | legacy surface |
| --- | --- | --- |
| release N | OIDC consumer を default にし、旧 route は warning / audit only にする | read-only fallback |
| release N+1 | Takosumi Account migration を完了し、新規 credential 発行を止める | login fallback only |
| release N+2 | OAuth issuer / local credential / app-local PAT / billing owner route を削除する | removed |

削除後も `accounts` / `auth_identities` / `auth_sessions` / `sessions` は Takos app-local
runtime table として残します。`oauth_clients`、`oauth_authorization_codes`、
`oauth_tokens`、`auth_services`、`billing_accounts`、`billing_transactions`、
`account_password_credentials`、`personal_access_tokens`、`pat_revoked` は current
boundary の正本ではありません。

## 検証

Takos app root で、移行条件と legacy boundary migration を確認します。

```bash
cd takos/app
deno test --allow-all packages/control/src/server/routes/auth/__tests__/oidc-router.test.ts --filter "legacy Takos account"
deno test --allow-all apps/control/test/integration/legacy-auth-boundary-migration.test.ts
deno task validate:migration-safety
```

Takos docs root では、Operator docs と architecture alignment を確認します。

```bash
cd takos
deno task validate:architecture
deno task docs:build
```

## Rollback

rollback は backup を使った短期復旧に限定します。OIDC identity が作られた後は
`auth_identities` を current state として扱い、旧 credential table を再び正本に
戻しません。

- deploy を戻す場合も Takosumi Accounts issuer / AppInstallation ledger は維持する
- user merge を取り消す場合は `auth_identities` の対象 row を削除し、次回 login で
  verified email migration をやり直す
- OAuth issuer / billing owner / local PAT route を再公開する rollback は行わない
