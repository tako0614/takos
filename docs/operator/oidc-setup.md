# OIDC Setup

このページは operator 視点で Takos の identity 設定を扱います。Installable App
Model における Takos は **OIDC consumer** で、issuer は Takosumi Accounts
(service identifier `takosumi.account.auth@v1`) に集約されます。 endpoint URL は
anchor から resolve される operator-injected value です (詳細は
[cross-instance service binding](/architecture/cross-instance-service-binding))。

::: warning account-plane boundary Takos は OAuth/OIDC issuer や upstream IdP
broker を持ちません。operator が 確認するのは Takosumi Accounts で発行された
per-AppInstallation OIDC client が AppBinding (`identity.oidc@v1`) 経由で Takos
runtime に materialize されていることです。Google / GitHub / passkey /
enterprise OIDC などの upstream IdP は Takosumi Accounts 側で扱います。 :::

このページで設定するもの:

- **Takosumi Accounts 連携** (OIDC consumer): Takos admin Web と end user
  surface が同じ OIDC client 設定でログインを受ける。`OIDC_*` env は AppBinding
  経由で注入され、operator は手動 provision しません
- **legacy compatibility**: `/auth/login` や external service handoff は
  migration window 中の互換 path。新規導線は `/auth/oidc/login` です

operator は AppInstallation OIDC client が Takosumi Accounts 側で発行される
形に揃えてください。`takos-private/` 側の本番・staging deploy / secret
操作の実値はそちらを正本にします。

## Required Values

`apps/control` の現在の Web/auth route は次の env を参照します。`provisioned
by`
列で **operator が手で値を作るのか / AppBinding 経由で降ってくるのか**
を明示します。

| key                             | secret  | scope                 | provisioned by                                                                                                                        | 用途                                                                                                                                                                    |
| ------------------------------- | ------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_DOMAIN`                  | no      | Takos runtime         | operator (DNS / domain 設計)                                                                                                          | Takos admin Web の host。例: `admin.example.com`                                                                                                                        |
| `TENANT_BASE_DOMAIN`            | no      | Takos runtime         | operator (DNS / domain 設計)                                                                                                          | tenant app の base domain。例: `app.example.com`                                                                                                                        |
| `AUTH_PUBLIC_BASE_URL`          | no      | legacy compatibility  | operator                                                                                                                              | external auth page が home link として使う public origin。新規 OIDC login では必須ではありません                                                                        |
| `AUTH_ALLOWED_REDIRECT_DOMAINS` | no      | legacy compatibility  | operator                                                                                                                              | external service handoff (legacy compat path) が許可する redirect host の allowlist。新規 OIDC redirect は `OIDC_REDIRECT_URI` (`/auth/oidc/callback`) のみで完結します |
| `OIDC_ISSUER_URL`               | no      | OIDC consumer         | operator-injected (cross-instance import `${imports.account-auth.endpoints.oidc-issuer.url}` 経由 anchor resolve)                     | Takos が OIDC consumer として参照する issuer                                                                                                                            |
| `OIDC_CLIENT_ID`                | no      | OIDC consumer         | **Takosumi Accounts (managed)** / self-host issuer。AppBinding (`identity.oidc@v1`) で env 注入され、operator は手で provision しない | AppInstallation 用 OIDC client id                                                                                                                                       |
| `OIDC_CLIENT_SECRET`            | yes     | OIDC consumer         | **Takosumi Accounts (managed)** / self-host issuer。AppBinding (`identity.oidc@v1`) で env 注入され、operator は手で provision しない | confidential client secret                                                                                                                                              |
| `OIDC_REDIRECT_URI`             | no      | OIDC consumer         | AppInstallation の domain 確定後、Takosumi Accounts が AppBinding 経由で降らせる (self-host: operator が手で固定)                     | `<base>/auth/oidc/callback` の絶対 URL                                                                                                                                  |
| `SESSION_DO`                    | binding | Takos runtime         | platform binding (Cloudflare Worker / Helm)                                                                                           | browser session store                                                                                                                                                   |
| `DB`                            | binding | app-local persistence | platform binding (Cloudflare Worker / Helm)                                                                                           | app-local profile / session / OIDC state persistence                                                                                                                    |

Cloudflare Workers profile では non-secret は `wrangler.toml` の `[vars]`、
secret は `wrangler secret put` で入れます。本番・staging の実値は
`takos-private/` 側の deploy / secret 管理を正本にしてください。

## Login Route

Takos admin Web の login は `/auth/oidc/login` から Takosumi Accounts へ
redirect します。operator も end user も、Takos runtime から見ると同じ OIDC
consumer flow です。

OIDC client の redirect URI は AppInstallation domain に対して固定です。

```text
https://<TENANT_HOST>/auth/oidc/callback
```

`/auth/login` は migration window 中の互換 alias として `/auth/oidc/login` へ
redirect されます。旧 external service login handoff を使う既存 tenant
では、互換 path の public origin / redirect allowlist も残せます。新規 tenant は
Takosumi Accounts 経由の `/auth/oidc/callback` のみを使います。

```text
https://<ADMIN_DOMAIN>/auth/external/callback   # legacy compat
```

Takos runtime には Google OAuth client secret を配りません。Google / GitHub /
passkey / enterprise OIDC などの upstream IdP credential は Takosumi Accounts
側で管理します。

### Public Origins

`AUTH_PUBLIC_BASE_URL` は legacy login HTML が Takos admin へ戻すための public
origin です。新規 OIDC flow では `OIDC_REDIRECT_URI` が canonical redirect
になります。

```env
ADMIN_DOMAIN=admin.example.com
AUTH_PUBLIC_BASE_URL=https://admin.example.com
```

`AUTH_ALLOWED_REDIRECT_DOMAINS` は external service token handoff (legacy compat
path) で許可する redirect host の allowlist です。Takosumi Accounts が broker
する新モデルでは OIDC redirect は `OIDC_REDIRECT_URI` (`/auth/oidc/callback`)
のみで完結し、この allowlist は新規利用しません。 既存 tenant
の互換のために残しています。

```env
AUTH_ALLOWED_REDIRECT_DOMAINS=app.example.com,docs.example.com
```

## Takosumi Accounts 連携 (OIDC consumer)

Installable App Model における Takos は **OIDC consumer** で、issuer は Takosumi
Accounts です。**OIDC client 自体は Takosumi Accounts が per-AppInstallation
で発行する**ため、operator は Takosumi Accounts に対して 新規 client
を登録しません。AppBinding (`identity.oidc@v1`) が runtime に env
として降らせる値を **`takos-private/` 経由で取り込んで配信する** のが operator
の責務範囲です。

参考用に、Takos runtime が consumer として参照する OIDC env を示します。

```env
OIDC_ISSUER_URL=https://<ACCOUNTS_ISSUER_HOST>
OIDC_CLIENT_ID=takos_inst_<installation>
OIDC_CLIENT_SECRET=<secret store managed>
OIDC_REDIRECT_URI=https://<TENANT_HOST>/auth/oidc/callback
```

> **Note**: `takos_inst_<installation>` は example であり、契約上は
> `clientId: string` (具体形式は実装依存) です。実際の client_id 形式は Takosumi
> Accounts 側の OIDC client registration 仕様が定めます。 AppBinding
> (`identity.oidc@v1`) から runtime env に materialize されるため、 operator
> は具体形式を hard-code しないでください。

- `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` は AppInstallation ごとに Takosumi
  Accounts (managed) が発行し、AppBinding (`identity.oidc@v1`) で env
  として降ります。operator が Takosumi Accounts に手動登録する作業は ありません
- `OIDC_REDIRECT_URI` は AppInstallation の domain と完全一致させます
- secret は `takos-private/` の secret store が AppBinding から取り込み、
  Cloudflare profile では `wrangler secret put OIDC_CLIENT_SECRET` で配信 します
  (rotation 手順は [Hosting Secret Policy](/hosting/secrets) 参照)

self-host で Takosumi Accounts を使わない場合は、Layer 2 の OIDC issuer を
operator が選んだ issuer (Keycloak / Authentik / Auth0 等) に差し替えます。
このとき `OIDC_CLIENT_*` の registration は **その self-host issuer 側**で
行い、`OIDC_ISSUER_URL` を切り替えれば Takos 側は同一 binary で動きます
([/apps/oidc-consumer](/apps/oidc-consumer) §6 参照)。

tenant app が OAuth client を必要とする場合、新モデルでは AppInstallation の
`identity.oidc@v1` AppBinding が OIDC client を発行します
([/reference/binding-catalog](/reference/binding-catalog) 参照)。

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

- [/architecture/takosumi-accounts](/architecture/takosumi-accounts) — issuer
  側の責務 (OIDC issuer / billing / app installation owner)
- [/apps/oidc-consumer](/apps/oidc-consumer) — Takos が consumer として 要求する
  env / route / claim
- [/operator/bootstrap](/operator/bootstrap) — OIDC login 完了後の Accounts
  bearer と AppInstallation 連携
