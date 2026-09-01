# 初回セットアップ

> このページでわかること: self-host / operator-managed Takos を新規に立ち上げるときの Web ベース確認。

Takos distribution worker は Takos product surface を提供します。production login
には外部 OIDC issuer が必要ですが、その issuer は Takosumi Accounts に限定されません。
Takosumi integrationを構成した場合はAccounts / deploy-control / dashboardを外部
Takosumi control planeが所有します。

Takosumi未接続時はgeneric OIDC subjectからapp-local profile / sessionを作り、
delegated Capsule stateとInterface機能だけを無効にします。接続時のupstream
Google / GitHub / enterprise OIDC / passkeyはTakosumi Accounts側のpolicyです。

## Prerequisites

- Takos OpenTofu module が product backing resources (D1 / KV / R2 / Queues) を provision 済み
- worker artifact が同じ origin に deploy 済み
- `BASE_URL` がTakos worker origin、`OIDC_ISSUER_URL`が選択したissuerを指す
- shared control-plane機能を使う場合だけ`TAKOSUMI_ACCOUNTS_URL`を設定する
- `DB` / `SESSION_DO` などの Takos product bindings が production または staging profile にある
- trusted edge / internal service secret は public internet へ露出していない

`takos/` shell から本番・staging deploy を直接進めません。deploy 設定と secret 操作は operator-local secret store と
Takosumi operations runbook で管理してください。

## Env テーブル

| key                        | secret  | scope                 | 用途                                               |
| -------------------------- | ------- | --------------------- | -------------------------------------------------- |
| `BASE_URL`                 | no      | worker origin         | Takos public origin                                |
| `TAKOSUMI_ACCOUNTS_URL`    | no      | optional integration  | external Takosumi public control API               |
| `OIDC_ISSUER_URL`          | no      | Takos auth consumer   | generic OIDC issuerまたはTakosumi Accounts         |
| `OIDC_CLIENT_ID`           | no      | OIDC client           | issuerが発行したclient id                          |
| `OIDC_CLIENT_SECRET`       | optional | OIDC client          | confidential clientの場合だけ使うsecret            |
| `OIDC_REDIRECT_URI`        | no      | OIDC client           | `<BASE_URL>/auth/oidc/callback`                    |
| `ENCRYPTION_KEY`           | yes     | Takos product DB      | app-local secret と委任OAuth tokenの暗号化         |
| `TAKOS_INSTALLATION_ID`    | no      | Takos runtime         | legacy-named app-local Capsule/profile id          |
| `DB`                       | binding | Takos product         | app-local persistence                              |
| `SESSION_DO`               | binding | Takos product session | browser session store                              |

`OIDC_*` は選択したissuerのconsumer metadataです。local developmentでは
`http://127.0.0.1:8792`の`takosumi-dev-server`を既定issuer/control APIとして使います。

## 1. Admin Web に入る

browser で worker origin を開きます。

```text
https://<BASE_URL>/
```

未ログインなら `/auth/oidc/login` へ進み、構成したOIDC issuerで認証します。Takos は
`/auth/oidc/login` / `/auth/oidc/callback` / `/auth/logout` を consumer route として受けます。upstream IdP は Accounts
issuer側のpolicyで扱います。

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
