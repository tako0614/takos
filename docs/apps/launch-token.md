# Launch Token

Install 直後の **one-time bootstrap** に使う短命 JWS の仕様と、Takos 側の
`/_takosumi/launch` の挙動を整理します。Launch token は OIDC とは **別系統**
であり、UX 最適化のためだけに存在します。

## このページで依存してよい範囲 / してはいけない範囲

**依存してよい範囲**:

- Takos `/_takosumi/launch` の入力 / 出力 / 検証順序 (§5)
- Launch token JWS の payload field 名と semantics (§3)
- Launch token と OIDC の境界 (§2)
- 検証 env (`INSTALL_LAUNCH_PUBLIC_KEY` / `INSTALL_LAUNCH_AUDIENCE` /
  `INSTALL_LAUNCH_ISSUER`、§6)

**依存してはいけない範囲**:

- Takosumi Accounts 側の発行 endpoint
  (`POST /v1/installations/:id/launch-token`) の wire shape — 詳細は Install API
  章 (Phase 1.4) と `new.md` §26.3 を参照
- 鍵 rotation の運用詳細 — Takosumi Accounts 側の責務
- `installation.launched` event の ledger 構造 — AppInstallation 台帳章
  ([/architecture/app-installation](/architecture/app-installation)) を参照
- 通常の sign-in 経路 — [/apps/oidc-consumer](/apps/oidc-consumer) を参照

---

## 1. 役割

Launch token は **install 完了直後の auto sign-in** 専用の短命 JWS です
(`new.md` §9)。

```txt
Install Takos
   │
   ▼
Takosumi Accounts が AppInstallation を ready にする
   │
   ▼
Takosumi Accounts が launch token を 1 個発行
   │
   ▼
https://<host>/_takosumi/launch?token=<JWS> に redirect
   │
   ▼
Takos が token を verify
   │
   ▼
owner session 作成 + cookie 発行
   │
   ▼
chat が開く
```

二度目以降の login は OIDC consumer flow
([/apps/oidc-consumer](/apps/oidc-consumer)) を使い、Launch token は **install
bootstrap 1 回限り** で消費されます。

---

## 2. なぜ OIDC を直接使わないか

Install 完了直後にもう一度 OIDC dance を走らせると、ユーザーは "install 完了 →
ログイン画面 → 同意 → ようやく chat" という余計な往復を強い られ、Use Takos
が約束する instant UX が成立しません (`new.md` §9 / §10.1)。

Launch token はこの 1 hop を消すための **専用 short-lived JWS** で、
以下の制約のもとに OIDC とは別経路として運用されます。

| 観点                     | Launch token                                                                                                 | OIDC ID token                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| 目的                     | install bootstrap (1 回限り)                                                                                 | sign-in の継続的な identity assertion                   |
| 寿命 (`exp - iat`)       | **≤ 5 分**                                                                                                   | issuer policy (例: 1 時間)                              |
| 再利用                   | 不可 (one-time、`jti` 消費)                                                                                  | 期限内は再利用可                                        |
| 発行 endpoint            | Takosumi Accounts の installation API ([`POST /v1/installations/{id}/launch-token`](/reference/install-api)) | Takosumi Accounts `/oauth/token`[^accounts-oauth-token] |
| 消費 endpoint (Takos)    | `/_takosumi/launch`                                                                                          | `/auth/oidc/callback`                                   |
| `typ` (header / payload) | `takosumi-install-launch+jwt` / `takosumi-install-launch`                                                    | `JWT`                                                   |
| signing key channel      | env (`INSTALL_LAUNCH_PUBLIC_KEY`)                                                                            | issuer の `/oauth/jwks`                                 |

[^accounts-oauth-token]: ここでの `/oauth/token` は service identifier
    `takosumi.account.auth@v1` で解決される **Takosumi Accounts 側の正規 OIDC
    token endpoint** を指す。Takos 自身の旧 `/oauth/token` route は Installable
    App Model 移行時点で **廃止済み** であり
    ([/apps/oidc-consumer §5](/apps/oidc-consumer))、Takos は OAuth provider
    ではない。第三者 client は Takosumi Accounts の OIDC client として登録し直す
    必要がある。

両者の signing key は **混在させない**: Launch token の pubkey を OIDC の
`/oauth/jwks` に publish せず、OIDC ID token を `/_takosumi/launch` に渡しても
`typ` 不一致で reject されます。これは **key confusion 攻撃 の物理的な遮断**
です。

---

## 3. JWS payload (例)

```json
{
  "iss": "https://accounts.example.com",
  "aud": "takos.chat",
  "typ": "takosumi-install-launch",
  "installation_id": "inst_abc",
  "space_id": "space_personal",
  "subject": "PXM4N5K7Q2R8S3T9U6V4W1Y0",
  "role": "owner",
  "jti": "lt_01HXXXXXXXXXXXXXXXXXXXXXXX",
  "nonce": "n_01HXXXXXXXXXXXXXXXXXXXXXXX",
  "iat": 1762512000,
  "exp": 1762512300
}
```

JOSE header:

```json
{
  "alg": "EdDSA",
  "kid": "launch-2026-q2",
  "typ": "takosumi-install-launch+jwt"
}
```

### claim の意味

| claim             | 必須 | 説明                                                                           |
| ----------------- | ---- | ------------------------------------------------------------------------------ |
| `iss`             | ✅   | issuer URL。Takos は `INSTALL_LAUNCH_ISSUER` env と完全一致を要求する          |
| `aud`             | ✅   | この AppInstallation の `appId` (例: `takos.chat`)。string 1 個固定、配列禁止  |
| `typ`             | ✅   | **`takosumi-install-launch`** で固定。OIDC ID token (`JWT`) の混入を防ぐ       |
| `installation_id` | ✅   | AppInstallation id                                                             |
| `space_id`        | ✅   | owner が属する Space                                                           |
| `subject`         | ✅   | pairwise subject。OIDC ID token の `sub` と同一値                              |
| `role`            | ✅   | `owner` / `admin` / `member` / `viewer` のいずれか。MVP は `owner` のみ        |
| `jti`             | ✅   | globally unique。**replay protection の primary key**                          |
| `nonce`           | ✅   | issue 時に Takosumi Accounts が install state とともに保持する一致確認用 value |
| `iat`             | ✅   | 発行時刻 (UNIX seconds)                                                        |
| `exp`             | ✅   | 失効時刻。`exp - iat ≤ 300` (= 5 分) を強制                                    |

custom claim 拡張は禁止です (forward compat 確保)。

---

## 4. 検証条件 (要約)

`/_takosumi/launch` の verifier は以下を **すべて** 満たした場合のみ session
を作ります。1 つでも失敗すれば 401 を返し session は作りません。

| 条件            | 内容                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| transport       | **HTTPS only**。HTTP では受理しない                                                    |
| `alg` whitelist | `EdDSA` (default) / `RS256` のみ。**`none` は即 reject**                               |
| header `typ`    | `takosumi-install-launch+jwt` (大小一致)                                               |
| 署名検証        | `kid` に対応する pubkey を `INSTALL_LAUNCH_PUBLIC_KEY` から解決し署名を verify         |
| `iss` / `aud`   | `INSTALL_LAUNCH_ISSUER` / `INSTALL_LAUNCH_AUDIENCE` と完全一致                         |
| payload `typ`   | `takosumi-install-launch`                                                              |
| `exp`           | `now < exp`、clock skew tolerance ≤ 30 秒                                              |
| `iat`           | `iat ≤ now + 30` 秒                                                                    |
| 寿命            | `exp - iat ≤ 300` (= 5 分)                                                             |
| `jti` 一意性    | **one-time consume ledger** (server-side store) に未登録                               |
| 必須 claim      | `installation_id` / `space_id` / `subject` / `role` / `jti` / `nonce` がすべて present |

`jti` 消費 ledger への insert と session 作成は **同一 transaction** に
まとめます。

---

## 5. `/_takosumi/launch` の挙動

```txt
GET / POST  /_takosumi/launch?token=<JWS>
```

### 入力

- query (`?token=...`) または POST form / body に compact JWS が 1 個

### 検証順序

| Step | 内容                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------- |
| 1    | Transport check (HTTPS) → 失敗で reject                                                         |
| 2    | JWS parse → 失敗で `invalid_token`                                                              |
| 3    | header `alg` / `typ` / `kid` を whitelist 検査                                                  |
| 4    | 署名検証 (`INSTALL_LAUNCH_PUBLIC_KEY` から pubkey 解決)                                         |
| 5    | payload claim 検査 (`iss` / `aud` / `typ` / `exp` / `iat` / 寿命 / 必須 claim)                  |
| 6    | `jti` consume ledger に **atomic insert** + session 作成 (同一 transaction)                     |
| 7    | TakosProfile を upsert (`installation_id` を FK、`subject` を `externalSubject` に保存)         |
| 8    | HttpOnly / Secure / SameSite=Lax cookie を発行                                                  |
| 9    | URL に token を残さない landing path に **302 redirect**。`Referrer-Policy: no-referrer` を付与 |
| 10   | access log に raw token を残さない (記録は `jti` / `iat` / `exp` のみ)                          |

### 失敗時の error code

すべて `401 Unauthorized` を返し、body は OAuth 2.0 Bearer error 形式
に準拠します。

```
invalid_token        : parse / typ / alg failure
invalid_signature    : signature verification failure
expired              : exp 超過
not_yet_valid        : iat 未来
audience_mismatch    : aud != this app
issuer_mismatch      : iss != expected
token_replayed       : jti consumed
malformed_claims     : 必須 claim 欠落 / 型不一致
```

### 成功後

- 通常の API call は cookie session で動く
- Launch token は **二度と使わない** (再投入すれば `token_replayed`)
- session refresh / 再認証は OIDC consumer flow に切り替わる
  ([/apps/oidc-consumer](/apps/oidc-consumer))
- `/auth/logout` は server-side session を破棄するだけで Launch token
  には触れない (元々消費済み)

---

## 6. 検証用 environment

`/_takosumi/launch` verifier が要求する env は以下の 3 個です。

| env                         | 必須                      | 用途                                                               |
| --------------------------- | ------------------------- | ------------------------------------------------------------------ |
| `INSTALL_LAUNCH_PUBLIC_KEY` | ✅ (launch UX を使う場合) | PEM 形式の Ed25519 / RSA pubkey、または複数 `kid` を含む JWKS JSON |
| `INSTALL_LAUNCH_AUDIENCE`   | ✅ (launch UX を使う場合) | `appId` (例: `takos.chat`)。`aud` claim の一致確認に使う           |
| `INSTALL_LAUNCH_ISSUER`     | ✅ (launch UX を使う場合) | 期待 `iss`。OIDC `OIDC_ISSUER_URL` と値は同じでも、env は別管理    |

これらの env は AppInstallation の `install-launch-token@v1` AppBinding が
compile 時に注入します。OIDC `/oauth/jwks` 経由で pubkey を取得しま **せん** —
channel を物理的に分離することで key confusion 攻撃を防ぎます (§2 の non-overlap
原則)。

self-host (export bundle、§24) では、operator が pubkey を local issuer
と組合せて差し替えます。bundle に raw pubkey を含めますが秘密鍵は含めません。

---

## 7. 通常ログインとの違い

| 観点             | Launch token (本ページ)                | OIDC consumer flow ([/apps/oidc-consumer](/apps/oidc-consumer))  |
| ---------------- | -------------------------------------- | ---------------------------------------------------------------- |
| 想定タイミング   | install 直後 1 回                      | install 後の任意のタイミング (再 sign-in / 別端末 / cookie 失効) |
| 入口 route       | `/_takosumi/launch`                    | `/auth/oidc/login`                                               |
| 出口             | session cookie                         | session cookie                                                   |
| 再利用           | 不可 (`token_replayed`)                | OIDC token は期限内 reuse 可                                     |
| ユーザーの操作   | redirect を辿るだけ (consent 不要)     | consent / passkey / 2FA を含む                                   |
| 失敗時の影響範囲 | この 1 install のみ                    | issuer の policy 全体                                            |
| 後続 sign-in     | OIDC に切り替わる                      | OIDC を継続                                                      |
| `role` 信頼境界  | bootstrap hint。後続 API は ACL 再評価 | issuer の claim を canonical に扱う                              |

Launch token はあくまで bootstrap です。Takos の権限判定は session
作成後、**server-side ACL** と AppGrant が canonical です。 `payload.role`
をそのまま延長 / 永続化しないでください。

---

## 8. 次に読むページ

- [Install API: `POST /v1/installations/{id}/launch-token`](/reference/install-api#launch-token)
  — JWS を発行する REST endpoint (request / response / status code の正本)
- [OIDC Consumer](/apps/oidc-consumer) — bootstrap 後の通常 sign-in
- [Install Paths](/apps/install-paths) — Use Takos の instant UX 全体
- [.takosumi/app.yml spec](/reference/app-yml-spec) —
  `install.postInstallLaunchPath` と `bindings.bootstrap` の宣言
- [Glossary](/reference/glossary) — launch token JWS / pairwise OIDC subject
