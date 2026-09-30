# システムアーキテクチャ

**前提: Takos は provider-neutral で OpenTofu ネイティブな AI workspace distribution です。**
`deploy/product-resources.json` が必要なリソースと runtime 接続の graph を所有し、
`deploy/opentofu/cloudflare` が現在の product-graph adapter です。provider-gap bridge は
既定で無効なため、通常の production provider apply は未対応の gap を暗黙に解決しません。
それらが必要な disposable E2E は、環境に合った reviewed bridge mode を明示的に選びます。
Takosumi はこれを **OpenTofu Capsule** として install し、
**Capsule → Run → StateVersion → Output** を記録します。Connections は credential
reference を保持し、ProviderBindings は provider（+ optional alias）ごとに明示的な
ProviderConnection を解決し、policy は provider allowlist と state 扱いを解決します。
install の metadata は repository の Git identity と `/.well-known/takosumi.json` から来ます。

## 動く流れ

1. Takos が `deploy/product-resources.json` で論理トポロジーを宣言し、
   `deploy/opentofu/cloudflare` が具体リソースへ写像する。
2. Takosumi がその module から **Capsule** を作る（Git URL / ref + module path、
   ProviderConnection / ProviderBinding / policy の下）。
3. **`plan` type Run** が OpenTofu plan を計算し、reviewer が承認する。
4. 承認済み plan が **`apply` type Run** として適用され、成功した apply が
   **StateVersion** と **Output**（非 secret の service URL / binding map を含む）を記録する。

## 境界

Takos が持つのは利用者向け workspace 体験です: chat、agent、memory、Workspace、
app launcher。Git、storage、agent runtime、file handler、UI surface、MCP は
Capsule Output と Takos runtime contract を通じて公開されます。Takosumi は run ledger
（Capsule / Run / StateVersion / Output）と各 run を許可した policy 判定を記録します。
Takosumi Accounts plane は account-plane policy（billing、OIDC、domains、dashboard）を持ちます。

Takos は Takosumi にとって特別な形ではありません。現在の Cloudflare adapter は
Workers、D1、KV、R2、Queues、Vectorize、Containers、Durable Objects を product 所有の
graph から組み立てます。旧 Provider 1.x の Takoform projection は source history として
残るだけで、現在の Form vocabulary では必要な product graph を正直に表現できません。

module は汎用の tool / runtime container を作りません。computer へのアクセス、
browser automation、Git Actions は、同じ普通の Capsule と Interface contract を通じて
install・接続される別の capability です。`takosumi_takos` のような catch-all
resource は導入せず、Takos と third-party アプリの両方が必要とし既存の形では表せない
semantics があるときだけ、新しい generic service form を追加します。

## 実体化

Cloudflare `wrangler.toml` は adapter 内部の artifact / runtime 設定であり、
resource authority ではありません。

## 次に読む

- [セルフホスト概要](/deploy/)
- [インストール方法](/apps/install-paths)
- [Internal trust boundaries](./internal-trust-boundaries.md)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
