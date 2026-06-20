# 初回セットアップ

> このページでわかること: self-host / operator-managed Takos を新規に立ち上げるときの Web ベース確認。

Takos distribution worker は Takos product surface と embedded Takosumi Accounts / deploy-control / dashboard を同一
origin に compose します。self-host ではその origin 自身が OIDC issuer です。hosted Takosumi の public platform では
`https://app.takosumi.com` が issuer になります。

Takos runtime は外部 hosted Takosumi Accounts を必須にしません。upstream Google / GitHub / enterprise OIDC / passkey は
embedded Takosumi Accounts plane の upstream IdP / credential policy として扱い、Takos product routes は account-plane subject
から app-local profile / session を作ります。

## Prerequisites

- Takos OpenTofu module が backing resources (D1 / KV / R2 / Queues / DO / containers) を provision 済み
- worker artifact が同じ origin に deploy 済み
- `BASE_URL` / `TAKOSUMI_ACCOUNTS_ISSUER` / `OIDC_ISSUER_URL` がその worker origin を指す
- embedded Accounts plane の signing key / pairwise secret / launch-token secret / export download secret が operator secret store にある
- `DB` / `TAKOSUMI_ACCOUNTS_DB` / `TAKOSUMI_CONTROL_DB` / `SESSION_DO` などの bindings が production または staging profile にある
- trusted edge / internal service secret は public internet へ露出していない

`takos/` shell から本番・staging deploy を直接進めません。deploy 設定と secret 操作は operator-local secret store と
Takosumi operations runbook で管理してください。

## Env テーブル

| key                        | secret  | scope                 | 用途                                               |
| -------------------------- | ------- | --------------------- | -------------------------------------------------- |
| `BASE_URL`                 | no      | worker origin         | Takos / embedded Takosumi の public origin         |
| `TAKOSUMI_ACCOUNTS_ISSUER` | no      | Accounts plane        | 同一 origin issuer                                 |
| `OIDC_ISSUER_URL`          | no      | Takos auth consumer   | 通常は `TAKOSUMI_ACCOUNTS_ISSUER` と同じ           |
| `OIDC_CLIENT_ID`           | no      | Accounts projection   | 同一 origin Accounts plane が発行した client id    |
| `OIDC_CLIENT_SECRET`       | yes     | Accounts projection   | confidential client secret                         |
| `OIDC_REDIRECT_URI`        | no      | Accounts projection   | `<BASE_URL>/auth/oidc/callback`                    |
| `TAKOS_INSTALLATION_ID`    | no      | Takos runtime         | Installation id (app-local profile の FK)          |
| `DB`                       | binding | Takos product         | app-local persistence                              |
| `TAKOSUMI_ACCOUNTS_DB`     | binding | Accounts plane        | account / OIDC / billing ledger                    |
| `TAKOSUMI_CONTROL_DB`      | binding | deploy-control plane  | Installation / Run / State / Output / audit ledger |
| `SESSION_DO`               | binding | Takos product session | browser session store                              |

`OIDC_*` は「外部 Accounts service を注入する」ための値ではなく、同一 origin Accounts plane が Takos product routes に投影する
consumer metadata です。

## 1. Admin Web に入る

browser で worker origin を開きます。

```text
https://<BASE_URL>/
```

未ログインなら `/auth/oidc/login` へ進み、同一 origin の Accounts issuer で認証します。Takos は
`/auth/oidc/login` / `/auth/oidc/callback` / `/auth/logout` を consumer route として受けます。upstream IdP は Accounts
plane 側の policy で扱います。

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

Takos bootstrap の primary path は Web UI / public API です。OpenTofu module typed Runs、Installation、Deployment、
OutputSnapshot、provider connection、Gateway coverage、billing / OIDC policy は embedded Takosumi services が扱います。
