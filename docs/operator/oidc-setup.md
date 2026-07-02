# OIDC 設定

**Takos は OpenTofu-native, Takosumi-managed な first-party AI workspace distribution です。** Self-host では外部 Takosumi
Accounts plane が OIDC issuer になります。Takosumi は Takos distribution を Capsule として扱い、
**Capsule -> Run -> StateVersion -> Output** という run ledger を記録します。OIDC client 設定そのものは account-plane policy であり、Takosumi Accounts plane が所有します。

## Current Flow

1. Takos の OpenTofu Capsule (`deploy/opentofu`) を install して **Capsule** を作る。`var.target = cloudflare`で、`cloudflare` target は backing resource (D1 / KV / R2 / Queues) を provision する。
2. **`plan` type Run** を実行し、記録された plan・diff・warning を review する。
3. review 済みの plan を **`apply` type Run** として apply する。成功した apply が **StateVersion** と **Output** を記録する。
4. ProviderConnection が credential reference を保持し、ProviderBinding が module の使う provider (+ optional alias) ごとに explicit ProviderConnection を解決し、policy が provider allowlist・state backend・Cloudflare Container 実行を解決し、Takosumi は policy decision と各 run を audit ledger に記録する。
5. OIDC clients, billing, domains, dashboard などの account-plane policy は Takosumi Accounts plane が所有する。

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takosumi records the run ledger (Capsule / Run / StateVersion / Output) for the applied OpenTofu Capsule, while Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) used by the module, and policy resolves provider allowlists and state handling. Takosumi Accounts plane が OIDC / billing / dashboard などの account-plane policy を所有する。

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
