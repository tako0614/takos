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
   `TAKOSUMI_ACCOUNTS_URL`、`OIDC_ISSUER_URL`、`OIDC_CLIENT_ID`、`OIDC_REDIRECT_URI`（confidential client の
   `OIDC_CLIENT_SECRET` は operator が secret store から別途設定する）。
5. operator が `OIDC_OWNER_SUBJECT` を、登録した Takos client で所有者へ返る正確な `sub` に
   設定する。これは Accounts の4つの consumer metadata とは別の Takos アプリ設定です。
   所有者 pin が未設定・形式不正なら login は `503` で停止します。形式上有効でも、
   固定した所有者とは別の subject なら callback が `403` で拒否します。

Takos は各自が自分用にデプロイする、所有者1人のインスタンスです。subject を email、表示名、
Workspace ID、最初にアクセスした人から推測しません。browser/mobile client が別の pairwise subject
を返す場合は、その client と subject の対応を Accounts 側で確認します。自動 alias や複数所有者の
追加は行いません。既存 issuer/subject の変更とデータ移管は別の操作として扱います。

`/.well-known/takos` の `issuer` は Takos 製品の origin です。OIDC の issuer にはこの値を転用せず、
`OIDC_ISSUER_URL` を使います。discovery の field は [API リファレンス](/reference/api#インスタンスの-discovery)
に記載しています。

## Takos が受ける route

- `/auth/oidc/login` — issuer への認証開始
- `/auth/oidc/callback` — UserInfo を検証し、app-local session を作る
- `/auth/logout` — session の破棄

Takos の dynamic client は public PKCE client を標準とし、
`openid profile email offline_access capsules:read capsules:write` を要求します。
callback は署名・state・nonce・PKCE と固定した `(issuer, sub)` を検証し、UserInfo の
`takosumi.workspace_id` と一意で一致する `workspace_memberships` を確認した場合だけ
所有者の app-local profile / session を作ります。

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
