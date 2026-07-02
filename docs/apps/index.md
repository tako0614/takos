# アプリ構成

Takos のアプリは Workspace に install され、launcher、file handler、MCP tools、UI surface として表示されます。裏側では
Takosumi Capsule が正本です。アプリ repo は Git URL から入る OpenTofu Capsule で、Takosumi は
**Capsule -> Run -> StateVersion -> Output** の ledger を記録します。

## Current Flow

1. アプリの OpenTofu Capsule (Git URL / ref / module path) を install して Capsule を作る。
2. `plan` Run で変更、警告、policy decision を review する。
3. review 済みの saved plan を `apply` Run として apply する。
4. 成功した apply が StateVersion と Output を記録する。
5. Takos はその結果を app launcher / tools / handlers / UI surface に投影する。

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through Capsule Outputs and Takos runtime contracts. Takosumi records Run / StateVersion / Output evidence for the applied OpenTofu Capsule, while ProviderConnections hold credential references, ProviderBindings resolve each provider (+ optional alias) to an explicit ProviderConnection, and policy resolves provider allowlists and state handling. account-plane policy（OIDC / billing / dashboard）は Takosumi Accounts plane が所有する。

## OpenTofu Capsule Shape

Takosumi に渡す install 対象は OpenTofu Capsule であり、`var.target` で deploy 先を選ぶ。

```hcl
module "app" {
  source = "github.com/example/app//deploy/opentofu"
  target = "cloudflare" # cloudflare only
}
```

target を選ぶと、typed Runs を経て StateVersion と Output が更新され、非機密な endpoint は Output として記録されます。Takos
product routes は別の product-local deployment surface を露出せず、Takosumi deploy-control plane の run ledger と Capsule output projection を信頼します。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
