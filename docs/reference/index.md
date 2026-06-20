# リファレンス

Takos is the OpenTofu-native AI workspace distribution managed by embedded Takosumi services. Takosumi records the Takos distribution and app lifecycle as Installation / Run / Deployment / OutputSnapshot. Takos's deploy topology — the worker, its Durable Objects, the egress proxy, container callback endpoints, bindings, and routes — is an OpenTofu module that Takosumi installs and applies, recording the run ledger **Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment**. Connections hold credential references, Installation provider connections bind each provider (and optional alias) to an explicit provider connection (`own_key` or `takos_provided`), and policy resolves provider allowlists, state backend, and Cloudflare Container execution.

## Current Flow

1. Point an Installation at the Takos OpenTofu module (`deploy/opentofu`, `var.target = cloudflare`) and select the Connection / Installation provider connection / policy that supplies the provider allowlist, credentials, and state backend.
2. Takosumi runs `plan` and records a **`plan` type Run**; review the resulting plan and policy decision before approval.
3. Apply the reviewed plan; Takosumi records an **`apply` type Run** and, on success, updates the **Deployment** and its **OutputSnapshot** (the non-secret service URLs / binding map).
4. Destroy is recorded as a two-phase **`destroy_plan` -> approval -> `destroy_apply`** flow against the same Installation, keeping the run ledger append-only.
5. Connections hold credential references, Installation provider connections resolve each provider (and optional alias), and policy resolves provider allowlists, state backend, and Cloudflare Container execution; account-plane policy, OIDC clients, billing, and domains belong to the embedded Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takosumi records the Installation / Run / Deployment / OutputSnapshot run ledger. Operator-owned Connections hold credential references, Installation provider connections resolve each provider (and optional alias), and policy supplies provider allowlists, state backend, and execution substrate. Account-plane policy (account / billing / OIDC / dashboard) belongs to the Takosumi Accounts plane.

The hand-maintained `wrangler` / distribute pipeline (`takosumi-private/platform/wrangler.toml` plus operator-local secrets outside the repo) is the interim materialization of the same OpenTofu topology — not a separate source of truth.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Internal trust boundaries](/architecture/internal-trust-boundaries)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
