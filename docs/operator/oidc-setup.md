# OIDC 設定

Takos にサインインする方法を決める設定です。Takos 自身はパスワードもアカウントも
持たず、運営者が選んだ OIDC issuer に本人確認を任せます。Keycloak、Authentik、
Auth0 などの一般的な OIDC issuer をそのまま使えます。Takosumi Accounts を使う場合
も、Takos から見れば issuer の一つです。

## 前提

- Takos を動かす公開 URL が決まっていること
- issuer 側で Authorization Code Flow のクライアントを作れること
- issuer が `<issuer>/.well-known/openid-configuration` を返せること

## 設定手順

1. issuer 側でクライアントを作り、リダイレクト URI に
   `https://<Takos の公開 URL>/auth/oidc/callback` を登録します。
2. 発行された client ID と、必要なら client secret を控えます。
3. Takos に次の環境変数を設定します。

   | 変数 | 必須 | 内容 |
   | --- | --- | --- |
   | `OIDC_ISSUER_URL` | 必須 | issuer のベース URL。ここから discovery 文書を取得します |
   | `OIDC_CLIENT_ID` | 必須 | issuer が発行したクライアント ID |
   | `OIDC_CLIENT_SECRET` | 任意 | confidential client のときだけ設定します |
   | `OIDC_REDIRECT_URI` | 必須 | 手順 1 で登録した URI と完全に同じ文字列 |
   | `ENCRYPTION_KEY` | 必須 | セッションと委任トークンの暗号化に使います |

4. Takos を再起動し、サインインを試します。

要求する scope は Takos が決めます。単体で使う場合は `openid profile email`
です。Takosumi Accounts と連携する構成では、委任に必要な scope を追加します。

## 確認

- `<issuer>/.well-known/openid-configuration` がブラウザから開けること
- サインイン後に元の画面へ戻ること
- 同じ人が二重に登録されていないこと

## つまずきやすいところ

- **リダイレクト URI は文字列が完全一致する必要があります。** ローカル用と本番用を
  混ぜたり、末尾のスラッシュが違うだけでも失敗します。
- **issuer を変えると別人になります。** Takos は `(issuer, sub)` の組で本人を決めます。
  メールアドレスが同じでも、issuer か `sub` が変わると別のプロフィールになります。
- **`ENCRYPTION_KEY` を設定していないと委任トークンが平文で残ります。** ログや
  OpenTofu state に出さないよう、設定してから運用を始めてください。

ローカル開発では issuer に `http://127.0.0.1:8792`、クライアント ID に
`local-oidc-client` を使う既定値が入ります。本番ではこの既定値に依存しないで
ください。

## 関連

- [アカウントモデル](/operator/account-model) — `(issuer, sub)` の扱いと運営者チェックリスト
- [環境と変数](/deploy/environment)
- [セルフホストの概要](/deploy/)
- [トラブルシューティング](/deploy/troubleshooting)
- [Takosumi API リファレンス](https://takosumi.com/docs/reference/api)
