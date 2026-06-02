# システムアーキテクチャ

**Premise: Takos is a product that runs on Takosumi.** Takosumi is the OpenTofu-native deploy control plane: it installs a plain **OpenTofu module** and records the run ledger **Installation → PlanRun → ApplyRun → Deployment → DeploymentOutput**. A **RunnerProfile** owns the provider allowlist, credentials, state backend, and Cloudflare Container execution. These six are Takosumi's only public concepts; install metadata is read from generic repository information (Git URL, ref, commit, tag) and well-known OpenTofu outputs.

## Current Flow

1. Takos's deploy topology — the worker, its Durable Objects, the egress / runtime-host / executor services, container execution, bindings, and routes — is an OpenTofu module in `deploy/opentofu` (`var.target` ∈ `aws | gcp | cloudflare`; the `cloudflare` target provisions the D1 / KV / R2 / Queues backing resources).
2. Takosumi creates an **Installation** from that module (Git URL/ref + module path) under a **RunnerProfile**.
3. A **PlanRun** computes the OpenTofu plan; a reviewer approves it.
4. The reviewed plan is applied as an **ApplyRun**; a successful apply updates the **Deployment** and **DeploymentOutput** (the non-secret service URLs / binding map).
5. Provider allowlist, credentials, state backend, and Cloudflare Container execution are owned by the RunnerProfile. Account-plane policy — billing, OIDC clients, domains, and dashboard — belongs to the operator distribution (Takosumi Accounts).

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the run ledger (Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput) and the RunnerProfile policy that authorizes each run. The operator distribution (Takosumi Accounts) owns account-plane policy: billing, OIDC, domains, and dashboard.

## Materialization

The hand-maintained `takos-private/cloudflare/wrangler.*.toml` (and the helm / distribute pipeline) is the **interim reference materialization** of the same topology described by the OpenTofu module. It converges onto the Takosumi-applied module and is **not** a separate source of truth; the trust-boundary and deploy invariants are properties of the Takosumi-applied module, validated by the reviewed plan.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Internal trust boundaries](./internal-trust-boundaries)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
