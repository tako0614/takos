# 初回セットアップ

> このページでわかること: Takos を新規に立ち上げるための手順 (Web ベース)。

Takos は Takosumi Accounts の OIDC consumer として起動します。
初回セットアップでは、Takosumi Accounts で発行された OIDC クライアント情報を
Takos に接続します。

## Prerequisites

- `takos-private/` の target deploy が完了している
- `ADMIN_DOMAIN` が public HTTPS で解決できる
- [OIDC Setup](/operator/oidc-setup) の Takosumi Accounts issuer と OIDC
  redirect が登録済み
- Installation の domain が `<TENANT_HOST>` として確定している
- Installation 用の OIDC client (`OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
  `OIDC_REDIRECT_URI`) が Takosumi Accounts / use edge 経由で materialize 済み
- `DB` / `SESSION_DO` / `OIDC_CLIENT_SECRET` (Takosumi Accounts 連携) が
  production または staging profile に入っている
- trusted edge / internal service secret は public internet へ露出していない

`takos/` shell から本番・staging deploy を直接進めません。deploy 設定と secret
操作は `takos-private/` で管理してください。

## Env テーブル

operator が bootstrap 時に確認する env は次の通りです。Takos 自身は OAuth
provider を持たず、Takosumi Accounts に登録した OIDC client の情報を注入する
だけで OIDC consumer として動きます。

| key                     | secret  | scope             | 用途                                                                                           |
| ----------------------- | ------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `ADMIN_DOMAIN`          | no      | Takos runtime     | Takos admin Web の host                                                                        |
| `OIDC_ISSUER_URL`       | no      | Takosumi Accounts | `operator.identity.oidc` / OIDC discovery から materialize された operator-selected issuer URL |
| `OIDC_CLIENT_ID`        | no      | Takosumi Accounts | Installation 用の client id                                                                 |
| `OIDC_CLIENT_SECRET`    | yes     | Takosumi Accounts | confidential client secret                                                                     |
| `OIDC_REDIRECT_URI`     | no      | Takosumi Accounts | `<TENANT_HOST>/auth/oidc/callback`                                                             |
| `BASE_URL`              | no      | Takos runtime     | Takos public URL                                                                               |
| `TAKOS_INSTALLATION_ID` | no      | Takos runtime     | Installation id (app-local profile の FK)                                                   |
| `DB`                    | binding | Takos runtime     | app-local persistence                                                                          |
| `SESSION_DO`            | binding | Takos runtime     | browser session store                                                                          |

## 1. Admin Web に入る (operator login)

browser で admin domain を開きます。

```text
https://<ADMIN_DOMAIN>/
```

未ログインなら `/auth/oidc/login` へ進み、Takosumi Accounts の resolved OIDC
issuer で認証します。Takos は `/auth/oidc/login` / `/auth/oidc/callback` /
`/auth/logout` の 3 route だけを consumer として受けます。Google / GitHub /
passkey / enterprise OIDC などの upstream IdP は Takosumi Accounts 側の broker
設定で扱います。`/auth/login` は公開 route ではありません。詳しくは
[OIDC Consumer](/apps/oidc-consumer) を参照してください。

## 2. 初回 setup を完了する

初回ユーザーは `/setup` に送られます。この画面は次の API で Takos app-local
profile 用の username を保存します。ログイン用 credential は Takosumi Accounts
側で管理し、Takos app には保存しません。

| method | path                        | 用途                        |
| ------ | --------------------------- | --------------------------- |
| GET    | `/api/setup/status`         | setup 状態確認              |
| POST   | `/api/setup/check-username` | username availability check |
| POST   | `/api/setup/complete`       | username 保存               |

Web 画面で username を決めて `continue` します。完了後、Takos Web の main app
に入れることを確認します。

## 3. Takosumi Accounts bearer を用意する

automation や API smoke に使う long-lived credential は Takosumi Accounts
で発行します。

1. Takosumi Accounts の account settings を開く
2. Personal Access Tokens を開く
3. token 名を入力する
4. 必要な scope / access level を選ぶ (`/api/me` smoke だけなら `profile`)
5. 生成された `takpat_...` を secret store に保存する

Takos API の route family ごとの必要 scope は
[`API Reference`](/reference/api#認証) を参照します。token value は作成時に
一度だけ表示されます。再表示できないため、発行直後に operator secret store
へ移してください。

## 4. Accounts bearer で API smoke を行う

保存した Accounts bearer で `/api/me` を確認します。

```bash
curl -fsS \
  -H "Authorization: Bearer $TAKOS_ACCOUNTS_TOKEN" \
  https://<ADMIN_DOMAIN>/api/me
```

レスポンスに setup 済み user が返れば、browser session と Accounts bearer の
consumer 経路は動いています。

## 5. Automation へ渡す

Accounts bearer は operator が管理する secret store に保存し、必要な automation
にだけ渡します。

- local shell や CI に直書きしない
- `TAKOS_INTERNAL_API_SECRET` / `TAKOS_INTERNAL_SERVICE_SECRET` を user token
  として使わない
- `admin` bucket は短命にし、作業後に削除する
- Git Smart HTTP などの automation には必要最小限の bucket を使う

## 6. Takosumi Accounts 連携を設定する

end user 向けの OIDC issuer は Takosumi Accounts に置きます。fresh operator
は次を完了させてください。

1. 対象 Installation の OIDC client を Takosumi Accounts で発行する (managed
   deploy では install pipeline が自動発行。self-host では operator-owned
   Takosumi Accounts に登録し、Keycloak / Authentik 等は upstream IdP
   として接続)
2. 取得した `clientId` / `clientSecret` / `redirectUris` を `takos-private/` の
   secret store に保存する
3. Takos runtime に env として注入する。具体的な secret store / runtime の
   wiring (Cloudflare Workers profile の `wrangler.toml` `[vars]` /
   `wrangler secret put` 等) は **bootstrap runbook の scope 外** であり、
   `takos-private/` の deploy pipeline と secret 管理を参照してください
4. `<TENANT_HOST>/auth/oidc/login` にアクセスして Takosumi Accounts へ redirect
   されること、callback で session が作られることを確認する

## CLI Boundary

Takos bootstrap の primary path は Web UI です。Takos product CLI を fresh
operator の主要導線として増やしません。

application manifest / workflow / git bridge は `takosumi-git`、kernel の
explicit manifest apply は `takosumi` が扱います。Takos product は Web UI と
public API から space / catalog / app-local product API を扱い、OAuth / billing は
operator account plane の OIDC / BillingPort を consume します。
