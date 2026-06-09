# アプリ構成

Takos のアプリは Takosumi に optional にインストールできる。Takosumi は OpenTofu-native な deploy control plane で、アプリの deploy topology を一つの plain OpenTofu module として install / apply し、**Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment** という run ledger を記録する。module metadata は Git URL / ref / commit / tag / module path と well-known OpenTofu outputs から解決する。

## Current Flow

1. アプリの OpenTofu module (Git URL / ref) を install して **Installation** を作る。
2. **`plan` type Run** を実行し、記録された plan・diff・warning を review する。
3. review 済みの plan を **`apply` type Run** として apply する。成功した apply が **StateSnapshot**、**OutputSnapshot**、**Deployment** を記録する。
4. Connection が credential reference を保持し、ProviderBinding が provider (+ optional alias) ごとに default / connection / manual / disabled の binding を解決し、policy が provider allowlist・state backend・実行 image / resource limits・Cloudflare Container 実行を解決し、Takosumi は policy decision と各 run を audit ledger に記録する。
5. account-plane policy（OIDC clients / billing / domains / dashboard）は operator distribution / Takosumi Accounts が所有する。

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the run ledger (Installation / Run / Deployment / OutputSnapshot) for the applied OpenTofu module, while Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to a default / connection / manual / disabled binding, and policy resolves provider allowlists and state handling. account-plane policy（OIDC / billing / dashboard）は operator distribution / Takosumi Accounts が所有する。

## OpenTofu Module Shape

Takosumi に渡す install 対象は plain OpenTofu module であり、`var.target` で deploy 先を選ぶ。

```hcl
module "app" {
  source = "github.com/example/app//deploy/opentofu"
  target = "cloudflare" # aws | gcp | cloudflare
}
```

target を選ぶと、typed Runs を経て Deployment が更新され、非機密な endpoint は OutputSnapshot として記録される。Takos product routes は別の deployment proxy を露出せず、Takosumi deploy control plane の run ledger を信頼する。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
