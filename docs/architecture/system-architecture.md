# システムアーキテクチャ

**Premise: Takos is the OpenTofu-native AI workspace distribution managed by external Takosumi control plane.** Takosumi is the OpenTofu-native deploy control plane: it installs an **OpenTofu Capsule** and records the run ledger **Capsule -> Run -> StateVersion -> Output**. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to an explicit provider connection (an explicit ProviderConnection), and policy resolves provider allowlists, state backend, and Cloudflare Container execution. install metadata is read from generic repository information (Git URL, ref, commit, tag) and well-known OpenTofu outputs.

## Current Flow

1. Takos's deploy topology — the worker, its Durable Objects, the egress proxy, container callback endpoints, container execution, bindings, and routes — is an OpenTofu module in `deploy/opentofu` (`var.target = cloudflare`; the `cloudflare` target provisions the D1 / KV / R2 / Queues backing resources).
2. Takosumi creates a **Capsule** from that module (Git URL/ref + module path) under a **ProviderConnection / ProviderBinding / policy**.
3. A **`plan` type Run** computes the OpenTofu plan; a reviewer approves it.
4. The reviewed plan is applied as an **`apply` type Run**; a successful apply records **StateVersion** and **Output** (including the non-secret service URLs / binding map).
5. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to an explicit provider connection (an explicit ProviderConnection), and policy resolves provider allowlists, state backend, and Cloudflare Container execution. Account-plane policy — billing, OIDC clients, domains, and dashboard — belongs to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takosumi records the run ledger (Capsule / Run / StateVersion / Output) and the policy decisions that authorize each run. The Takosumi Accounts plane owns account-plane policy: billing, OIDC, domains, and dashboard.

Takos is also a useful Resource Shape example, but it is not a special Takosumi
shape. When Takos is described through the Takosumi Resource Shape flow, it is a
composition of provider-neutral service forms: `EdgeWorker` for `takos-worker`,
`SQLDatabase` for workspace/control data, `KVStore` for session/cache/state
bindings, `ObjectBucket` for files, workspace objects, and worker-native Git
object storage, `Queue` for agent jobs and product events, and `ContainerService`
for `takos-agent`.
Do not introduce a `takosumi_takos` catch-all resource; add a new generic
service form only when Takos and third-party apps both need semantics that the
existing shapes cannot express.

## Materialization

The hand-maintained `takosumi-private/platform/wrangler.toml` plus operator-local secrets outside the repo is the **interim reference materialization** of the same topology described by the OpenTofu module. It converges onto the Takosumi-applied module and is **not** a separate source of truth; the trust-boundary and deploy invariants are properties of the Takosumi-applied module, validated by the reviewed plan.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Internal trust boundaries](./internal-trust-boundaries)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
