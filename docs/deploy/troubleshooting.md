# トラブルシューティング

**Takos は OpenTofu-native, Takosumi-managed な first-party AI workspace distribution です。** 基本の deploy topology は
`deploy/opentofu` の OpenTofu Capsule と wrangler artifact step です。Takosumi の Capsule /
Run / StateVersion / Output ledger を起点に状態を確認します。

## Current Flow

1. Takos の OpenTofu module (`deploy/opentofu`, `var.target = cloudflare`) を install して **Capsule** を作る。`cloudflare` target は backing resource (D1 / KV / R2 / Queues) を provision する。
2. **`plan` type Run** を実行し、記録された plan・diff・warning を review する。失敗時はこの `plan` type Run の記録を確認する。
3. review 済みの plan を **`apply` type Run** として apply する。成功した apply が **StateVersion** と **Output** を記録する。apply が失敗した場合は `apply` type Run の audit 記録を確認する。
4. Connection が credential reference を保持し、ProviderBinding が provider (+alias) ごとに explicit provider connection を解決し、policy が provider allowlist・state backend・実行 image / resource limits・Cloudflare Container 実行を解決する。権限や provider 関連の失敗は policy decision を確認する。
5. account-plane policy（OIDC clients / billing / domains / dashboard）は Takosumi Accounts plane が所有する。

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takosumi records the run ledger (Capsule / Run / StateVersion / Output) for the applied OpenTofu Capsule, while Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to an explicit provider connection, and policy resolves provider allowlists and state handling. account-plane policy（OIDC / billing / dashboard）は Takosumi Accounts plane が所有する。

## OpenTofu Module Shape

Takosumi に渡す install 対象は OpenTofu Capsule です。module metadata は Git URL / ref / commit / module path と well-known OpenTofu outputs から解決する。

```hcl
module "takos" {
  source = "github.com/example/takos//deploy/opentofu"
  target = "cloudflare" # cloudflare only
}
```

target を選ぶと、typed Runs を経て StateVersion と Output が更新され、非機密な endpoint は Output として記録される。Takos product routes は別の product-local deployment surface を露出せず、Takosumi deploy control plane の run ledger を信頼する。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
