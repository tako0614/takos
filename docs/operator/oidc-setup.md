# OIDC 設定

Self-host では、外部の Takosumi Accounts plane が OIDC issuer になります。
Takos product routes は OIDC consumer として振る舞い、OIDC client の設定そのものは
account-plane policy として Takosumi Accounts plane が所有します。

## 設定の流れ

1. Takos の OpenTofu Capsule（`deploy/opentofu/cloudflare`）を install し、
   **Capsule** を作る。接続した Cloudflare account に product graph が materialize される。
2. **`plan` type Run** を実行し、記録された plan・diff・warning を確認する。
3. 確認した plan を **`apply` type Run** として適用する。成功した apply が
   **StateVersion** と **Output** を記録する。
4. Accounts plane が Takos product routes へ OIDC consumer metadata を投影する:
   `OIDC_ISSUER_URL`、`OIDC_CLIENT_ID`、`OIDC_REDIRECT_URI`（confidential client の
   `OIDC_CLIENT_SECRET` は operator が secret store から別途設定する）。

## Takos が受ける route

- `/auth/oidc/login` — issuer への認証開始
- `/auth/oidc/callback` — UserInfo を検証し、app-local session を作る
- `/auth/logout` — session の破棄

Takos の dynamic client は public PKCE client を標準とし、
`openid profile email offline_access capsules:read capsules:write` を要求します。
callback は UserInfo の `takosumi.workspace_id` と一意で一致する
`workspace_memberships` を検証した場合だけ session を発行します。

## install 対象の形

Takosumi に渡す install 対象は普通の OpenTofu Capsule です。

```hcl
module "takos" {
  source = "github.com/tako0614/takos//deploy/opentofu/cloudflare"
}
```

adapter を選ぶと typed Runs を経て StateVersion と Output が更新され、
非 secret の endpoint は Output として記録されます。

## 次に読む

- [初回セットアップ](/operator/bootstrap) — env 一覧を含む前提条件
- [アカウントモデル](/operator/account-model) — 認証の所有権
- [OIDC 連携](/apps/oidc-consumer) — install したアプリ側の OIDC
