# リファレンス

Takos is self-hostable as a plain OpenTofu module. Takosumi, the OpenTofu-native deploy control plane, can optionally install that same module as an Installation. Takos's deploy topology — the worker, its Durable Objects, the egress / runtime-host / executor services, bindings, and routes — is an OpenTofu module that Takosumi installs and applies, recording the run ledger **Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment**. Connections hold credential references, ProviderBindings bind each provider (and optional alias) to default / connection / manual / disabled, and policy resolves provider allowlists, state backend, and Cloudflare Container execution.

## Current Flow

1. Point an Installation at the Takos OpenTofu module (`deploy/opentofu`, `var.target` ∈ `aws | gcp | cloudflare`) and select the Connection / ProviderBinding / policy that supplies the provider allowlist, credentials, and state backend.
2. Takosumi runs `plan` and records a **`plan` type Run**; review the resulting plan and policy decision before approval.
3. Apply the reviewed plan; Takosumi records an **`apply` type Run** and, on success, updates the **Deployment** and its **OutputSnapshot** (the non-secret service URLs / binding map).
4. `destroy` is also recorded as an **`apply` type Run** against the same Installation, keeping the run ledger append-only.
5. Connections hold credential references, ProviderBindings resolve each provider (and optional alias), and policy resolves provider allowlists, state backend, and Cloudflare Container execution; account-plane policy, OIDC clients, billing, and domains belong to the operator distribution (Takosumi Accounts).

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the Installation / Run / Deployment / OutputSnapshot run ledger. Operator-owned Connections hold credential references, ProviderBindings resolve each provider (and optional alias), and policy supplies provider allowlists, state backend, and execution substrate. Account-plane policy (account / billing / OIDC / dashboard) belongs to the operator distribution.

The hand-maintained `wrangler` / Helm / distribute pipeline (`takos-private/cloudflare/wrangler.*.toml`) is the interim materialization of the same OpenTofu topology — not a separate source of truth.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Internal trust boundaries](/architecture/internal-trust-boundaries)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
