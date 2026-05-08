# OIDC Setup

このページは operator 視点で Takos の identity 設定を扱います。Installable App
Model における Takos は **OIDC consumer** で、issuer は Takosumi Accounts
(service identifier `takosumi.account.auth@v1`) に集約されます。 endpoint URL は
anchor から resolve される operator-injected value です (詳細は
[cross-instance service binding](/architecture/cross-instance-service-binding))。

::: warning 2 layer auth boundary Takos の identity 設定は **役割の異なる 2
layer** に分かれます。operator が
触る範囲と「触ってはいけない範囲」を最初に固定してください。

- **Layer 1 — Operator login (admin Web 入口)**: operator が Takos admin Web に
  ログインするための upstream IdP。Google OAuth (またはそれと同等の operator
  IdP) を使い、`GOOGLE_CLIENT_*` を operator が直接 provision する。**operator
  の責務範囲**。
- **Layer 2 — AppInstallation OIDC client (end-user identity)**: end user が
  Takos 本体にログインする時に使う OIDC client。**Takosumi Accounts が
  per-AppInstallation で発行・rotation し、AppBinding (`identity.oidc@v1`)
  経由で Takos runtime に env 注入される**。operator は OIDC client
  自体を発行・登録 しない (self-host mode で別 issuer を使う場合のみ、その
  issuer 側で登録)。

`OIDC_CLIENT_*` を operator が「Takosumi Accounts
に新規登録する」作業はありません。 operator が触るのは **Layer 1 の
`GOOGLE_CLIENT_*` の provision** と、 **Layer 2 の env を AppBinding
経由で受け取って配信する取り込み** だけです。 :::

このページで設定するもの:

- **Layer 1 — Operator login** (Google OAuth): Takos admin Web に operator が
  ログインするための upstream IdP。admin domain への入口として維持されます
- **Layer 2 — Takosumi Accounts 連携** (OIDC consumer): Takos 本体が end user の
  ログインを受けるための OIDC client 設定。`OIDC_*` env は AppBinding 経由で
  注入され、operator は手動 provision しません

operator は最初に Layer 1 (operator login) を成立させ、Layer 2 の
AppInstallation OIDC client は Takosumi Accounts 側で発行される形に揃えて
ください。`takos-private/` 側の本番・staging deploy / secret 操作の実値は
そちらを正本にします。

## Required Values

`apps/control` の現在の Web/auth route は次の env を参照します。 `scope`
列は前述の **2 layer auth boundary** を踏襲し、`provisioned by` 列で **operator
が手で値を作るのか / AppBinding 経由で勝手に降ってくるのか** を 明示します。

| key                             | secret  | scope                                | provisioned by                                                                                                                        | 用途                                                                                                                                                                                                                                                         |
| ------------------------------- | ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ADMIN_DOMAIN`                  | no      | both                                 | operator (DNS / domain 設計)                                                                                                          | Takos admin Web の host。例: `admin.example.com`                                                                                                                                                                                                             |
| `TENANT_BASE_DOMAIN`            | no      | both                                 | operator (DNS / domain 設計)                                                                                                          | tenant app の base domain。例: `app.example.com`                                                                                                                                                                                                             |
| `AUTH_PUBLIC_BASE_URL`          | no      | Layer 1 (operator login)             | operator                                                                                                                              | external auth page が home link として使う public origin                                                                                                                                                                                                     |
| `AUTH_ALLOWED_REDIRECT_DOMAINS` | no      | Layer 1 (operator login)             | operator                                                                                                                              | operator login の external service handoff (legacy compat path) が許可する redirect host の allowlist。Takosumi Accounts 経由の現代モデルでは新規利用は推奨されず、end user の OIDC redirect は `OIDC_REDIRECT_URI` (`/auth/oidc/callback`) のみで完結します |
| `GOOGLE_CLIENT_ID`              | no      | **Layer 1 (operator login)**         | **operator** が Google Cloud Console で OAuth client を作成して取得                                                                   | Google OAuth client ID (operator login の正規 upstream)                                                                                                                                                                                                      |
| `GOOGLE_CLIENT_SECRET`          | yes     | **Layer 1 (operator login)**         | **operator** が Google Cloud Console で OAuth client を作成して取得                                                                   | Google OAuth client secret                                                                                                                                                                                                                                   |
| `OIDC_ISSUER_URL`               | no      | **Layer 2 (Takos runtime consumer)** | operator-injected (cross-instance import `${imports.account-auth.endpoints.oidc-issuer.url}` 経由 anchor resolve)                     | Takos が OIDC consumer として参照する issuer                                                                                                                                                                                                                 |
| `OIDC_CLIENT_ID`                | no      | **Layer 2 (Takos runtime consumer)** | **Takosumi Accounts (managed)** / self-host issuer。AppBinding (`identity.oidc@v1`) で env 注入され、operator は手で provision しない | AppInstallation 用 OIDC client id                                                                                                                                                                                                                            |
| `OIDC_CLIENT_SECRET`            | yes     | **Layer 2 (Takos runtime consumer)** | **Takosumi Accounts (managed)** / self-host issuer。AppBinding (`identity.oidc@v1`) で env 注入され、operator は手で provision しない | confidential client secret                                                                                                                                                                                                                                   |
| `OIDC_REDIRECT_URI`             | no      | **Layer 2 (Takos runtime consumer)** | AppInstallation の domain 確定後、Takosumi Accounts が AppBinding 経由で降らせる (self-host: operator が手で固定)                     | `<base>/auth/oidc/callback` の絶対 URL                                                                                                                                                                                                                       |
| `SESSION_DO`                    | binding | both                                 | platform binding (Cloudflare Worker / Helm)                                                                                           | browser session store                                                                                                                                                                                                                                        |
| `DB`                            | binding | both                                 | platform binding (Cloudflare Worker / Helm)                                                                                           | account / session / OIDC state persistence                                                                                                                                                                                                                   |

Cloudflare Workers profile では non-secret は `wrangler.toml` の `[vars]`、
secret は `wrangler secret put` で入れます。本番・staging の実値は
`takos-private/` 側の deploy / secret 管理を正本にしてください。

## Operator login (Google OAuth)

Takos admin Web の operator login は Google OAuth を upstream IdP として
使います。Installable App Model でも operator が admin Web へ入る入口は
変えません。

Google OAuth client の redirect URI は admin domain に対して固定です。

```text
https://<ADMIN_DOMAIN>/auth/callback
```

外部 service login handoff (legacy compat) を使う既存 tenant では、同じ Google
OAuth client に次の redirect URI も登録します。新規 tenant は Takosumi Accounts
経由の `/auth/oidc/callback` のみを使うため、この legacy path の登録は不要です。

```text
https://<ADMIN_DOMAIN>/auth/external/callback   # legacy compat
```

`GOOGLE_CLIENT_ID` は non-secret var、`GOOGLE_CLIENT_SECRET` は secret
です。Cloudflare profile の例:

```bash
wrangler secret put GOOGLE_CLIENT_SECRET --config apps/control/wrangler.toml
```

`ADMIN_DOMAIN` と redirect URI の host は一致させます。staging と production で
domain が違う場合は、Google OAuth client も分けるか、両方の redirect URI
を明示登録してください。

### Public Origins

`AUTH_PUBLIC_BASE_URL` は login HTML が Takos admin へ戻すための public origin
です。通常は `https://<ADMIN_DOMAIN>` にします。

```env
ADMIN_DOMAIN=admin.example.com
AUTH_PUBLIC_BASE_URL=https://admin.example.com
```

`AUTH_ALLOWED_REDIRECT_DOMAINS` は operator login の external service token
handoff (legacy compat path) で許可する redirect host の allowlist
です。Takosumi Accounts が broker する新モデルでは end user の OIDC redirect は
`OIDC_REDIRECT_URI` (`/auth/oidc/callback`) のみで完結し、 この allowlist
は新規利用が推奨されません。既存 tenant の互換のために 残しています。

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

operator login の動作確認は admin domain に対して行います。

```bash
curl -fsS https://<ADMIN_DOMAIN>/health
```

browser での確認:

1. `https://<ADMIN_DOMAIN>/auth/login` が Google OAuth へ redirect する
2. Google callback が `https://<ADMIN_DOMAIN>/auth/callback` へ戻る
3. 初回ユーザーが `/setup` に進む
4. setup 完了後に Takos Web の main app が表示される

OIDC consumer の callback は `<TENANT_HOST>/auth/oidc/callback` です。 Takosumi
Accounts 側の `redirectUris` と一致していることを確認します。

## 次に読むページ

- [/architecture/takosumi-accounts](/architecture/takosumi-accounts) — issuer
  側の責務 (OIDC issuer / billing / app installation owner)
- [/apps/oidc-consumer](/apps/oidc-consumer) — Takos が consumer として 要求する
  env / route / claim
- [/operator/bootstrap](/operator/bootstrap) — operator login 完了後の PAT
  発行と AppInstallation 連携
