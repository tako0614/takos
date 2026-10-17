# 環境と変数

Takos worker が読む環境変数と secret の一覧です。値の種類は 3 つに分かれます:
公開してよい設定値、operator が持つ secret、OpenTofu が用意する binding。

## 公開設定値

| key | 用途 |
| --- | --- |
| `BASE_URL` | Takos worker の public origin |
| `TAKOSUMI_ACCOUNTS_URL` | 外部 Takosumi Accounts API / issuer の origin |
| `OIDC_ISSUER_URL` | Takosumi Accounts issuer |
| `OIDC_OWNER_SUBJECT` | このインスタンス唯一の所有者の正確な issuer-bound `sub`。login公開前にoperatorが設定 |
| `OIDC_CLIENT_ID` | Accounts plane が発行した client id |
| `OIDC_REDIRECT_URI` | `<BASE_URL>/auth/oidc/callback` |
| `TAKOS_INSTALLATION_ID` | app-local の Capsule / profile id（legacy 命名） |

`OIDC_OWNER_SUBJECT` は Takos アプリ設定です。通常moduleの `env`、またはNode/self-hostの
同名環境変数で指定します。`identity.oidc` のissuer/client/redirect4値から所有者を推測しません。
未設定では browser、bearer、既存cookieの所有者admissionを認めません。

`OIDC_CLIENT_SECRET` は confidential client の場合だけ、operator の secret store
から設定します。

## runtime secret

worker が読む secret は 5 つです。`deploy/opentofu/cloudflare` は名前だけを知り、
値は持ちません。OpenTofu state は Takosumi の StateVersion として保存されるため、
module 内で生成した値は公開済み secret になります。secret は必ず
`wrangler secret put` で入れます。

| key | 用途 |
| --- | --- |
| `ENCRYPTION_KEY` | app-local secret と委任 OAuth token の暗号化（64 文字 hex = 32 byte） |
| `TAKOS_AGENT_START_TOKEN` | agent 実行の起票用 opaque token |
| `TAKOS_INTERNAL_API_SECRET` | 内部 service 呼び出し用 opaque token |
| `PLATFORM_PRIVATE_KEY` | runtime-service JWT 署名用 RSA-2048 PKCS#8 PEM |
| `PLATFORM_PUBLIC_KEY` | 上記に対応する公開鍵 |

`.well-known/takosumi.json` の `secret.generated` 要求は 3 つの対称 secret
（`ENCRYPTION_KEY`、`TAKOS_AGENT_START_TOKEN`、`TAKOS_INTERNAL_API_SECRET`）
に対応します。RSA 鍵対は generated-secret の形では表せないため、
`bun run generate:keys` で生成して `wrangler secret put` で入れます。

## binding

`DB`、`SESSION_DO` などの product binding は OpenTofu module が provision します。
詳しい env の前提条件は [初回セットアップ](/operator/bootstrap) の表を参照してください。
