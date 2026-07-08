# デプロイ

**Takos は OpenTofu-native, Takosumi-managed な AI Workspace distribution です。** Takos の deploy topology は一つの OpenTofu
module として表現され、`tofu apply` と wrangler artifact upload で Takos product worker を publish します。Accounts /
deploy-control / dashboard / OpenTofu runner は外部 Takosumi control plane が所有し、Takosumi は
**Capsule -> Run -> StateVersion -> Output** の ledger を記録します。

module は `deploy/opentofu` にあり、`var.target = cloudflare`。`cloudflare` target は backing resource (D1 / KV / R2 / Queues) を provision し、Worker-script layer がその binding map を消費する。手書きの wrangler / distribute pipeline は同じ topology の interim materialization であって、別の source of truth ではない。

## Current Flow

1. `deploy/opentofu` を `tofu apply` して backing resources を作る。
2. module output を使って wrangler で worker artifact を upload する。
3. 外部 Takosumi Accounts / deploy-control が Workspaces と明示的に追加された Capsule の plan / apply Run ledger を記録する。
4. account-plane policy（OIDC clients / billing / domains / dashboard）は Takosumi Accounts plane が所有する。

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takosumi records the Capsule / Run / StateVersion / Output ledger for the distribution and explicitly installed Capsule apps. account-plane policy（OIDC / billing / dashboard）は
Takosumi Accounts plane が所有する。

## OpenTofu Module Shape

Takosumi に渡す install 対象は OpenTofu Capsule です。module metadata は Git URL / ref / commit / module path と well-known OpenTofu outputs から解決する。

```hcl
module "takos" {
  source = "github.com/example/takos//deploy/opentofu"
  target = "cloudflare" # cloudflare only
}
```

target を選ぶと、typed Runs を経て StateVersion と Output が更新される。Takos product routes は別の product-local deployment surface を露出せず、Takosumi deploy control plane の run ledger を信頼する。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Internal trust boundaries](/architecture/internal-trust-boundaries)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
