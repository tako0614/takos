# OIDC Consumer

> このページでわかること: Takos が OIDC consumer として必要とする環境変数とルート。

Takos は自前の認証サーバーを持たず、Takosumi Accounts を OIDC issuer として利用します。
このページでは、Takos アプリが動作するために必要な OIDC 関連の設定を説明します。

::: tip このページの範囲
本ページは Takos が OIDC consumer として必要とする設定 (env, route, claim) を扱います。
Takosumi Accounts 側の issuer 仕様は [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)、
launch token の詳細は [Launch Token](https://github.com/tako0614/takosumi-cloud/blob/master/docs/apps/launch-token.md)、
account model の境界は [Account Model](/operator/account-model) を参照してください。
:::

---

## 1. Takos の新しい立場

Installable App Model では、bundled /
third-party app の ownership は Takosumi Account に紐づく **AppInstallation** が
保持し、login の主体は Takosumi Accounts (`operator.identity.oidc`) になります。
Takos product 自身は普通の OIDC client library で issuer を consume する **OIDC
consumer** であり、OAuth provider ではありません。

```txt
upstream IdP (Google / Passkey / Enterprise OIDC)
   │
   ▼
Takosumi Accounts (OIDC issuer)
   │  id_token / access_token
   ▼
Takos (OIDC consumer)
   │  app-local profile
   ▼
chat / agent / memory
```

Takos は issuer 専用 SDK を使わず、`OIDC_ISSUER_URL` で渡された standard OIDC
issuer に対して同一 binary で動きます。Installable App Model ではこの issuer URL
は `operator.identity.oidc` namespace export / OIDC discovery で得た Takosumi
Accounts endpoint です。Keycloak / Authentik / Auth0 などを使う 場合も、Takosumi
Accounts の upstream IdP として broker し、Takos runtime が AppInstallation
ledger を迂回して直接外部 IdP を参照する構成は標準ルートではありません。これが
Installable App Model の runtime 依存削減のコアです。

### 持たないもの

- root account / contract owner / billing owner
- OAuth client registry
- authorization UX / account credential issuance
- `/.well-known/openid-configuration` の発行

OAuth issuer / account credential ownership は Takosumi Accounts
に集約されます。詳細は
[`/architecture/takosumi-accounts`](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
を 参照してください。

---

## 2. 要求する environment 一覧

Takos runtime が起動時に必須とする OIDC 関連 env は次の 5 個です 。

| env                  | 必須 | 用途                                                                                     |
| -------------------- | ---- | ---------------------------------------------------------------------------------------- |
| `AUTH_DRIVER`        | ✅   | OIDC consumer mode を有効化する固定値。`oidc` のみ受理する                               |
| `OIDC_ISSUER_URL`    | ✅   | issuer の base URL。`https://` のみ。`/.well-known/openid-configuration` 解決元          |
| `OIDC_CLIENT_ID`     | ✅   | Takosumi Accounts がこの runtime / binding 用に発行した OIDC client id                   |
| `OIDC_CLIENT_SECRET` | ✅   | confidential client secret。secret store に置く (env 直書きは self-host 開発時のみ)      |
| `OIDC_REDIRECT_URI`  | ✅   | `<base>/auth/oidc/callback` の絶対 URL。Takosumi Accounts 側の `redirectUris` と完全一致 |

### 注入経路

managed (Use Takos / Install from Git) では、Takosumi Accounts が発行する OIDC
client と、app installation に紐づく `identity.oidc@v1` AppBinding が上記 env の
provisioning plan になります。Takosumi Accounts
の materialization result を current takosumi-git が受け取り、`${bindings.*}` /
`${secrets.*}` を解決します。 deploy request build 後も未解決なら kernel request
前に失敗します。 `OIDC_CLIENT_SECRET` は Takosumi Accounts が発行し、compiled
manifest には provider secret reference または concrete materialized value
として渡します。

self-host では operator が手で env を設定します (§6 参照)。

### 関連 env (補助)

| env                              | 必須     | 用途                                                                                                                                                                                                                                                                                 |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BASE_URL`                       | ✅       | Takos public URL。`OIDC_REDIRECT_URI` の base 部分と一致させる                                                                                                                                                                                                                       |
| `TAKOS_INSTALLATION_ID`          | ✅       | この installation の id。app-local profile の FK に使う                                                                                                                                                                                                                              |
| `ACCOUNTS_BASE_URL`              | optional | Takosumi Accounts service の base URL。`/_takosumi/launch` で受けた opaque token を `/consume` (TLS + digest pin) で redeem する relying party context (詳細 → [Launch Token (opaque + /consume)](https://github.com/tako0614/takosumi-cloud/blob/master/docs/apps/launch-token.md)) |
| `INSTALL_LAUNCH_INSTALLATION_ID` | optional | redeem 要求の AppInstallation id (`inst_xxx`)                                                                                                                                                                                                                                        |
| `INSTALL_LAUNCH_REDIRECT_URI`    | optional | Accounts が token 発行時に bind した redirect URI。redeem 時に完全一致比較                                                                                                                                                                                                           |
| `INSTALL_LAUNCH_CONSUME_PATH`    | optional | app 側の consume handler path (default `/_takosumi/launch`)                                                                                                                                                                                                                          |

## 関連 env (補助、本ページでは詳述しない)

OIDC consumer 統合に直接関係する env は上記だが、Takos runtime はその他の env
も要求する。詳細は別ページを参照。

| Env 種類                                                             | 参照先                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database (`DATABASE_URL`) / Object Store (`OBJECT_STORE_*`) / Domain | [Binding Catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md)                                                                                                                                                                           |
| Installation identifier (`TAKOS_INSTALLATION_ID`, `BASE_URL`)        | [Environment 変数](/deploy/environment)                                                                                                                                                                                                                                             |
| GitOps Deploy (`DEPLOY_INTENT_*`)                                    | [Binding Catalog § deploy-intent.gitops@v1](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md)                                                                                                                                                 |
| Launch Token (`ACCOUNTS_BASE_URL` / `INSTALL_LAUNCH_*`)              | [Launch Token (opaque + /consume)](https://github.com/tako0614/takosumi-cloud/blob/master/docs/apps/launch-token.md) / [Binding Catalog § install-launch-token@v1](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md#6-install-launch-tokenv1) |

OIDC consumer page は OIDC scope に専念し、これら他 env
は対応する各ページで詳述する。

---

## 3. 公開する route

Takos は OIDC consumer として **3 route のみ** を公開します。

| Path                  | Method | 役割                                                                             |
| --------------------- | ------ | -------------------------------------------------------------------------------- |
| `/auth/oidc/login`    | GET    | authorization code + PKCE flow を開始し、`OIDC_ISSUER_URL` の authorize へ 302   |
| `/auth/oidc/callback` | GET    | `code` + `state` を受け、token endpoint で交換し、id_token 検証後に session 作成 |
| `/auth/logout`        | POST   | server-side session を破棄し、必要なら issuer の RP-initiated logout に redirect |

### `/auth/oidc/login` の挙動

1. CSRF token (`state`) と PKCE verifier を server-side に保存する
2. `OIDC_ISSUER_URL` の `/.well-known/openid-configuration` を discovery
   (起動時に cache してよい)
3. discovery の `authorization_endpoint` に `response_type=code` /
   `client_id=$OIDC_CLIENT_ID` / `redirect_uri=$OIDC_REDIRECT_URI` /
   `scope=openid email profile` / `state=...` / `nonce=...` /
   `code_challenge=...` / `code_challenge_method=S256` を付けて 302 する

### `/auth/oidc/callback` の挙動

1. query の `state` と server-side の `state` を一致確認
2. `code` を `OIDC_REDIRECT_URI` と PKCE `code_verifier` とともに token endpoint
   で交換
3. id_token を JWS verify (`OIDC_ISSUER_URL` の jwks)、 `iss` / `aud` / `nonce`
   / `exp` を検証
4. `sub` と `email` を key に **app-local TakosProfile** を upsert
5. server-side session を作成し、HttpOnly / Secure / SameSite=Lax の cookie
   を発行
6. 元の landing path (`?next=...`) に 302

### `/auth/logout` の挙動

1. server-side session を破棄
2. cookie を expire
3. issuer が RP-initiated logout を support している場合は
   `end_session_endpoint` に redirect (optional)

---

## 4. ID token から読む claim

Takos は ID token から **最小限の claim だけ** を読みます。

| claim                      | 必須     | Takos での使い道                                        |
| -------------------------- | -------- | ------------------------------------------------------- |
| `iss`                      | ✅       | `OIDC_ISSUER_URL` と完全一致を verify                   |
| `aud`                      | ✅       | `OIDC_CLIENT_ID` と一致を verify                        |
| `sub`                      | ✅       | TakosProfile の `externalSubject` に保存 (pairwise)     |
| `iat` / `exp`              | ✅       | 期限検証                                                |
| `nonce`                    | ✅       | `/auth/oidc/login` で発行した値と一致を verify          |
| `email` / `email_verified` | optional | profile 表示・通知の宛先                                |
| `name` / `picture`         | optional | profile 表示                                            |
| `takosumi.installation_id` | optional | `TAKOS_INSTALLATION_ID` と一致を verify (Takosumi 拡張) |
| `takosumi.role`            | optional | app-local role 推定の hint (Takos 内 ACL は再評価する)  |

custom claim (`takosumi.*`) は **hint として読むだけ** で、Takos 内の
権限判定には依存しません。Takos の権限判定は AppGrant と app-local profile を
元に行います。

`sub` は **pairwise** で計算されます。同一の Takosumi user でも別 installation
では別 `sub` になり、app 間で user tracking ができないようになっています。

---

## 5. OIDC endpoints

Takos は OIDC consumer として `/auth/oidc/login` と `/auth/oidc/callback`
を持ちます。標準 OIDC endpoint と AppInstallation-owned client の発行は
Takosumi Accounts に集約されます。OAuth client が必要な third-party は
Takosumi Accounts に登録します。

---

## 6. self-host での issuer 解決

Takos は `OIDC_ISSUER_URL` で渡された issuer に対して同一 binary で動きます。
self-host 環境でも標準ルートは Takosumi Accounts を運用し、
`operator.identity.oidc` / OIDC discovery で得た issuer URL を Takos に渡す形
です。外部 OIDC は Takosumi Accounts の upstream として接続します。

```env
# managed (Use Takos / Install from Git on takosumi-cloud)
OIDC_ISSUER_URL=https://<ACCOUNTS_ISSUER_HOST>
OIDC_CLIENT_ID=takos_inst_abc
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://takos-acct123.takosumi.app/auth/oidc/callback

# self-host (Takosumi Accounts; Keycloak/Auth0/etc. may be upstream)
OIDC_ISSUER_URL=https://accounts.example.com
OIDC_CLIENT_ID=takos
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://takos.example.com/auth/oidc/callback

# enterprise self-host (company IdP is upstream behind Takosumi Accounts)
OIDC_ISSUER_URL=https://accounts.company.com
OIDC_CLIENT_ID=takos
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://takos.company.com/auth/oidc/callback
```

Takos runtime が直接検証する issuer は Takosumi Accounts です。Accounts が
upstream として接続する enterprise IdP 側の要件は Accounts docs の対象であり、
Takos runtime contract ではありません。Takos から見える issuer
側の要件は以下です:

- OpenID Connect 1.0 / OAuth 2.1 準拠
- authorization code + PKCE (`S256`) を support
- `subject_types_supported` に `pairwise` または `public` を含む
- ID token に `iss` / `aud` / `sub` / `iat` / `exp` / `nonce` を含む
- `email` claim を `email` scope で発行できる

custom claim (`takosumi.*`) は optional です。ただし Installable App Model の
標準ルートでは、Takosumi Accounts 以外の issuer を Takos runtime が直接
参照して AppInstallation ledger を迂回する構成は採用しません。

---

## 7. 次に読むページ

- [Launch Token](https://github.com/tako0614/takosumi-cloud/blob/master/docs/apps/launch-token.md)
  — install 直後の one-time bootstrap
- [Install Paths](/apps/install-paths) — Use / Install from Git / Self-host の 3
  経路
- [.takosumi/app.yml spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)
  — `bindings.auth` の宣言
- [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
  — issuer 側の責務
- [Glossary](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/glossary.md)
  — OIDC consumer / pairwise OIDC subject 等
