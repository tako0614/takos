# takos-docs

Takosumi v1 uses OpenTofu Capsules. Takosumi is an OpenTofu-native deploy control plane: it installs an OpenTofu Capsule and records an **Installation**, then a **`plan` type Run**, an **`apply` type Run**, and on success an updated **Deployment** with its **OutputSnapshot**. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref for the OpenTofu Capsule repository to install.
2. Run `plan`. Takosumi records a `plan` type Run capturing the proposed changes against the resolved Git commit.
3. Run `apply` against the reviewed `plan` type Run. Takosumi records an `apply` type Run and, on success, records `StateSnapshot`, `OutputSnapshot`, and `Deployment`.
4. Run `destroy` when tearing down; Takosumi records `destroy_plan` and `destroy_apply` type Runs over the same `Installation`.
5. Connections hold credential references, Installation provider connections resolve each provider (plus optional alias) to an explicit provider connection (`own_key` or `takos_provided`), and policy resolves provider allowlists, state backend, execution image/resource limits, and Cloudflare Container execution. Account-plane policy (credentials issuance, OIDC clients, billing, domains, dashboard) belongs to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions D1/KV/R2/Queues backing resources, while embedded Takosumi services record Installation / Run / StateSnapshot / OutputSnapshot / Deployment state, policy decisions, and audit trail.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

An Installation pins the resolved Git commit; subsequent `plan` type Run and `apply` type Run records reference that Installation. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
