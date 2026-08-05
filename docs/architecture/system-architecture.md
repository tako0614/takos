# システムアーキテクチャ

**Premise: Takos is a provider-neutral OpenTofu-native AI workspace distribution.** `deploy/product-resources.json` owns the required resource and runtime-connection graph. `deploy/opentofu/takoform` and `deploy/opentofu/cloudflare` are sibling adapters. Takosumi installs the selected **OpenTofu Capsule** and records **Capsule -> Run -> StateVersion -> Output**. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to an explicit ProviderConnection, and policy resolves provider allowlists and state handling. Install metadata comes from the repository Git identity and its `/.well-known/takosumi.json`.

## Current Flow

1. Takos declares its logical topology in `deploy/product-resources.json`; the selected `deploy/opentofu/takoform` or `deploy/opentofu/cloudflare` adapter maps it to concrete resources.
2. Takosumi creates a **Capsule** from that module (Git URL/ref + module path) under a **ProviderConnection / ProviderBinding / policy**.
3. A **`plan` type Run** computes the OpenTofu plan; a reviewer approves it.
4. The reviewed plan is applied as an **`apply` type Run**; a successful apply records **StateVersion** and **Output** (including the non-secret service URLs / binding map).
5. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to an explicit provider connection (an explicit ProviderConnection), and policy resolves provider allowlists, state backend, and workload placement. Account-plane policy — billing, OIDC clients, domains, and dashboard — belongs to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takosumi records the run ledger (Capsule / Run / StateVersion / Output) and the policy decisions that authorize each run. The Takosumi Accounts plane owns account-plane policy: billing, OIDC, domains, and dashboard.

Takos is not a special Takosumi shape. Its Takoform adapter composes portable
forms: `EdgeWorker` for `takos-worker`, `RelationalDatabase` for workspace/control data, `KeyValueStore` for session/cache/state
bindings, `ObjectBucket` for files, workspace objects, and worker-native Git
object storage, `Queue` for agent jobs and product events, and `ContainerService`
for `takos-agent`.
The module does not create a generic tool/runtime container. Computer access,
browser automation, and Git Actions are separate capabilities installed or
connected through the same ordinary Capsule and Interface contracts.
Do not introduce a `takosumi_takos` catch-all resource; add a new generic
service form only when Takos and third-party apps both need semantics that the
existing shapes cannot express.

## Materialization

The Cloudflare `wrangler.toml` is an artifact/runtime configuration inside the direct Cloudflare adapter. It is not the resource authority and does not constrain the Takoform adapter's host implementation.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Internal trust boundaries](./internal-trust-boundaries)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
