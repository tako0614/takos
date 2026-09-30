# アカウントモデル

> このページでわかること: Takos のアカウント・認証の所有権がどこにあるか。

Takos は各自が自分用にデプロイする、インスタンス所有者1人のソフトウェアです。1人の所有者は
複数の private Workspace を持てます。外部の通信相手、共有リンクの受信者、MCP 接続先は
インスタンス所有者ではありません。

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

operator は公開 login を有効にする前に `OIDC_OWNER_SUBJECT` を設定します。これは
`OIDC_ISSUER_URL` の issuer が、このインスタンスの所有者へ返す正確な `sub` です。
email、username、親 Workspace の membership、最初にログインした人から所有者を推測しません。
未設定・不正な設定は login を拒否します。

1. OIDC callback は署名・state・nonce・PKCE・UserInfo を検証し、固定した `(issuer, sub)` と
   一致する所有者だけを受け入れる。別 subject の profile、委任token、session を作らない
2. 所有者の `auth_identities(provider=oidc, provider_sub=<issuer>#<sub>)` を解決する。
   未導入なら、その identity と app-local profile を同じ atomic write group で作る
3. Accounts bearer/PAT と既存 cookie session でも同じ所有者を確認する。旧 version の
   別ユーザーの row や session が残っていても、所有者としての access を認めない
4. キュー済み・実行中の Run と未完了 MCP OAuth callback も、同じ現在の所有者を
   確認する。旧別ユーザーの Workspace owner 権限だけでは実行を継続しない

email は再利用・移管され得るため account merge key にしません。`email_verified = true` は
表示・監査用の verified snapshot を保存できることだけを示します。既存profileへの自動linkや、
別 subject を所有者へ読み替える根拠にはしません。旧 profile、外部相手のデータ、Workspaceを
自動で削除・merge・所有権移管することもありません。
identity の識別と client ごとの subject は
[OpenID Connect Core の5.7節・8節](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability) に従います。

この設定は Takos の公開アプリ設定であり、upstream account の作成や権限付与を行いません。
issuer/subject の変更は operator が行う所有者境界の変更です。既存データを別 identity に
渡す操作ではなく、旧 session の失効、データ保全、明示した復旧・移管の検証が別途必要です。
別 client が異なる pairwise subject を返す場合も自動 alias は作りません。Accounts/mobile の
exact client と subject の対応は導入時に確認します。

## Capsule API delegation

Takosumi Accounts の operator は Takos 用の public OIDC client を通常の account-plane 手順で明示登録し、
`openid profile email offline_access capsules:read capsules:write` と正確な redirect URI を許可します。
`identity.oidc` capability は `TAKOSUMI_ACCOUNTS_URL`、`OIDC_ISSUER_URL`、`OIDC_CLIENT_ID`、
`OIDC_REDIRECT_URI` の4つの公開 Accounts 値だけを Takos に届けます。confidential client を使う場合の
`OIDC_CLIENT_SECRET` は capability では届けず、operator が別途 secret store から設定します。direct/self-host OIDC も同じ4つの値を受け取り、Workspace id をアプリ設定として受け取りません。

Accounts は authorize 時の Capsule/client と現在の membership から Workspace を解決し、UserInfo の
`takosumi.workspace_id` と `workspace_memberships` に返します。callback はその claim が空でなく、membership が一つだけで
claim と一致しない限り ユーザーの作成や Accounts delegation の保存まで進みません。一致した場合だけ access/refresh token と
検証済み Workspace binding を app-local DB に暗号化保存します。app launcher の server-to-server call はこのユーザー委任tokenを使い、
Accounts側でも scope、subject、Workspaceを再検証します。membership 配列だけから Workspace を推測しません。
token や Workspace binding を OpenTofu state / Output に保存しません。`identity.oidc` capability の Capsule-bound client 登録は
Apply 中だけ行い、Plan では行いません。Capsule が terminal destroy になったときは、その client も revoke します。

Takos内のWorkspaceはTakos productのデータ境界です。親Takosumi Workspaceと同じIDであるとは仮定せず、ローカル
Workspaceを作るたびにTakosumi Workspaceを増やしません。

## オペレーターチェックリスト

- Takosumi Accounts plane の issuer が `OIDC_ISSUER_URL` の `/.well-known/openid-configuration` で解決できること
- `TAKOSUMI_ACCOUNTS_URL` / `OIDC_ISSUER_URL` / public `OIDC_CLIENT_ID` / `OIDC_REDIRECT_URI` が capability と登録済み client に一致すること
- `OIDC_OWNER_SUBJECT` が所有者の正確な issuer-bound subject であること。公開 login 前に固定し、別 subject の browser/bearer と旧 cookie が拒否されること
- 登録済み client が `openid profile email offline_access capsules:read capsules:write` を許可し、UserInfo が単一の親
  Workspace claim (`takosumi.workspace_id`) と、それに一致する一意な `workspace_memberships` を返すこと
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
- 所有者 pin と `auth_identities` の対応を保全する。verified email による再link、別subjectの自動admission、旧versionへの無確認のdowngradeで復旧しない
