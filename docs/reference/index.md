# リファレンス

Takos is a product that runs on **Takosumi**, the OpenTofu-native deploy control plane. Takos's deploy topology — the worker, its Durable Objects, the egress / runtime-host / executor services, bindings, and routes — is an OpenTofu module that Takosumi installs and applies, recording the run ledger **Installation → PlanRun → ApplyRun → Deployment → DeploymentOutput**. A **RunnerProfile** owns the provider allowlist, credentials, state backend, and Cloudflare Container execution.

## Current Flow

1. Point an Installation at the Takos OpenTofu module (`deploy/opentofu`, `var.target` ∈ `aws | gcp | cloudflare`) and select the RunnerProfile that supplies the provider allowlist, credentials, and state backend.
2. Takosumi runs `plan` and records a **PlanRun**; review the resulting plan and policy decision before approval.
3. Apply the reviewed plan; Takosumi records an **ApplyRun** and, on success, updates the **Deployment** and its **DeploymentOutput** (the non-secret service URLs / binding map).
4. `destroy` is also recorded as an **ApplyRun** against the same Installation, keeping the run ledger append-only.
5. Infrastructure credentials, provider allowlist, state backend, and Cloudflare Container execution belong to the RunnerProfile; account-plane policy, OIDC clients, billing, and domains belong to the operator distribution (Takosumi Accounts).

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput run ledger. The operator-owned RunnerProfile supplies the provider allowlist, credentials, state backend, and execution substrate. Account-plane policy (account / billing / OIDC / dashboard) belongs to the operator distribution.

The hand-maintained `wrangler` / Helm / distribute pipeline (`takos-private/cloudflare/wrangler.*.toml`) is the interim materialization of the same OpenTofu topology — not a separate source of truth.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Internal trust boundaries](/architecture/internal-trust-boundaries)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
