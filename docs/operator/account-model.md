# アカウントモデル

> このページでわかること: Takos のアカウント・認証の所有権がどこにあるか。

Takos product routes は OIDC consumer であり、credential issuer / billing owner にはなりません。外部 Takosumi
Accounts plane が OIDC issuer と client projection を所有し、Takos はその subject から
app-local profile / session を作ります。

## 所有権の一覧

| 対象                                 | 管理元                                           |
| ------------------------------------ | ------------------------------------------------ |
| account / credential / upstream IdP  | Takosumi Accounts plane                 |
| billing / Capsule Run ledger        | Takosumi Accounts / deploy-control      |
| OIDC issuer / client registration    | Takosumi Accounts plane                 |
| Takos の app-local profile / session | Takos app                                        |
| dedicated runtime mode / source pin  | Capsule + operator-private runtime evidence       |

Keycloak / Authentik / Auth0 などを使う場合も、Takos product runtime へ直接 issuer として渡しません。Takosumi Accounts
plane の upstream IdP として接続し、Takos runtime の `OIDC_ISSUER_URL` は Takosumi Accounts issuer を指します。

## OIDC Identity Resolution

Takos app の OIDC callback は、実装上この順序で user を解決します。

1. `auth_identities` に `provider = oidc` かつ `provider_sub = <issuer>#<sub>` がある場合、その `user_id` の active
   account を使う
2. 未リンクの `(issuer, sub)` は、同じ verified email の既存 profile があっても別の app-local profile を作る
3. 新しい profile に `auth_identities(provider=oidc)` を作り、以後は `<issuer>#<sub>` だけで解決する

email は再利用・移管され得るため account merge key にしません。`email_verified = true` は verified snapshot として
保存できることだけを示し、既存profileへの自動linkを許可しません。verified / unverified のどちらも表示・監査用
snapshotとして扱い、identity ownership は `(issuer, sub)` だけで決めます。

## Capsule API delegation

Takosumi Accounts の dynamic OIDC client は、必要な Capsule が宣言した scope だけを許可します。Takos は
`offline_access` / `capsules:read` / `capsules:write` を要求し、access/refresh token と UserInfo の親 Workspace binding を
app-local DB に暗号化保存します。app launcher の server-to-server call はこのユーザー委任tokenを使い、Accounts側でも
scope、subject、Workspaceを再検証します。token、Workspace binding、client secretをOpenTofu stateやOutputへ保存しません。

Takos内のWorkspaceはTakos productのデータ境界です。親Takosumi Workspaceと同じIDであるとは仮定せず、ローカル
Workspaceを作るたびにTakosumi Workspaceを増やしません。

## オペレーターチェックリスト

- Takosumi Accounts plane の issuer が `OIDC_ISSUER_URL` の `/.well-known/openid-configuration` で解決できること
- `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` が binding material
  (`identity.oidc`) から発行・注入されること
- dynamic client が `openid profile email offline_access capsules:read capsules:write` を許可し、UserInfo が単一の親
  Workspace binding を返すこと
- `ENCRYPTION_KEY` が設定され、委任tokenの平文がlog、OpenTofu state、Outputに出ないこと

automation credential は Takosumi Accounts が発行する bearer / PAT を使います。発行 / 失効 / rotation は Takosumi
Accounts が所有し、Takos app 自体は credential issuer を持ちません (Takos app の `personal_access_tokens` surface
は提供しません)。

## Dedicated Runtime

public install 導線では、dedicated runtime も最初から Capsule / Run ledger 経由で作成します。既に動いている dedicated
runtime を後から台帳に採用する作業は、公開 contract ではなく private operator evidence shaping です。この公開 docs では
手順化しません。

## 検証

Takos app root で OIDC account model を確認します。

```bash
cd takos
bun test ../../src/worker/server/routes/auth/__tests__/oidc-router.test.ts
bun run test:api
bun run validate:migration-safety
```

Takos docs root では、Operator docs と architecture alignment を確認します。

```bash
cd takos
bun run validate:architecture
bun run docs:build
```

## ロールバック

rollback は backup を使った短期復旧に限定します。OIDC identity の state は `auth_identities` を正とします。

- deploy を戻す場合も Takosumi Accounts issuer / Capsule Run ledger は維持する
- user merge を取り消す場合は `auth_identities` の対象 row を削除し、次回 login で verified email linking をやり直す
