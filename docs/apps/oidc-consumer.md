# OIDC Consumer

Installable App Model における Takos の identity 立場を整理し、Takos が
**OIDC consumer** として要求する environment / route / claim を確定する
ページです。OAuth provider としての Takos は廃止され、issuer は Takosumi
Accounts (forward 3-level dotted service identifier `takosumi.account.auth@v1`
で参照される service、 endpoint URL example: `accounts.takosumi.cloud`) に
集約されます (詳細は
[cross-instance service binding](/architecture/cross-instance-service-binding)
/ ecosystem ROADMAP §1.9)。

## このページで依存してよい範囲 / してはいけない範囲

**依存してよい範囲**:

- Takos が runtime contract として要求する OIDC env 名 (§2)
- Takos が公開する `/auth/oidc/*` route の入口仕様 (§3)
- Takos が ID token から読み取る claim 名 (§4)
- self-host における issuer 切替の env 形 (§6)

**依存してはいけない範囲**:

- Takosumi Accounts side の wire-level OIDC issuer spec (endpoint URL、
  scope catalog、key rotation 周期) — これは
  [`/architecture/takosumi-accounts`](/architecture/takosumi-accounts) と
  Takosumi Accounts 側の正本を参照する。本ページは consumer 視点に閉じる
- pairwise subject の derivation 関数本体 — Takosumi Accounts 側の責務
- launch token の payload / 検証 — [/apps/launch-token](/apps/launch-token) を参照

---

## 1. Takos の新しい立場

Installable App Model (`new.md` §0, §11) では、Takos の identity は
Takosumi Account に紐づく **AppInstallation** が保持し、login の主体は
Takosumi Accounts (service identifier `takosumi.account.auth@v1`、 endpoint
example: `accounts.takosumi.cloud`) になります。Takos 自身は
普通の OIDC client library で issuer を consume する **OIDC consumer**
であり、OAuth provider ではありません。

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

Takos は issuer 専用 SDK を使わず、`OIDC_ISSUER_URL` で渡された任意の
issuer (service identifier `takosumi.account.auth@v1` 経由で resolved、
endpoint example `accounts.takosumi.cloud` / Keycloak / Authentik / Auth0 など)
に対して同一 binary で動きます。これが Installable App Model の
runtime 依存削減のコアです (`new.md` §15, §29)。

### 持たないもの

- root account / contract owner / billing owner
- OAuth client registry
- consent screen / device code flow
- `/.well-known/openid-configuration` の発行

すべて Takosumi Accounts に集約されます。詳細は
[`/architecture/takosumi-accounts`](/architecture/takosumi-accounts) を
参照してください。

---

## 2. 要求する environment 一覧

Takos runtime が起動時に必須とする OIDC 関連 env は次の 5 個です
(`new.md` §15)。

| env                  | 必須 | 用途                                                                                       |
| -------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `AUTH_DRIVER`        | ✅   | OIDC consumer mode を有効化する固定値。`oidc` のみ受理する                                  |
| `OIDC_ISSUER_URL`    | ✅   | issuer の base URL。`https://` のみ。`/.well-known/openid-configuration` 解決元             |
| `OIDC_CLIENT_ID`     | ✅   | この AppInstallation 用に Takosumi Accounts が発行した OIDC client id                       |
| `OIDC_CLIENT_SECRET` | ✅   | confidential client secret。secret store に置く (env 直書きは self-host 開発時のみ)         |
| `OIDC_REDIRECT_URI`  | ✅   | `<base>/auth/oidc/callback` の絶対 URL。Takosumi Accounts 側の `redirectUris` と完全一致    |

### 注入経路

managed (Use Takos / Install from Git) では、AppInstallation に紐づく
`identity.oidc@v1` AppBinding が compile 時に上記 env を解決します
(`new.md` §5.1, §6 を参照)。`OIDC_CLIENT_SECRET` は Takosumi Accounts
が発行し、Compiled manifest 上では `${secrets.auth.clientSecret}` の
placeholder を経由します。

self-host では operator が手で env を設定します (§6 参照)。

### 関連 env (補助)

| env                       | 必須 | 用途                                                                |
| ------------------------- | ---- | ------------------------------------------------------------------- |
| `BASE_URL`                | ✅   | Takos public URL。`OIDC_REDIRECT_URI` の base 部分と一致させる      |
| `TAKOS_INSTALLATION_ID`   | ✅   | この installation の id。app-local profile の FK に使う             |
| `INSTALL_LAUNCH_PUBLIC_KEY` | optional | launch token 検証用 (詳細 → [/apps/launch-token](/apps/launch-token)) |
| `INSTALL_LAUNCH_AUDIENCE`   | optional | 同上                                                              |
| `INSTALL_LAUNCH_ISSUER`     | optional | 同上 (`iss` claim 完全一致確認、OIDC `OIDC_ISSUER_URL` とは別管理)  |

## 関連 env (補助、本ページでは詳述しない)

OIDC consumer 統合に直接関係する env は上記だが、Takos runtime はその他の env も要求する。詳細は別ページを参照。

| Env 種類 | 参照先 |
|---|---|
| Database (`DATABASE_URL`) / Object Store (`OBJECT_STORE_*`) / Domain | [Binding Catalog](/reference/binding-catalog) |
| Installation identifier (`TAKOS_INSTALLATION_ID`, `BASE_URL`) | [Environment 変数](/deploy/environment) |
| GitOps Deploy (`DEPLOY_INTENT_*`) | [Binding Catalog § deploy-intent.gitops@v1](/reference/binding-catalog) |
| Launch Token (`INSTALL_LAUNCH_*`) | [Launch Token](/apps/launch-token) |

OIDC consumer page は OIDC scope に専念し、これら他 env は対応する正本ページで詳述する。

---

## 3. 公開する route

Takos は OIDC consumer として **3 route のみ** を公開します
(`new.md` §11)。

| Path                   | Method      | 役割                                                                          |
| ---------------------- | ----------- | ----------------------------------------------------------------------------- |
| `/auth/oidc/login`     | GET         | authorization code + PKCE flow を開始し、`OIDC_ISSUER_URL` の authorize へ 302 |
| `/auth/oidc/callback`  | GET         | `code` + `state` を受け、token endpoint で交換し、id_token 検証後に session 作成 |
| `/auth/logout`         | POST        | server-side session を破棄し、必要なら issuer の RP-initiated logout に redirect |

### `/auth/oidc/login` の挙動

1. CSRF token (`state`) と PKCE verifier を server-side に保存する
2. `OIDC_ISSUER_URL` の `/.well-known/openid-configuration` を
   discovery (起動時に cache してよい)
3. discovery の `authorization_endpoint` に
   `response_type=code` / `client_id=$OIDC_CLIENT_ID` /
   `redirect_uri=$OIDC_REDIRECT_URI` / `scope=openid email profile` /
   `state=...` / `nonce=...` / `code_challenge=...` /
   `code_challenge_method=S256` を付けて 302 する

### `/auth/oidc/callback` の挙動

1. query の `state` と server-side の `state` を一致確認
2. `code` を `OIDC_REDIRECT_URI` と PKCE `code_verifier` とともに
   token endpoint で交換
3. id_token を JWS verify (`OIDC_ISSUER_URL` の jwks)、
   `iss` / `aud` / `nonce` / `exp` を検証
4. `sub` と `email` を key に **app-local TakosProfile** を upsert
5. server-side session を作成し、HttpOnly / Secure / SameSite=Lax の
   cookie を発行
6. 元の landing path (`?next=...`) に 302

### `/auth/logout` の挙動

1. server-side session を破棄
2. cookie を expire
3. issuer が RP-initiated logout を support している場合は
   `end_session_endpoint` に redirect (optional)

---

## 4. ID token から読む claim

Takos は ID token から **最小限の claim だけ** を読みます
(`new.md` §8.3)。

| claim                       | 必須 | Takos での使い道                                              |
| --------------------------- | ---- | ------------------------------------------------------------- |
| `iss`                       | ✅   | `OIDC_ISSUER_URL` と完全一致を verify                          |
| `aud`                       | ✅   | `OIDC_CLIENT_ID` と一致を verify                              |
| `sub`                       | ✅   | TakosProfile の `externalSubject` に保存 (pairwise)           |
| `iat` / `exp`               | ✅   | 期限検証                                                       |
| `nonce`                     | ✅   | `/auth/oidc/login` で発行した値と一致を verify                 |
| `email` / `email_verified`  | optional | profile 表示・通知の宛先                                  |
| `name` / `picture`          | optional | profile 表示                                              |
| `takosumi.installation_id`  | optional | `TAKOS_INSTALLATION_ID` と一致を verify (Takosumi 拡張) |
| `takosumi.role`             | optional | app-local role 推定の hint (Takos 内 ACL は再評価する)    |

custom claim (`takosumi.*`) は **hint として読むだけ** で、Takos 内の
権限判定には依存しません。Takos の権限は AppGrant
(`new.md` §22.6, [/apps/install-paths](/apps/install-paths)) と
app-local profile が canonical です。

`sub` は **pairwise** で計算されます。同一 Takosumi user でも別
installation では別 `sub` になり、app 間の user tracking は防がれます
(`new.md` §8.2、用語集の [pairwise OIDC subject](/reference/glossary#pairwise-oidc-subject) 参照)。

---

## 5. 削除された OAuth route

Installable App Model では、Takos から以下の route が **削除** されます
(`new.md` §11)。

| 旧 route             | 削除後の移行先                                                                       |
| -------------------- | ------------------------------------------------------------------------------------ |
| `/oauth/authorize`   | Takosumi Accounts の `/oauth/authorize` (`accounts.takosumi.cloud`) に集約            |
| `/oauth/token`       | Takosumi Accounts の `/oauth/token` に集約                                            |
| `/oauth/consent`     | Takosumi Accounts の consent UI に集約                                                |
| `/oauth/device`      | Takosumi Accounts の `/oauth/device/code` に集約                                      |
| `/oauth/clients`     | Takosumi Accounts の OIDC client registry に集約。client は AppInstallation ごとに発行 |
| `/auth/external` (legacy) | `/auth/oidc/login` + `/auth/oidc/callback` の 2 route に分離                     |

これらの route は Takos 自身からは取り除かれ、Takosumi Accounts に
集約されます。第三者 client が Takos を OAuth issuer として参照していた
場合は、Takosumi Accounts の OIDC client として登録し直す必要があります。

---

## 6. self-host での issuer 切替

Takos は `OIDC_ISSUER_URL` で渡された issuer に対して同一 binary で
動きます。self-host 環境では operator が任意の OIDC issuer を選択可能
です (`new.md` §16, §24)。

```env
# managed (Use Takos / Install from Git on takosumi-cloud)
OIDC_ISSUER_URL=https://accounts.takosumi.cloud
OIDC_CLIENT_ID=takos_inst_abc
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://takos-acct123.takosumi.app/auth/oidc/callback

# self-host (Keycloak)
OIDC_ISSUER_URL=https://keycloak.example.com/realms/takos
OIDC_CLIENT_ID=takos
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://takos.example.com/auth/oidc/callback

# self-host (Authentik)
OIDC_ISSUER_URL=https://authentik.example.com/application/o/takos/
OIDC_CLIENT_ID=takos
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://takos.example.com/auth/oidc/callback

# enterprise
OIDC_ISSUER_URL=https://login.company.com
OIDC_CLIENT_ID=takos
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://takos.company.com/auth/oidc/callback
```

issuer 側に対する Takos の要件は以下のみです:

- OpenID Connect 1.0 / OAuth 2.1 準拠
- authorization code + PKCE (`S256`) を support
- `subject_types_supported` に `pairwise` または `public` を含む
- ID token に `iss` / `aud` / `sub` / `iat` / `exp` / `nonce` を含む
- `email` claim を `email` scope で発行できる

custom claim (`takosumi.*`) は optional であり、Takosumi Accounts 以外
の issuer ではなくても Takos は動きます。

---

## 7. 次に読むページ

- [Launch Token](/apps/launch-token) — install 直後の one-time bootstrap
- [Install Paths](/apps/install-paths) — Use / Install from Git / Self-host の 3 経路
- [.takosumi/app.yml spec](/reference/app-yml-spec) — `bindings.auth` の宣言
- [Takosumi Accounts](/architecture/takosumi-accounts) — issuer 側の責務
- [Glossary](/reference/glossary) — OIDC consumer / pairwise OIDC subject 等
