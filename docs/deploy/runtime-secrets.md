# ランタイムシークレット

Takos Worker が読む runtime secret は 5 つです。

| binding | 形式 | 用途 |
| --- | --- | --- |
| `ENCRYPTION_KEY` | 64 文字の hex、またはそれ以外の長さの passphrase | 保存トークンなどの AES-256-GCM 暗号化。Worker は 64 文字ちょうどの値を hex として 32 byte に復号し、それ以外は UTF-8 の passphrase として扱い、いずれも PBKDF2-SHA256 に通します。 |
| `TAKOS_AGENT_START_TOKEN` | 不透明な文字列 | executor host から agent container の `/start` への bearer credential。定数時間比較のみです。 |
| `TAKOS_INTERNAL_API_SECRET` | 不透明な文字列 | `/internal/*` の `X-Takos-Internal-Secret` header 比較。 |
| `PLATFORM_PRIVATE_KEY` | RSA-2048 PKCS#8 PEM | runtime service JWT の RS256 署名鍵。 |
| `PLATFORM_PUBLIC_KEY` | RSA-2048 SPKI PEM | 上記と対になる公開鍵。 |

## OpenTofu は値を持ちません

`deploy/opentofu/cloudflare` は 5 つの **名前** だけを宣言し、値は一切保持しません。
Takosumi の Run は OpenTofu state を StateVersion として保存するので、module 内で
secret を生成すれば、それは公開された secret になります。`random_password` や
`tls_private_key` のような生成 resource、値を持つ `secret_text` binding、
secret を含む Output は、`bun run validate:opentofu-secrets` が拒否します。

## Takosumi への要求 (takosumi.com/v2.4)

`.well-known/takosumi.json` は `takosumi.com/v2.4` で、対称鍵 3 つを
`secret.generated` として host に要求します。

```json
{
  "kind": "secret.generated",
  "bytes": 32,
  "encoding": "hex",
  "deliver": { "bindings": { "value": "ENCRYPTION_KEY" } }
}
```

repository が要求できる生成 secret の形はこれだけです。32 byte 固定、hex 固定、
binding への delivery 固定で、`ENCRYPTION_KEY`、`TAKOS_AGENT_START_TOKEN`、
`TAKOS_INTERNAL_API_SECRET` はこの形に収まります。

manifest は要求であって値ではありません。実際に host が鋳造するかは host の lane
次第で、Takosumi は CredentialRecipe で run-scoped sensitive input protocol を
宣言した provider にだけ配送します。上流の Cloudflare provider はこれを宣言しない
ため、この BYOC module では要求は現状 inert で、5 つとも operator が投入します。
それでも宣言を置くのは、これがアプリの必要条件の正本だからで、配送できる host lane
では manifest を変えずに満たされます。

## RSA 鍵対を生成 secret にしない理由

`PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` は operator が用意します。

- 生成 secret は 32 byte hex の 1 形だけで、鍵対を表現できません。
- Worker は `jose.importPKCS8(pem, "RS256")` で読み込むため、値は RSA-2048 の
  PKCS#8 PEM でなければなりません。seed から鍵を導出する経路は Worker にありません。
- host 側の rsa-key-pair material は operator が所有する InstallConfig の領域で、
  repository manifest から要求できません。

生成は `bun run generate:keys` を使います。PKCS#8 の秘密鍵と SPKI の公開鍵を出力し、
値を標準出力に出しません。

### ENCRYPTION_KEY の 2 つの符号化

`ENCRYPTION_KEY` は長さで解釈が変わります。64 文字ちょうどなら hex として 32 byte に
復号され、それ以外は文字列そのものが passphrase になります。host が鋳造する
`secret.generated` は 64 文字の hex なので前者、`bun run generate:keys` は 32 byte の
base64 (44 文字) を出すので後者です。どちらも有効ですが、**導出される鍵は異なります**。
データを書いたあとに符号化を変えると既存の暗号文を復号できなくなるので、1 つの install
では最初に選んだ形式を変えないでください。

## 投入手順

module は 5 つの名前を Cloudflare の `inherit` binding として bind します。
`inherit` は既存 version の binding を値を送らずに引き継ぐので、後続の apply が
operator の secret を落としません。

Worker Version の binding 一覧は完全な集合です。`runtime_secrets_provisioned = false`
は「5 つを bind しない version を出す」という意味で、`ENCRYPTION_KEY` を失った
deployment では、その鍵で暗号化した MCP OAuth token、registry credential、
environment snapshot が**復号できなくなります**。だから既定は `true` で、
`false` にできるのは値がまだ存在しない初回 install だけです。その 1 回は
`first_install_acknowledgement = "FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS"` を
完全一致で宣言します。宣言が無ければ plan が拒否され、値を投入したあとに
宣言が残っていても拒否されます。

順序は次の 3 段です。

1. `runtime_secrets_provisioned = false` と
   `first_install_acknowledgement = "FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS"` で
   apply する。secret が無い間、Worker は `/health` 以外の全 path に `503` を返します。
2. 5 つの値を投入する。

   ```sh
   bun run generate:keys
   wrangler secret put ENCRYPTION_KEY
   wrangler secret put TAKOS_AGENT_START_TOKEN
   wrangler secret put TAKOS_INTERNAL_API_SECRET
   wrangler secret put PLATFORM_PRIVATE_KEY
   wrangler secret put PLATFORM_PUBLIC_KEY
   ```

3. `runtime_secrets_provisioned = true` に戻し、`first_install_acknowledgement` を
   空に戻して再度 apply する。以後の apply はこの設定のままです。

`.tfvars`、OpenTofu output、Git リポジトリへ値を保存しないでください。

## 関連ページ

- [セルフホスト概要](/deploy/)
- [環境と変数](/deploy/environment)
- [デプロイ手順](/deploy/deploy)
