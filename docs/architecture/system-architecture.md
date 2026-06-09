# システムアーキテクチャ

**Premise: Takos is self-hostable as a plain OpenTofu module; Takosumi is optional.** Takosumi is the OpenTofu-native deploy control plane: it installs a plain **OpenTofu module** and records the run ledger **Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment**. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to a default / connection / manual / disabled binding, and policy resolves provider allowlists, state backend, and Cloudflare Container execution. install metadata is read from generic repository information (Git URL, ref, commit, tag) and well-known OpenTofu outputs.

## Current Flow

1. Takos's deploy topology — the worker, its Durable Objects, the egress / runtime-host / executor services, container execution, bindings, and routes — is an OpenTofu module in `deploy/opentofu` (`var.target` ∈ `aws | gcp | cloudflare`; the `cloudflare` target provisions the D1 / KV / R2 / Queues backing resources).
2. Takosumi creates an **Installation** from that module (Git URL/ref + module path) under a **Connection / ProviderBinding / policy**.
3. A **`plan` type Run** computes the OpenTofu plan; a reviewer approves it.
4. The reviewed plan is applied as an **`apply` type Run**; a successful apply records **StateSnapshot**, **OutputSnapshot**, and **Deployment** (including the non-secret service URLs / binding map).
5. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to a default / connection / manual / disabled binding, and policy resolves provider allowlists, state backend, and Cloudflare Container execution. Account-plane policy — billing, OIDC clients, domains, and dashboard — belongs to the operator distribution (Takosumi Accounts).

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the run ledger (Installation / Run / Deployment / OutputSnapshot) and the policy decisions that authorize each run. The operator distribution (Takosumi Accounts) owns account-plane policy: billing, OIDC, domains, and dashboard.

## Materialization

The hand-maintained `takos-private/cloudflare/wrangler.*.toml` (and the helm / distribute pipeline) is the **interim reference materialization** of the same topology described by the OpenTofu module. It converges onto the Takosumi-applied module and is **not** a separate source of truth; the trust-boundary and deploy invariants are properties of the Takosumi-applied module, validated by the reviewed plan.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Internal trust boundaries](./internal-trust-boundaries)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
