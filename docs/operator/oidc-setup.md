# OIDC 設定

> このページでわかること: Takos の認証 (OIDC) をオペレーターとして設定する方法。

Takos は自前の認証サーバーを持たず、operator account plane が発行する OIDC
クライアントを使います。reference takosumi-cloud operator は
`operator.identity.oidc` を materialize します。compatible operator は同等の
binding material を提供でき、self-host operator は同じ env を手動 provision
できます。

::: warning 認証の境界 Takos は OIDC consumer です。Google / GitHub / passkey
などの外部 IdP は Takosumi Accounts 側で upstream として接続してください。 :::

このページで設定するもの:

- **Takosumi Accounts 連携**: 管理画面とユーザー画面が同じ OIDC
  クライアントでログインを受ける

本番・staging の実値は `takos-private/` を参照してください。

## Required Values

Takos の Web/auth route が参照する env の一覧です。 `provisioned by` 列は
「オペレーターが手で設定するもの」か「`listen.oidc.from: operator.identity.oidc`
経由で自動注入されるもの」かを示します。

| key                  | secret  | scope                 | provisioned by                                                                                                                                           | 用途                                                 |
| -------------------- | ------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `ADMIN_DOMAIN`       | no      | Takos runtime         | operator (DNS / domain 設計)                                                                                                                             | Takos admin Web の host。例: `admin.example.com`     |
| `TENANT_BASE_DOMAIN` | no      | Takos runtime         | operator (DNS / domain 設計)                                                                                                                             | tenant app の base domain。例: `app.example.com`     |
| `OIDC_ISSUER_URL`    | no      | OIDC consumer         | operator-selected issuer from the `operator.identity.oidc` external publication                                                                           | Takos が OIDC consumer として参照する issuer         |
| `OIDC_CLIENT_ID`     | no      | OIDC consumer         | reference takosumi-cloud は `operator.identity.oidc` から AppSpec `listen` へ materialize。compatible/self-host operator は同等 material を provision | Installation 用 OIDC client id                       |
| `OIDC_CLIENT_SECRET` | yes     | OIDC consumer         | reference takosumi-cloud は `operator.identity.oidc` から AppSpec `listen` へ materialize。compatible/self-host operator は同等 material を provision | confidential client secret                           |
| `OIDC_REDIRECT_URI`  | no      | OIDC consumer         | Installation の domain 確定後、operator account plane が binding material として渡す (self-host: operator が手で固定)                                   | `<base>/auth/oidc/callback` の絶対 URL               |
| `SESSION_DO`         | binding | Takos runtime         | platform binding (Cloudflare Worker / Helm)                                                                                                              | browser session store                                |
| `DB`                 | binding | app-local persistence | platform binding (Cloudflare Worker / Helm)                                                                                                              | app-local profile / session / OIDC state persistence |

Cloudflare Workers profile では non-secret は `wrangler.toml` の `[vars]`、
secret は `wrangler secret put` で入れます。本番・staging の実値は
`takos-private/` 側の deploy / secret 管理を参照してください。

## Login Route

Takos admin Web の login は `/auth/oidc/login` から Takosumi Accounts へ
redirect します。operator も end user も、Takos runtime から見ると同じ OIDC
consumer flow です。

OIDC client の redirect URI は Installation domain に対して固定です。

```text
https://<TENANT_HOST>/auth/oidc/callback
```

`/auth/login`、`/auth/password`、`/auth/cli`、`/auth/external/*`、`/auth/link/google`
は公開 route ではありません。新規・既存 tenant とも Takosumi Accounts 経由の
`/auth/oidc/login` / `/auth/oidc/callback` / `/auth/logout` のみを使います。

Takos runtime には Google OAuth client secret を配りません。Google / GitHub /
passkey / enterprise OIDC などの upstream IdP credential は Takosumi Accounts
側で管理します。

Keycloak / Authentik / Auth0 などを使う場合も、Takos runtime へそれらの issuer
URL を直接設定しません。Takosumi Accounts の upstream OIDC provider
として登録し、Takos runtime は引き続き Accounts issuer だけを `OIDC_ISSUER_URL`
として consume します。dev/test runner では `takosumi-cloud accounts serve` に
`--oidc-provider-id`、`--oidc-issuer`、
`--oidc-authorization-endpoint`、`--oidc-token-endpoint`、
`--oidc-userinfo-endpoint`、`--oidc-client-id`、`--oidc-redirect-uri` を渡して
Keycloak-style upstream OIDC を有効化できます。

### Public Origins

Takos runtime 側で必要な public origin は `ADMIN_DOMAIN` と `OIDC_REDIRECT_URI`
です。redirect allowlist や upstream IdP callback は Takosumi Accounts 側の OIDC
client / identity provider 設定へ集約します。

## Takosumi Accounts 連携 (OIDC consumer)

Takos は OIDC consumer で、issuer は Takosumi Accounts です。OIDC client は
Takosumi Accounts が Installation ごとに発行するので、オペレーターは Takosumi
Accounts に新規 client を登録する必要はありません。

オペレーターがやることは、 AppSpec の
`listen.oidc.from: operator.identity.oidc` 経由で runtime に降ってくる
env を `takos-private/` で取り込み、 Takos runtime に配信することです。

Takos runtime が consumer として参照する OIDC env:

```env
OIDC_ISSUER_URL=https://<ACCOUNTS_ISSUER_HOST>
OIDC_CLIENT_ID=takos_inst_<installation>
OIDC_CLIENT_SECRET=<secret store managed>
OIDC_REDIRECT_URI=https://<TENANT_HOST>/auth/oidc/callback
```

> **Note**: `takos_inst_<installation>` は example であり、契約上は
> `clientId: string` (具体形式は実装依存) です。実際の client_id 形式は
> Takosumi Accounts 側の OIDC client registration 仕様が定めます。 AppSpec の
> `listen.oidc.from: operator.identity.oidc` から runtime env に
> materialize されるため、 operator は具体形式を hard-code しないでください。

- `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` は Installation ごとに Takosumi
  Accounts (takosumi-cloud) が発行し、AppSpec の `listen` declaration 経由で
  runtime に注入されます。オペレーターによる手動登録は不要です
- `OIDC_REDIRECT_URI` は Installation のドメインと完全一致させます
- secret は `takos-private/` の secret store が AppSpec `listen` material
  経由で取り込み、 Cloudflare profile では
  `wrangler secret put OIDC_CLIENT_SECRET` で配信します (ローテーションは
  [Hosting Secret Policy](/hosting/secrets) を参照)

セルフホストの場合、OIDC issuer は import 先の Takosumi Accounts です。 Keycloak
/ Authentik / Auth0 などは Takosumi Accounts の upstream IdP として接続し、OIDC
client はセルフホスト Accounts 側で発行します。Takos 側は managed
と同じバイナリで動きます (詳細は [OIDC Consumer §6](/apps/oidc-consumer))。

アプリ側で OAuth client が必要な場合は、AppSpec の OIDC listen binding に対して
reference takosumi-cloud operator が per-Installation OIDC client を発行します。
compatible operator は同等の binding material を提供でき、self-host operator は
手動 provision できます (詳細は
[AppSpec publish/listen](https://takosumi.com/docs/reference/manifest))。

## Smoke Checks

OIDC consumer の動作確認は admin / tenant domain に対して行います。

```bash
curl -fsS https://<ADMIN_DOMAIN>/health
```

browser での確認:

1. `https://<ADMIN_DOMAIN>/auth/oidc/login` が Takosumi Accounts へ redirect
   する
2. Takosumi Accounts callback が `https://<TENANT_HOST>/auth/oidc/callback`
   へ戻る
3. 初回ユーザーが `/setup` に進む
4. setup 完了後に Takos Web の main app が表示される

OIDC consumer の callback は `<TENANT_HOST>/auth/oidc/callback` です。 Takosumi
Accounts 側の `redirectUris` と一致していることを確認します。

## 次に読むページ

- [/operator/account-model](/operator/account-model) — Takos app-local profile
  と Takosumi Account / OIDC consumer model の境界
- [https://github.com/tako0614/takosumi-cloud/blob/main/docs/architecture/takosumi-accounts.md](https://github.com/tako0614/takosumi-cloud/blob/main/docs/architecture/takosumi-accounts.md)
  — issuer 側の責務 (OIDC issuer / billing / app installation owner)
- [/apps/oidc-consumer](/apps/oidc-consumer) — Takos が consumer として要求する
  env / route / claim
- [/operator/bootstrap](/operator/bootstrap) — OIDC login 完了後の Accounts
  bearer と Installation 連携
