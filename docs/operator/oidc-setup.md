# OIDC 設定

**Takos は plain OpenTofu module として self-host 完結し、Takosumi は optional です。** Takosumi は OpenTofu-native な deploy control plane で、Takos の deploy topology は一つの OpenTofu module (`deploy/opentofu`) として install / apply され、**Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment** という run ledger に記録される。OIDC client 設定そのものは account-plane policy であり、operator distribution / Takosumi Accounts が所有する。

## Current Flow

1. Takos の OpenTofu module (`deploy/opentofu`) を install して **Installation** を作る。`var.target` は `aws | gcp | cloudflare` のいずれかで、`cloudflare` target は backing resource (D1 / KV / R2 / Queues) を provision する。
2. **`plan` type Run** を実行し、記録された plan・diff・warning を review する。
3. review 済みの plan を **`apply` type Run** として apply する。成功した apply が **StateSnapshot**、**OutputSnapshot**、**Deployment** を記録する。
4. Connection が credential reference を保持し、ProviderBinding が module の使う provider (+ optional alias) ごとに default / connection / manual / disabled の binding を解決し、policy が provider allowlist・state backend・Cloudflare Container 実行を解決し、Takosumi は policy decision と各 run を audit ledger に記録する。
5. OIDC clients, billing, domains, dashboard などの account-plane policy は operator distribution / Takosumi Accounts が所有する。

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the run ledger (Installation / Run / Deployment / OutputSnapshot) for the applied OpenTofu module, while Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) used by the module, and policy resolves provider allowlists and state handling. operator distribution / Takosumi Accounts が OIDC / billing / dashboard などの account-plane policy を所有する。

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
