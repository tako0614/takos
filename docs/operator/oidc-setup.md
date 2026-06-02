# OIDC 設定

**Takos は Takosumi 上で動く product であり、Takosumi にデプロイされる。** Takosumi は OpenTofu-native な deploy control plane で、Takos の deploy topology は一つの OpenTofu module (`deploy/opentofu`) として install / apply され、**Installation → PlanRun → ApplyRun → Deployment → DeploymentOutput** という run ledger に記録される。OIDC client 設定そのものは account-plane policy であり、operator distribution / Takosumi Accounts が所有する。

## Current Flow

1. Takos の OpenTofu module (`deploy/opentofu`) を install して **Installation** を作る。`var.target` は `aws | gcp | cloudflare` のいずれかで、`cloudflare` target は backing resource (D1 / KV / R2 / Queues) を provision する。
2. **PlanRun** を実行し、記録された plan・diff・warning を review する。
3. review 済みの plan を **ApplyRun** として apply する。成功した apply が **Deployment** と **DeploymentOutput** を更新する。
4. provider allowlist・credential reference・state backend・Cloudflare Container 実行は **RunnerProfile** が所有し、Takosumi は RunnerProfile policy decision と各 run を audit ledger に記録する。
5. OIDC clients, billing, domains, dashboard などの account-plane policy は operator distribution / Takosumi Accounts が所有する。

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the run ledger (Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput) for the applied OpenTofu module, while the RunnerProfile owns the provider allowlist, credentials, and state backend. operator distribution / Takosumi Accounts が OIDC / billing / dashboard などの account-plane policy を所有する。

## OpenTofu Module Shape

Takosumi に渡す install 対象は plain OpenTofu module であり、Takosumi 専用 manifest や `.takosumi.*` file は要求しない。module metadata は Git URL / ref / commit / module path と well-known OpenTofu outputs から解決する。

```hcl
module "takos" {
  source = "github.com/example/takos//deploy/opentofu"
  target = "cloudflare" # aws | gcp | cloudflare
}
```

target を選ぶと、PlanRun / ApplyRun を経て Deployment が更新され、非機密な endpoint は DeploymentOutput として記録される。Takos product routes は別の deployment proxy を露出せず、Takosumi deploy control plane の run ledger を信頼する。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
