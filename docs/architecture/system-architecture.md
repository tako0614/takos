# システムアーキテクチャ

**Premise: Takos is the OpenTofu-native AI workspace distribution managed by embedded Takosumi services.** Takosumi is the OpenTofu-native deploy control plane: it installs an **OpenTofu Capsule** and records the run ledger **Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment**. Connections hold credential references, Installation provider connections resolve each provider (+ optional alias) to an explicit provider connection (`own_key` or `takos_provided`), and policy resolves provider allowlists, state backend, and Cloudflare Container execution. install metadata is read from generic repository information (Git URL, ref, commit, tag) and well-known OpenTofu outputs.

## Current Flow

1. Takos's deploy topology — the worker, its Durable Objects, the egress proxy, container callback endpoints, container execution, bindings, and routes — is an OpenTofu module in `deploy/opentofu` (`var.target = cloudflare`; the `cloudflare` target provisions the D1 / KV / R2 / Queues backing resources).
2. Takosumi creates an **Installation** from that module (Git URL/ref + module path) under a **Connection / Installation provider connection / policy**.
3. A **`plan` type Run** computes the OpenTofu plan; a reviewer approves it.
4. The reviewed plan is applied as an **`apply` type Run**; a successful apply records **StateSnapshot**, **OutputSnapshot**, and **Deployment** (including the non-secret service URLs / binding map).
5. Connections hold credential references, Installation provider connections resolve each provider (+ optional alias) to an explicit provider connection (`own_key` or `takos_provided`), and policy resolves provider allowlists, state backend, and Cloudflare Container execution. Account-plane policy — billing, OIDC clients, domains, and dashboard — belongs to the embedded Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takosumi records the run ledger (Installation / Run / Deployment / OutputSnapshot) and the policy decisions that authorize each run. The embedded Takosumi Accounts plane owns account-plane policy: billing, OIDC, domains, and dashboard.

## Materialization

The hand-maintained `takosumi-private/platform/wrangler.toml` plus operator-local secrets outside the repo is the **interim reference materialization** of the same topology described by the OpenTofu module. It converges onto the Takosumi-applied module and is **not** a separate source of truth; the trust-boundary and deploy invariants are properties of the Takosumi-applied module, validated by the reviewed plan.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Internal trust boundaries](./internal-trust-boundaries)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
