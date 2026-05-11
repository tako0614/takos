# OIDC Setup

このページは operator 視点で Takos の identity 設定を扱います。Installable App
Model における Takos は **OIDC consumer** で、issuer は Takosumi Accounts
(`operator.identity.oidc` namespace export / OIDC discovery) に集約されます。
endpoint URL は operator-selected value です (詳細は
[namespace export binding](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/cross-instance-service-binding.md))。

::: warning account-plane boundary Takos は OAuth/OIDC issuer や upstream IdP
broker を持ちません。operator が 確認するのは Takosumi Accounts で発行された
per-AppInstallation OIDC client が AppBinding (`identity.oidc@v1`) 経由で Takos
runtime に materialize されていることです。Google / GitHub / passkey /
enterprise OIDC などの upstream IdP は Takosumi Accounts 側で扱います。 :::

このページで設定するもの:

- **Takosumi Accounts 連携** (OIDC consumer): Takos admin Web と end user
  surface が同じ OIDC client 設定でログインを受ける。`OIDC_*` env は AppBinding
  経由で注入され、operator は手動 provision しません

operator は AppInstallation OIDC client が Takosumi Accounts 側で発行される
形に揃えてください。`takos-private/` 側の本番・staging deploy / secret
操作の実値はそちらを正本にします。

## Required Values

`apps/control` の現在の Web/auth route は次の env を参照します。`provisioned
by`
列で **operator が手で値を作るのか / AppBinding 経由で降ってくるのか**
を明示します。

| key                  | secret  | scope                 | provisioned by                                                                                                                        | 用途                                                 |
| -------------------- | ------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `ADMIN_DOMAIN`       | no      | Takos runtime         | operator (DNS / domain 設計)                                                                                                          | Takos admin Web の host。例: `admin.example.com`     |
| `TENANT_BASE_DOMAIN` | no      | Takos runtime         | operator (DNS / domain 設計)                                                                                                          | tenant app の base domain。例: `app.example.com`     |
| `OIDC_ISSUER_URL`    | no      | OIDC consumer         | operator-selected issuer from `operator.identity.oidc` / OIDC discovery                                                                | Takos が OIDC consumer として参照する issuer         |
| `OIDC_CLIENT_ID`     | no      | OIDC consumer         | **Takosumi Accounts (managed / self-host)**。AppBinding (`identity.oidc@v1`) で env 注入され、operator は手で provision しない | AppInstallation 用 OIDC client id                    |
| `OIDC_CLIENT_SECRET` | yes     | OIDC consumer         | **Takosumi Accounts (managed / self-host)**。AppBinding (`identity.oidc@v1`) で env 注入され、operator は手で provision しない | confidential client secret                           |
| `OIDC_REDIRECT_URI`  | no      | OIDC consumer         | AppInstallation の domain 確定後、Takosumi Accounts が AppBinding 経由で降らせる (self-host: operator が手で固定)                     | `<base>/auth/oidc/callback` の絶対 URL               |
| `SESSION_DO`         | binding | Takos runtime         | platform binding (Cloudflare Worker / Helm)                                                                                           | browser session store                                |
| `DB`                 | binding | app-local persistence | platform binding (Cloudflare Worker / Helm)                                                                                           | app-local profile / session / OIDC state persistence |

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

`/auth/login`、`/auth/password`、`/auth/cli`、`/auth/external/*`、`/auth/link/google`
は公開 route ではありません。新規・既存 tenant とも Takosumi Accounts 経由の
`/auth/oidc/login` / `/auth/oidc/callback` / `/auth/logout` のみを使います。

Takos runtime には Google OAuth client secret を配りません。Google / GitHub /
passkey / enterprise OIDC などの upstream IdP credential は Takosumi Accounts
側で管理します。

### Public Origins

Takos runtime 側で必要な public origin は `ADMIN_DOMAIN` と `OIDC_REDIRECT_URI`
です。redirect allowlist や upstream IdP callback は Takosumi Accounts 側の OIDC
client / identity provider 設定へ集約します。

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

self-host では、Layer 2 の OIDC issuer は import 先の Takosumi Accounts です。
Keycloak / Authentik / Auth0 等は Accounts の upstream IdP として接続します。
`OIDC_CLIENT_*` の registration は **その self-host Accounts 側**で行い、
`OIDC_ISSUER_URL` も Accounts issuer を指します。Takos 側は同一 binary で動きます
([/apps/oidc-consumer](/apps/oidc-consumer) §6 参照)。

tenant app が OAuth client を必要とする場合、新モデルでは AppInstallation の
`identity.oidc@v1` AppBinding が OIDC client を発行します
([https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/binding-catalog.md](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/binding-catalog.md) 参照)。

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

- [https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md) — issuer
  側の責務 (OIDC issuer / billing / app installation owner)
- [/apps/oidc-consumer](/apps/oidc-consumer) — Takos が consumer として 要求する
  env / route / claim
- [/operator/bootstrap](/operator/bootstrap) — OIDC login 完了後の Accounts
  bearer と AppInstallation 連携
