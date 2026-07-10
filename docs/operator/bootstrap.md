# 初回セットアップ

> このページでわかること: self-host / operator-managed Takos を新規に立ち上げるときの Web ベース確認。

Takos distribution worker は Takos product surface を提供し、Accounts / deploy-control / dashboard は外部 Takosumi
control plane が所有します。self-host では self-hoster または operator が運用する Takosumi Accounts origin が OIDC issuer
です。hosted Takosumi の public platform では `https://app.takosumi.com` が issuer になります。

Takos runtime は外部 hosted Takosumi Accounts を必須にしません。upstream Google / GitHub / enterprise OIDC / passkey は
Takosumi Accounts plane の upstream IdP / credential policy として扱い、Takos product routes は account-plane subject
から app-local profile / session を作ります。

## Prerequisites

- Takos OpenTofu module が product backing resources (D1 / KV / R2 / Queues) を provision 済み
- worker artifact が同じ origin に deploy 済み
- `BASE_URL` が Takos worker origin、`TAKOSUMI_ACCOUNTS_URL` / `OIDC_ISSUER_URL` が Takosumi Accounts origin を指す
- `DB` / `SESSION_DO` などの Takos product bindings が production または staging profile にある
- trusted edge / internal service secret は public internet へ露出していない

`takos/` shell から本番・staging deploy を直接進めません。deploy 設定と secret 操作は operator-local secret store と
Takosumi operations runbook で管理してください。

## Env テーブル

| key                        | secret  | scope                 | 用途                                               |
| -------------------------- | ------- | --------------------- | -------------------------------------------------- |
| `BASE_URL`                 | no      | worker origin         | Takos public origin                                |
| `TAKOSUMI_ACCOUNTS_URL`    | no      | Accounts plane        | external Takosumi Accounts API / issuer origin     |
| `OIDC_ISSUER_URL`          | no      | Takos auth consumer   | Takosumi Accounts issuer                           |
| `OIDC_CLIENT_ID`           | no      | Accounts projection   | Takosumi Accounts plane が発行した client id       |
| `OIDC_CLIENT_SECRET`       | optional | Accounts projection  | confidential client の場合だけ使う secret          |
| `OIDC_REDIRECT_URI`        | no      | Accounts projection   | `<BASE_URL>/auth/oidc/callback`                    |
| `ENCRYPTION_KEY`           | yes     | Takos product DB      | app-local secret と委任OAuth tokenの暗号化         |
| `TAKOS_INSTALLATION_ID`    | no      | Takos runtime         | legacy-named app-local Capsule/profile id          |
| `DB`                       | binding | Takos product         | app-local persistence                              |
| `SESSION_DO`               | binding | Takos product session | browser session store                              |

`OIDC_*` は Takosumi Accounts plane が Takos product routes に投影する consumer metadata です。

## 1. Admin Web に入る

browser で worker origin を開きます。

```text
https://<BASE_URL>/
```

未ログインなら `/auth/oidc/login` へ進み、Takosumi Accounts issuer で認証します。Takos は
`/auth/oidc/login` / `/auth/oidc/callback` / `/auth/logout` を consumer route として受けます。upstream IdP は Accounts
plane 側の policy で扱います。

Takos の dynamic client は public PKCE client を標準とし、`openid profile email offline_access capsules:read
capsules:write` を要求します。callback は access/refresh token と UserInfo の親 Takosumi Workspace binding を
`ENCRYPTION_KEY` で暗号化して app-local DB に保存します。Takos 内の Workspace は product data boundary であり、
Takosumi Workspace を同数作りません。app launcher の plan/apply/list/delete は、ログイン時に発行された親 Workspace
binding に対して行います。

## 2. 初回 setup を完了する

初回ユーザーは `/setup` に送られます。この画面は Takos app-local profile 用の username だけを保存します。ログイン用
credential、upstream IdP、PAT、billing identity は Accounts plane が所有します。

| method | path                        | 用途                        |
| ------ | --------------------------- | --------------------------- |
| GET    | `/api/setup/status`         | setup 状態確認              |
| POST   | `/api/setup/check-username` | username availability check |
| POST   | `/api/setup/complete`       | username 保存               |

## 3. Accounts bearer で API smoke を行う

automation や smoke 用 token は Accounts plane の account settings / PAT flow で発行し、operator secret store に保存します。

```bash
curl -fsS \
  -H "Authorization: Bearer $TAKOS_ACCOUNTS_TOKEN" \
  https://<BASE_URL>/api/me
```

レスポンスに setup 済み user が返れば、browser session と Accounts bearer の consumer 経路は動いています。

## Boundary

Takos bootstrap の primary path は Web UI / public API です。OpenTofu module Source / Capsule / typed Runs、
StateVersion、Output、ProviderConnection / ProviderBinding、billing / OIDC policy は external Takosumi control plane が扱います。
