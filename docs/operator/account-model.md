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

Takosumi Accounts の operator は Takos 用の public OIDC client を通常の account-plane 手順で明示登録し、
`openid profile email offline_access capsules:read capsules:write` と正確な redirect URI を許可します。
`identity.oidc` capability は `TAKOSUMI_ACCOUNTS_URL`、`OIDC_ISSUER_URL`、`OIDC_CLIENT_ID`、
`OIDC_REDIRECT_URI` の4つの公開 Accounts 値だけを Takos に届けます。confidential client を使う場合の
`OIDC_CLIENT_SECRET` は capability では届けず、operator が別途 secret store から設定します。direct/self-host OIDC も同じ4つの値を受け取り、Workspace id をアプリ設定として受け取りません。

install context の `app_capsule_id` は `APP_CAPSULE_ID` として渡されます。設定がある場合、UserInfo の
`takosumi.capsule_id` はその値と完全一致する必要があります。別の Capsule、無効な `app_role`、不正な claim は
Workspace claim があっても拒否します。未設定の場合は Capsule claim を判定に使わず、既存の Workspace 検証を続けます。

現在の Accounts は Capsule member に `capsule_id`、`workspace_id`、`role`、単一の `workspace_memberships` を返し、
`app_role` はまだ返しません。Capsule が一致してもこの Workspace binding を捨てず、`workspace_id` と一意な membership の
一致を検証して保存します。legacy `role` は `owner` / `admin` / `member` / `viewer` を受け入れ、owner とそれ以外の member を
識別します。role のない従来の検証済み membership も member として維持します。追加予定の `app_role` は
`owner` / `member` を受け入れます。これらの claim は Takos の local admin 権限を作りません。
Takos は親の `APP_WORKSPACE_ID` を設定として受け取らず、検証済みの claim を selector にします。

Capsule のみが一致し、role と Workspace binding がない普通の account も app-local profile / session を作れます。
この場合の委任は Workspace selector を持ちません。operator の `OPENAI_API_KEY` は開発モードや共通 key の明示 opt-in が
あっても、この account へ配布しません。設定済み app の共通 key 配布は、実行 user 自身の委任 token で UserInfo を再検証し、
現在の app membership（または Capsule claim のない従来の検証済み Workspace membership）を確認します。AI Gateway も user 自身の Workspace と live InterfaceBinding を必要とし、operator の
credential へ切り替えません。`APP_CAPSULE_ID` 未設定の従来 self-host における共通 key opt-in は既存どおりです。

access/refresh token と検証済み Workspace binding は app-local DB に暗号化保存します。app launcher、MCP、AI Gateway の
server-to-server discovery はこのユーザー委任 token と Workspace を使い、Accounts 側でも scope、subject、Workspace を
再検証します。Workspace がない委任から別の保存済み grant や local Takos Workspace を選びません。アプリ一覧も検証済み
Workspace がある限り既存の Workspace route を優先します。Workspace-less `/api/v1/apps` と raw account-session は
Takosumi #663 の未統合 API に依存し、未提供 / 拒否応答を空の成功一覧に変えません。

token や Workspace binding を OpenTofu state / Output に保存しません。`identity.oidc` capability の Capsule-bound client
登録は Apply 中だけ行い、Plan では行いません。Capsule が terminal destroy になったときは、その client も revoke します。

Takos内のWorkspaceはTakos productのデータ境界です。親Takosumi Workspaceと同じIDであるとは仮定せず、ローカル
Workspaceを作るたびにTakosumi Workspaceを増やしません。

## オペレーターチェックリスト

- Takosumi Accounts plane の issuer が `OIDC_ISSUER_URL` の `/.well-known/openid-configuration` で解決できること
- `TAKOSUMI_ACCOUNTS_URL` / `OIDC_ISSUER_URL` / public `OIDC_CLIENT_ID` / `OIDC_REDIRECT_URI` が capability と登録済み client に一致すること
- 登録済み client が `openid profile email offline_access capsules:read capsules:write` を許可し、`APP_CAPSULE_ID` 設定時は
  UserInfo の `takosumi.capsule_id` と一致すること。現在の member claim は `workspace_id` / `role` と一致する単一の
  `workspace_memberships` を返し、runtime Interface を使う member の検証済み Workspace が保存されること
- `ENCRYPTION_KEY` が設定され、委任tokenの平文がlog、OpenTofu state、Outputに出ないこと

automation credential は Takosumi Accounts が発行する bearer / PAT を使います。発行 / 失効 / rotation は Takosumi
Accounts が所有し、Takos app 自体は credential issuer を持ちません (Takos app の `personal_access_tokens` surface
は提供しません)。

## Dedicated Runtime

public install 導線では、dedicated runtime も最初から Capsule / Run ledger 経由で作成します。既に動いている dedicated
runtime を後から実行履歴に採用する作業は、公開 contract ではなく private operator evidence shaping です。この公開 docs では
手順化しません。

## 検証

Takos app root で OIDC account model を確認します。

```bash
cd takos
bun test src/worker/server/routes/auth/__tests__/oidc-router.test.ts
bun run test
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
