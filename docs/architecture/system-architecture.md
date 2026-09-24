# システムアーキテクチャ

**前提: Takos は provider 中立の OpenTofu-native な AI workspace 配布です。**
`deploy/product-resources.json` が必要なリソースと runtime 接続の graph を所有し、
`deploy/opentofu/cloudflare` が現在の product-graph adapter です。adapter の
provider-gap bridge は既定で無効なので、通常の production apply が未対応の
Cloudflare の差分を暗黙に調整することはありません。使い捨ての E2E でその差分が
必要な場合は、環境に合う reviewed な bridge mode を明示的に選びます。
Takosumi はこれを **OpenTofu Capsule** として install し、
**Capsule → Run → StateVersion → Output** を記録します。install の metadata は
リポジトリの Git identity と `/.well-known/takosumi.json` から来ます。

## 流れ

1. Takos は論理 topology を `deploy/product-resources.json` に宣言し、
   `deploy/opentofu/cloudflare` が具体的なリソースへ写像します。
2. Takosumi はその module から **Capsule** を作ります (Git URL / ref + module path、
   ProviderConnection / ProviderBinding / policy の下)。
3. **`plan` Run** が OpenTofu の plan を計算し、レビュー担当者が承認します。
4. 確認済みの plan が **`apply` Run** として適用され、成功すると
   **StateVersion** と **Output** (秘密でない service URL / binding map を含む) が
   記録されます。
5. 接続 (credential) は ProviderConnection が参照を持ち、ProviderBinding が
   provider ごとに接続を解決します。policy は provider の許可リスト、state
   backend、workload の配置を解決します。課金、OIDC client、ドメイン、dashboard
   というアカウントの policy は Takosumi Accounts plane の管轄です。

## Takos と Takosumi の境界

Takos が持つのは利用者向けのワークスペース体験です (chat、agent、memory、
Workspace、アプリの起動)。Git、ストレージ、agent runtime、file handler、UI、
MCP は Capsule の Output と Takos の runtime contract 経由で公開されます。
Takosumi は実行履歴 (Capsule / Run / StateVersion / Output) と各 Run を認可した
policy 結果を記録します。詳しくは [Takos の概念](/platform/)を参照してください。

Takos は Takosumi の特別な形ではありません。現在の Cloudflare adapter は
product 所有の graph から Workers、D1、KV、R2、Queues、Vectorize、Containers、
Durable Objects を組み立てます。旧 Provider 1.x の Takoform projection は
source の履歴として残るだけで、現在の Form 語彙では必要な product graph を
正直に表現できません。

この module は汎用の tool / runtime container を作りません。computer access、
browser automation、Git Actions は、同じ普通の Capsule と Interface の契約を通して
install または接続される別の capability です。Takos と第三者アプリの両方が既存の
形で表せない意味を必要とするときだけ、新しい汎用 service form を追加してください。
`takosumi_takos` のようなまとめ役 resource は導入しません。

## 実体化

Cloudflare の `wrangler.toml` は adapter 内の artifact / runtime 設定であり、
リソースの権限元ではありません。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [内部トラスト境界](./internal-trust-boundaries)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
