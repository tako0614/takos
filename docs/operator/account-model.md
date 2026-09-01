# アカウントモデル

> このページでわかること: Takos のアカウント・認証の所有権がどこにあるか。

Takos product routesはOIDC consumerであり、credential issuer / billing ownerには
なりません。operator-selected issuerのsubjectからapp-local profile / sessionを
作ります。Takosumi integrationを使う場合はTakosumi Accountsがissuerとdelegated
control-plane authorizationを所有します。

Takos の product model は一人用です。一つの `(issuer, sub)` は一つの app-local
Principal になり、その Principal が用途別の private Workspace を複数持ちます。
一つの deployment が複数 Principal を収容してもよいですが、Takos Workspace に
member、invite、role、ownership transfer はなく、Principal 間で共有しません。

## 所有権の一覧

| 対象                                 | 管理元                                           |
| ------------------------------------ | ------------------------------------------------ |
| account / credential / upstream IdP  | operator-selected OIDC issuer                    |
| billing / Capsule Run ledger         | Takosumi integration（接続時のみ）              |
| OIDC issuer / client registration    | operator-selected issuer（Takosumiも選択可能）   |
| Takos の app-local profile / session | Takos app                                        |
| dedicated runtime mode / source pin  | Capsule + operator-private runtime evidence       |

Keycloak / Authentik / Auth0などのgeneric OIDC issuerをTakosへ直接設定できます。
shared Capsule stateやInterfaceが必要ならTakosumi Accountsをissuer/control APIとして
接続します。どちらの場合もTakos自身はissuerを実装しません。

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

standalone loginは`openid profile email`だけを要求します。Takosumi integrationを
構成した場合だけ`offline_access` / `capsules:read` / `capsules:write`も要求し、
access/refresh tokenとUserInfoの親Workspace bindingをapp-local DBに暗号化保存します。
app launcherのserver-to-server callはこの委任tokenを使い、Accounts側でもscope、
subject、Workspaceを再検証します。token、Workspace binding、client secretを
OpenTofu stateやOutputへ保存しません。

Takos内のWorkspaceはTakos productのデータ境界です。親Takosumi Workspaceと同じIDであるとは仮定せず、ローカル
Workspaceを作るたびにTakosumi Workspaceを増やしません。

現行DBの`accounts.type = team`と`account_memberships`はschema移行まで残す互換表現です。
public modelではなく、Workspace rowのownerとactiveな互換owner rowの両方がPrincipal
と一致した場合だけauthorizationに使います。non-owner、suspended、owner偽装のlegacy
membership rowは一覧にもauthorizationにも使いません。

## オペレーターチェックリスト

- 選択したissuerが`OIDC_ISSUER_URL`の`/.well-known/openid-configuration`で解決できること
- `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / optional `OIDC_CLIENT_SECRET` /
  `OIDC_REDIRECT_URI`が正しいclient metadataであること
- Takosumi接続時だけdelegation scopeと単一の親Workspace bindingを確認すること
- `ENCRYPTION_KEY` が設定され、委任tokenの平文がlog、OpenTofu state、Outputに出ないこと

Takosumi automation credentialはTakosumi Accountsが発行するbearer / PATを使います。
Takos app自体はcredential issuerを持ちません。

## Dedicated Runtime

public install 導線では、dedicated runtime も最初から Capsule / Run ledger 経由で作成します。既に動いている dedicated
runtime を後から履歴に採用する作業は、公開 contract ではなく private operator evidence shaping です。この公開 docs では
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

- Takosumi接続構成でdeployを戻す場合もAccounts issuer / Capsule Run ledgerは維持する
- user merge を取り消す場合は `auth_identities` の対象 row を削除し、次回 login で verified email linking をやり直す
