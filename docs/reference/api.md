# API リファレンス

**Premise: Takos は plain OpenTofu module として self-host 完結し、Takosumi は optional です。** Takos の deploy topology は OpenTofu module であり、Takosumi が
それを **install して apply** します。Takosumi は OpenTofu-native な deploy control plane として run ledger を記録します:
**Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment**。Connection が credential reference を保持し、
ProviderBinding が provider (+ optional alias) ごとの binding を解決し、policy が provider allowlist / state backend / Cloudflare Container execution を解決します。

## Current Flow

1. Takos の OpenTofu module (`deploy/opentofu`、`var.target` ∈ `aws | gcp | cloudflare`) を指す
   **Installation** を作る。module metadata は Git URL / commit / tag / module path と well-known OpenTofu outputs から解決する。
2. `plan` を実行すると **`plan` type Run** が記録され、reviewed plan として diff / warning / policy decision を確認する。
3. reviewed plan を `apply` すると **`apply` type Run** が記録され、成功した apply が **Deployment** を更新する。
4. apply が公開した non-secret service URL / binding map は **OutputSnapshot** として記録される。
5. Connection が credential reference を保持し、ProviderBinding が provider (+ optional alias) ごとの binding を解決し、policy が provider allowlist / state backend / Cloudflare Container execution を解決し、
   account / billing / OIDC / dashboard は operator distribution (Takosumi Accounts) が所有する。

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata,
and MCP-facing product metadata。Takosumi records Installation / Run / Deployment / OutputSnapshot と
audit ledger。Connections hold credential references, ProviderBindings resolve each provider (and optional alias), and policy resolves provider allowlists, state handling, and runner execution。
account-plane policy (account / billing / OIDC / dashboard) は operator distribution (Takosumi Accounts) が所有する。

## Deploy authority

Takos の deploy 権威は Takosumi-applied OpenTofu module です。
`takos-private/cloudflare/wrangler.*.toml` などの hand-maintained wrangler / helm / distribute pipeline は
同じ topology の **interim materialization** であり、別の source of truth として扱わない。Takos product routes は独自の
deployment proxy を expose せず、Takosumi の deploy control API 経由で plan / apply / destroy を行う。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Internal trust boundaries](/architecture/internal-trust-boundaries)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
