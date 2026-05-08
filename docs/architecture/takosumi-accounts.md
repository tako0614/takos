# Takosumi Accounts

**Takosumi Accounts** は Installable App Model における identity / billing /
ownership の正本 plane です。 cross-instance service binding 視点では **forward
3-level dotted service identifier** `takosumi.account.auth@v1` (auth role) と
`takosumi.account.billing@v1` (billing role) で参照される service set
として配布され、 endpoint URL は anchor 経由で resolve される operator-injected
値です。 hostname は managed default の example にすぎず、 operator は任意の
hostname で takosumi-cloud distribution を deploy できます (詳細は
[cross-instance service binding](./cross-instance-service-binding.md))。

upstream IdP (Google / GitHub / Passkey / Enterprise OIDC) を吸収して **stable
Takosumi subject** を発行する役割は不変です。 AppInstallation の billing owner /
contract owner / app installation owner も Takosumi Accounts が持ちます。

ここに OAuth/OIDC を置くのは、Takos でも takosumi kernel でもなく、
**takosumi-cloud の account plane** です。kernel の純粋性 (compute substrate
のみ) を保ちつつ、Takos からは OAuth provider を完全に廃止できます。

> **Cross-instance service binding**: 以下の OIDC issuer URL 言及では
> `https://<ACCOUNTS_ISSUER_HOST>` を operator-injected value として使う。
> consumer manifest からは service identifier `takosumi.account.auth@v1`
> 経由で参照され、endpoint URL は anchor から resolve される。kernel 側の
> consumer resolution foundation は実装済みで、provider publish / cache refresh
> / revoke は継続 work。詳細は
> [cross-instance service binding](./cross-instance-service-binding.md)。

## このページで依存してよい範囲

- Takosumi Accounts の役割 (identity broker / OIDC issuer / billing owner / app
  installation owner) と issuer endpoint role
- 公開する OIDC endpoint の一覧
- upstream IdP との関係 (raw passthrough しない / stable subject を作る)
- pairwise OIDC subject の derivation 方針と存在理由
- ID token / launch token の claim 例

## このページで依存してはいけない範囲

- AppInstallation table の field 名と status 遷移
  ([AppInstallation 台帳](./app-installation.md) を参照)
- launch token の `/_takosumi/launch` 検証手順
  ([Launch Token](/apps/launch-token) を参照)
- Takos 側の OIDC consumer 実装 (env / route / callback)
  ([OIDC Consumer](/apps/oidc-consumer) を参照)
- billing line item の構造 ([Takosumi Cloud billing](/platform/billing)
  (Takosumi Account に紐づく billing owner として動作する) を参照)
- AppInstallation REST API ([Install API](/reference/install-api) を参照)

## 役割

Takosumi Accounts は次の 4 役を兼ねます。各役は同じ data plane に同居して
ownership chain を一意に追えるようにするためです。

- **identity broker**: 外部 IdP (Google / GitHub / Passkey / Enterprise OIDC /
  SAML 予定) を upstream として束ね、stable Takosumi subject を発行する
- **OIDC issuer**: service identifier `takosumi.account.auth@v1` の
  `oidc-issuer` endpoint role として OIDC flow を提供する。Installed Takos /
  takos-cli / takosumi-cloud dashboard が consume する
- **billing owner**: 契約主体 / 請求主体。Stripe webhook を処理し、Takosumi
  Account 単位で subscription / usage / invoice を持つ
- **app installation owner**: AppInstallation 台帳 (AppInstallation / AppBinding
  / AppGrant / RuntimeBinding / OidcClientBinding) の正本

```txt
External IdP                         Takosumi Accounts                 Installations
─────────────                        ─────────────────                 ─────────────
Google sub: 12345         ────┐
GitHub sub: ...           ────┼──▶ authIdentities
Passkey credential        ────┘            │
                                           ▼
                                   Stable Takosumi subject (user_abc)
                                           │
                                           ├──▶ Pairwise(takos.chat, inst_abc, user_abc) ──▶ AppInstallation inst_abc
                                           └──▶ Pairwise(other.app, inst_def, user_abc)  ──▶ AppInstallation inst_def
```

## なぜ kernel に置かないか

takosumi kernel は **compiled manifest を apply する pure compute substrate**
として設計されています。OAuth issuer / billing / consent screen / Stripe client
を kernel に同居させると、

- kernel の責務が肥大化し、provider plugin / DAG / fingerprint / outputs
  resolver の実装と保守が複雑になる
- kernel の SLA 目標 (apply 成功率 / レイテンシ) が、別レイヤーの incident
  (Stripe 障害 / OIDC sign key rotation) に巻き込まれる
- self-host 利用者が kernel と Takosumi Accounts を同時運用する強制になり、
  「kernel だけ持って自前 IdP に繋ぐ」構成が取れなくなる

そこで OAuth/OIDC は **takosumi-cloud product の account plane = Takosumi
Accounts** に切り出します。kernel と Takosumi Accounts は別 service として
独立にデプロイ・運用されます。

```txt
takosumi kernel        : OAuth なし、 manifest apply のみ
takosumi-cloud accounts: OAuth/OIDC issue + billing + ownership
```

[Installable App Model](./installable-app-model.md) の責務分離節も参照。

## issuer URL と OIDC endpoint

Takosumi Accounts が公開する OIDC endpoint 一覧です。Takos / takos-cli /
takosumi-cloud dashboard はこれらを **標準 OIDC library** で consume し、
Takosumi 専用 SDK を必要としません。

Current implementation note: the Phase 1.1 scaffold lives in sibling repo path
`../takosumi-cloud/docs/accounts-service.md` and currently provides OIDC
discovery, JWKS, dev/test authorization-code flow, PKCE checks, in-memory client
registration validation, and subject derivation helpers. Persistent passkey /
upstream IdP / Stripe / AppInstallation storage remain follow-up work.

```txt
issuer = https://<ACCOUNTS_ISSUER_HOST>
```

| endpoint                            | 役割                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `/.well-known/openid-configuration` | OIDC discovery document                                                                |
| `/oauth/authorize`                  | authorization code flow の起点                                                         |
| `/oauth/token`                      | token endpoint (code → ID token / access token / refresh)                              |
| `/oauth/jwks`                       | JWKS (ID token / access token 検証鍵)                                                  |
| `/oauth/device/code`                | device authorization grant (CLI / TV など)                                             |
| `/oauth/revoke`                     | token revocation                                                                       |
| `/oauth/introspect`                 | token introspection (Resource Server 用)                                               |
| `/oauth/userinfo`                   | UserInfo endpoint (OIDC standard requirement、`new.md` §8.1 の core list を実装上補完) |

issuer URL は self-host 環境では別の OIDC issuer
(`https://keycloak.example.com/realms/takos` 等) に差し替えられます。 Takos 側は
`OIDC_ISSUER_URL` env を切り替えるだけで動きます (詳細は
[OIDC Consumer](/apps/oidc-consumer))。

## upstream IdP

Takosumi Accounts 自身のログイン手段としては複数の upstream IdP を broker
します。

- Passkey / WebAuthn
- Google
- GitHub
- Apple
- Enterprise OIDC (Azure Entra ID / Okta / OneLogin 等)
- SAML (将来)

ここで重要なのは **raw passthrough しないこと** です。Google の `sub` を
そのまま Takos に渡すのではなく、Takosumi Accounts が **stable Takosumi
subject** を中間に作ります。

```txt
upstream_google_sub = 12345
   │
   ▼
takosumi_subject = user_abc        ← 永続。upstream を変えても不変。
   │
   ▼
takos_pairwise_sub = pairwise_xyz_for_inst_123    ← app ごとに別 sub
```

raw passthrough を避ける理由:

- upstream を Google から GitHub に切り替えても account 同一性を保てる
- billing owner / app installation owner が upstream 都合で揺れない
- pairwise subject を introduction することで app 間 user tracking を防げる
- revoke / audit / team membership が stable subject に紐づく

upstream 連携の operator 側設定は [Operator: OIDC Setup](/operator/oidc-setup)
を参照。

## pairwise OIDC subject

OIDC ID token の `sub` には **app ごとの pairwise subject** を載せます。 複数
app を install した同一ユーザーであっても、app 間で `sub` が一致 しません。

```txt
sub = pairwise(appId, installationId, takosumiUserId)
```

実装上は次の式で derive します (例)。

```txt
sub = base32( HMAC_SHA256(salt, appId || installationId || takosumiUserId) )
```

pairwise subject を採用する理由:

- app 間で user tracking がされにくい
- AppInstallation を別 Space に移したとき / mode を変えたときに subject の scope
  を制御できる
- 個別 installation の revoke / 削除が、subject 廃棄として明示できる
- self-host export 時に salt を bundle に同梱することで「移行先でも同じ
  subject」を再現できる ([Upgrade / Export](/platform/upgrade-export) 参照)

`subjectMode` の宣言は AppBinding `identity.oidc@v1` の field として保持します
(詳細は [Binding Catalog](/reference/binding-catalog))。

## ID token claim 例

通常 login で Takos に渡される ID token は最小構成で十分です。

```json
{
  "iss": "https://<ACCOUNTS_ISSUER_HOST>",
  "aud": "takos_inst_abc",
  "sub": "pairwise_user_xyz",
  "email": "user@example.com",
  "email_verified": true,
  "name": "Tako",
  "picture": "https://...",
  "iat": 1760000000,
  "exp": 1760003600
}
```

team / org の文脈を渡したいときは `takosumi` namespace の custom claim を
少しだけ足します。

```json
{
  "takosumi": {
    "installation_id": "inst_abc",
    "space_id": "space_personal",
    "role": "owner"
  }
}
```

ただし custom claim には依存しすぎず、Takos は `sub` と `email` を起点に
**app-local profile**
([Takos profile](/reference/glossary#takos-profile-app-local))
を作るのが基本方針です。

## launch token (one-time bootstrap JWS)

install pipeline 完了直後にもう一度 OIDC ログインさせると UX が壊れるので、
Takosumi Accounts は **launch token JWS** を発行します。これは OIDC ID token
とは別系統の token で、`/_takosumi/launch` で 1 回だけ消費されます。

```json
{
  "iss": "https://<ACCOUNTS_ISSUER_HOST>",
  "aud": "takos.chat",
  "typ": "takosumi-install-launch",
  "installation_id": "inst_abc",
  "space_id": "space_personal",
  "subject": "user_abc",
  "role": "owner",
  "nonce": "nonce_123",
  "exp": 1760000300
}
```

launch token と OIDC ID token は **別の signing key** で発行し、Takos には
`INSTALL_LAUNCH_PUBLIC_KEY` env として dedicated key を渡します。漏洩時の
影響範囲を OIDC JWKS から隔離するためです。検証手順と replay 防止 (jti / nonce
消費) は [Launch Token](/apps/launch-token) を参照。

## ownership ledger

Takosumi Accounts は AppInstallation 台帳 (AppInstallation / AppBinding /
AppGrant / RuntimeBinding / OidcClientBinding / SourcePin / InstallationEvent)
の正本でもあります。table 設計 / status 遷移 / ユーザーに見せる Settings UI は
[AppInstallation 台帳](./app-installation.md) を参照。

REST API 形式での操作 (`POST /v1/install/preview` / `POST /v1/installations` /
`POST /v1/installations/:id/launch-token` /
`POST /v1/installations/:id/materialize` / `POST /v1/installations/:id/export`)
は [Install API](/reference/install-api) を参照。

## 既存資産からの抽出移管

Takosumi Accounts は新規概念ですが、実装は **既存 `takos/app/` の OAuth IdP /
Stripe billing / quota / metering 資産を抽出移管** することで構築します。
コードは捨てずに、責務だけ移します。

| 既存資産 (`takos/app/`)                       | 移管先 (Takosumi Accounts)           |
| --------------------------------------------- | ------------------------------------ |
| OAuth IdP (`/oauth/*`, consent UI)            | accounts plane の OAuth/OIDC issuer  |
| Stripe billing (account / plan / invoice)     | accounts plane の billing            |
| usage event / quota / rollup                  | accounts plane の billing rollup     |
| account / authIdentities / accountMemberships | Takosumi Account / membership ledger |

抽出移管に伴う Takos 側の docs 影響は [apps/oidc-consumer](/apps/oidc-consumer)
と [operator/oidc-setup](/operator/oidc-setup) を参照。 Installable App Model
の文脈での既存資産の位置づけは
[Installable App Model](/architecture/installable-app-model)
も参照してください。

## 次に読むページ

- [Installable App Model](./installable-app-model.md) — ecosystem 全体像と 5
  entity 責務分離
- [AppInstallation 台帳](./app-installation.md) — ownership primitive の table
  設計
- [OIDC Consumer](/apps/oidc-consumer) — Takos が consumer として要求する env /
  route / callback
- [Launch Token](/apps/launch-token) — `/_takosumi/launch` の検証
- [Install API](/reference/install-api) — Takosumi Accounts が公開する REST API
- [Glossary: Takosumi Accounts](/reference/glossary#takosumi-accounts)
