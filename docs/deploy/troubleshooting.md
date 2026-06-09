# トラブルシューティング

**Takos は plain OpenTofu module として self-host 完結し、Takosumi は optional です。** Takosumi は OpenTofu-native な deploy control plane で、Takos の deploy topology は一つの plain OpenTofu module (`deploy/opentofu`) として表現される。Takosumi はその module を install / apply し、**Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment** という run ledger を記録する。トラブルシュート時はこの run ledger を起点に状態を確認する。

## Current Flow

1. Takos の OpenTofu module (`deploy/opentofu`, `var.target` は `aws | gcp | cloudflare`) を install して **Installation** を作る。`cloudflare` target は backing resource (D1 / KV / R2 / Queues) を provision する。
2. **`plan` type Run** を実行し、記録された plan・diff・warning を review する。失敗時はこの `plan` type Run の記録を確認する。
3. review 済みの plan を **`apply` type Run** として apply する。成功した apply が **StateSnapshot**、**OutputSnapshot**、**Deployment** を記録する。apply が失敗した場合は `apply` type Run の audit 記録を確認する。
4. Connection が credential reference を保持し、ProviderBinding が provider (+alias) ごとの接続を解決し、policy が provider allowlist・state backend・実行 image / resource limits・Cloudflare Container 実行を解決する。権限や provider 関連の失敗は policy decision を確認する。
5. account-plane policy（OIDC clients / billing / domains / dashboard）は operator distribution / Takosumi Accounts が所有する。

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the run ledger (Installation / Run / Deployment / OutputSnapshot) for the applied OpenTofu module, while Connections hold credential references, ProviderBindings resolve the connection for each provider (+ optional alias), and policy resolves provider allowlists and state handling. account-plane policy（OIDC / billing / dashboard）は operator distribution / Takosumi Accounts が所有する。

## OpenTofu Module Shape

Takosumi に渡す install 対象は plain OpenTofu module です。module metadata は Git URL / ref / commit / module path と well-known OpenTofu outputs から解決する。

```hcl
module "takos" {
  source = "github.com/example/takos//deploy/opentofu"
  target = "cloudflare" # aws | gcp | cloudflare
}
```

target を選ぶと、typed Runs を経て Deployment が更新され、非機密な endpoint は OutputSnapshot として記録される。Takos product routes は別の deployment proxy を露出せず、Takosumi deploy control plane の run ledger を信頼する。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
