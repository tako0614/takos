# アカウントモデル

> このページでわかること: Takos のアカウント・認証の所有権がどこにあるか。

Takos は OIDC consumer であり、自前のアカウント管理は持ちません。 Takosumi
Accounts が発行する OIDC クライアントを使って認証します。

## 所有権の一覧

| 対象                                   | 管理元                           |
| -------------------------------------- | -------------------------------- |
| account / credential / upstream IdP    | Takosumi Accounts                |
| billing / AppInstallation ledger       | Takosumi Accounts                |
| OIDC issuer / client registration      | Takosumi Accounts                |
| Takos の app-local profile / session   | Takos app                        |
| dedicated runtime binding / source pin | AppInstallation + RuntimeBinding |

Keycloak / Authentik / Auth0 などを使う場合も、Takos runtime へ直接 issuer
として 渡しません。Takosumi Accounts の upstream IdP として接続し、Takos runtime
の `OIDC_ISSUER_URL` は Accounts issuer を指します。

## OIDC Identity Resolution

Takos app の OIDC callback は、実装上この順序で user を解決します。

1. `auth_identities` に `provider = oidc` かつ `provider_sub = <issuer>#<sub>`
   がある場合、その `user_id` の active account を使う
2. 未リンクで、ID token または UserInfo の `email_verified = true` email
   がある場合、同じ email の active app-local profile を再利用する
3. 既存 active account がない場合、新しい app-local profile を作る
4. 解決した account に `auth_identities(provider=oidc)` を作り、以後は
   `<issuer>#<sub>` で解決する

inactive account に email が一致した場合は login を失敗させます。未検証 email は
account merge に使わず、表示・監査用の `email_snapshot` にのみ残します。

## オペレーターチェックリスト

- Takosumi Accounts の issuer が `operator.identity.oidc` export / OIDC
  discovery で解決できること
- `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
  `OIDC_REDIRECT_URI` が AppBinding (`identity.oidc@v1`) から materialize
  されること

automation credential は Takosumi Accounts が発行する bearer / PAT を使います。
Takos app-local `personal_access_tokens` は発行元ではなく historical / local
credential inventory として扱い、current automation credential の owner は
Takosumi Accounts です。

## Dedicated Runtime Adoption

この項目は internal operator evidence / adoption 用であり、public install 導線の
手順ではありません。current public install は最初から AppInstallation 経由で作成します。

operator が既に動いている dedicated runtime を Accounts-owned `AppInstallation`
として記録する場合は、AppInstallation `mode: dedicated`、explicit
`RuntimeBinding`、source pin、binding、grant、launch token bootstrap をまとめて
作成します。private operator 手順は
[dedicated runtime adoption runbook](https://github.com/tako0614/takos-private/blob/main/docs/operations/dedicated-runtime-appinstallation-adoption.md)
を参照してください。

## 検証

Takos app root で OIDC account model を確認します。

```bash
cd takos/app
deno test --allow-all packages/control/src/server/routes/auth/__tests__/oidc-router.test.ts
deno task test:api
deno task validate:migration-safety
```

Takos docs root では、Operator docs と architecture alignment を確認します。

```bash
cd takos
deno task validate:architecture
deno task docs:build
```

## ロールバック

rollback は backup を使った短期復旧に限定します。OIDC identity の state は
`auth_identities` を正とします。

- deploy を戻す場合も Takosumi Accounts issuer / AppInstallation ledger
  は維持する
- user merge を取り消す場合は `auth_identities` の対象 row を削除し、次回 login
  で verified email linking をやり直す
