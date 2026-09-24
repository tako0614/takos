# OIDC 設定

self-host の Takos は、外部の Takosumi Accounts plane を OIDC issuer として
サインインします。OIDC client の設定はアカウント側の policy であり、
Takosumi Accounts plane が所有します。Takos 側が持つのは issuer への接続設定だけです。

## 必要な環境変数

| 変数 | 必須 | 内容 |
| --- | --- | --- |
| `OIDC_ISSUER_URL` | yes | Takosumi Accounts の issuer URL |
| `OIDC_CLIENT_ID` | yes | issuer に登録した client の ID |
| `OIDC_CLIENT_SECRET` | optional | confidential client の場合だけ使う secret。public client では送らず、生成する場合は `--confidential-oidc` を指定する (runtime secret として投入) |
| `OIDC_REDIRECT_URI` | yes | 登録した callback URL |
| `OIDC_DISCOVERY_URL` | optional | discovery document の URL (issuer から導ける場合は省略可) |

callback のパスは `/auth/oidc/callback` です。issuer 側の client には、その
URL を redirect URI として登録します。

## サインインの流れ

1. 利用者が `/auth/oidc/login` を開くと、worker は issuer の
   authorization endpoint へリダイレクトします。PKCE は S256、state は短命の
   HttpOnly cookie にも置き、callback で state が一致しない応答を拒否します。
2. 要求する scope は `openid profile email offline_access capsules:read
   capsules:write` です。
3. callback で code を token に交換し、profile を解決して session を作ります。

## 確認とつまずきやすいところ

- client ID / redirect URI（secret を使う場合は secret も）は issuer に登録した値と完全一致させます。
- `OIDC_CLIENT_SECRET` は runtime secret として扱い、公開の Output や
  リポジトリには書きません。値の形式と投入順序は
  [ランタイムシークレット](/deploy/runtime-secrets)を参照してください。
- 公開 hosted install 向けの OIDC client は operator の承認後に account plane
  が開きます。開くまでは同じ流れを rehearsal / self-host 環境で確認できます。

## 関連ページ

- [オペレーター向けガイド](/operator/)
- [アカウントモデル](/operator/account-model)
- [Deploy overview](/deploy/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
