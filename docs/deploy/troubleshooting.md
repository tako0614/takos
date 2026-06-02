# トラブルシューティング

**Takos は Takosumi 上で動く product であり、Takosumi にデプロイされる。** Takosumi は OpenTofu-native な deploy control plane で、Takos の deploy topology は一つの plain OpenTofu module (`deploy/opentofu`) として表現される。Takosumi はその module を install / apply し、**Installation → PlanRun → ApplyRun → Deployment → DeploymentOutput** という run ledger を記録する。トラブルシュート時はこの run ledger を起点に状態を確認する。

## Current Flow

1. Takos の OpenTofu module (`deploy/opentofu`, `var.target` は `aws | gcp | cloudflare`) を install して **Installation** を作る。`cloudflare` target は backing resource (D1 / KV / R2 / Queues) を provision する。
2. **PlanRun** を実行し、記録された plan・diff・warning を review する。失敗時はこの PlanRun の記録を確認する。
3. review 済みの plan を **ApplyRun** として apply する。成功した apply が **Deployment** と **DeploymentOutput** を更新する。apply が失敗した場合は ApplyRun の audit 記録を確認する。
4. provider allowlist・credential reference・state backend・実行 image / resource limits・Cloudflare Container 実行は **RunnerProfile** が所有する。権限や provider 関連の失敗は RunnerProfile policy decision を確認する。
5. account-plane policy（OIDC clients / billing / domains / dashboard）は operator distribution / Takosumi Accounts が所有する。

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the run ledger (Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput) for the applied OpenTofu module, while the RunnerProfile owns the provider allowlist, credentials, and state backend. account-plane policy（OIDC / billing / dashboard）は operator distribution / Takosumi Accounts が所有する。

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
