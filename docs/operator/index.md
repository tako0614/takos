# オペレーター向けガイド

Takosumi v1 uses OpenTofu Capsules. Takosumi is the OpenTofu-native deploy control plane: it installs an OpenTofu Capsule repo as an **Installation** and records typed Runs for `plan`, `apply`, `destroy_plan`, and `destroy_apply`, plus **Deployment** and **OutputSnapshot** entries. Installation display metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref pointing at a OpenTofu Capsule repo, and a Connection / Installation provider connection / policy.
2. Run a plan; Takosumi records a `plan` type Run with the reviewed plan, changes, warnings, and policy decision.
3. Apply the reviewed plan; Takosumi records an `apply` type Run, and a successful apply updates the `Deployment` and `OutputSnapshot`.
4. Destroy is recorded as `destroy_plan` followed by approved `destroy_apply` against the same Installation, keeping the run ledger append-only.
5. Connections hold credential references, Installation provider connections bind each provider (plus optional alias) used by the module to an explicit provider connection (`own_key` or `takos_provided`), and policy resolves provider allowlists, state backend, execution image/resource limits, and Cloudflare Container execution. Account-plane policy, OIDC clients, billing, domains, and implementation bindings belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions D1/KV/R2/Queues backing resources, while embedded Takosumi services record Installation / Run / StateSnapshot / OutputSnapshot / Deployment state, policy decisions, and audit trail.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

A plan produces a `plan` type Run; applying the reviewed plan produces an `apply` type Run that updates the `Deployment` and `OutputSnapshot`. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
