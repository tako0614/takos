# ルートとドメイン

Takos は `deploy/opentofu/cloudflare` の OpenTofu module と、wrangler での
artifact upload という 2 段でデプロイします。できあがる worker が product の
route を提供し、外部の Takosumi Accounts / deploy-control / dashboard / OpenTofu
runner の surface を消費します。

## worker が持つ route

- トップ (`/`) — browser の product UI
- `/auth/oidc/login`、`/auth/oidc/callback`、`/auth/logout` —
  Takosumi Accounts issuer への OIDC consumer route
- その他の product API route — chat、Workspace、アプリの操作

`BASE_URL` が worker の public origin です。認証は外部の Takosumi Accounts
origin（`TAKOSUMI_ACCOUNTS_URL` / `OIDC_ISSUER_URL`）へ投げます。

## ドメイン

production / staging の host 名と custom domain は、Takosumi の deploy 設定と
Cloudflare の route 設定で決まります。`takos/` shell から本番 deploy を直接進めず、
operator-local の secret store と operations runbook で管理してください。

## 次に読む

- [セルフホスト概要](/deploy/)
- [初回セットアップ](/operator/bootstrap)
- [実行場所](/deploy/namespaces)
