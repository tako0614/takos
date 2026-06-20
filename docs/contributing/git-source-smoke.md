# Git Source Proof

Takosumi v1 uses OpenTofu Capsules. Takosumi is an OpenTofu-native deploy control plane: it installs an OpenTofu Capsule repo as an **Installation**, then records typed Runs for `plan`, `apply`, `destroy_plan`, and `destroy_apply`. A successful apply updates the **Deployment** and its **OutputSnapshot**. Repo metadata comes from generic information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Register the Git URL/ref of the OpenTofu Capsule repo as an Installation.
2. Plan the module. Takosumi records a `plan` type Run with the proposed changes, warnings, and the resolved commit.
3. Apply the reviewed plan. Takosumi records an `apply` type Run; on success it updates the `Deployment` and `OutputSnapshot`.
4. Destroy is recorded as `destroy_plan` followed by approved `destroy_apply` against the same Installation.
5. Connections hold credential references, Installation provider connections bind each provider (and optional alias) to an explicit provider connection (`own_key` or `takos_provided`), and policy resolves provider allowlists, state backend, and Cloudflare Container execution. OIDC clients, billing, domains, and account-plane policy belong to the in-process Accounts plane in the single Takos worker.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions D1/KV/R2/Queues backing resources, while embedded Takosumi services record Installation / Run / StateSnapshot / OutputSnapshot / Deployment state, policy decisions, and audit trail.

## API Shape

```json
{
  "spaceId": "space_1",
  "repo": {
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "modulePath": "."
  }
}
```

An Installation points at a Git URL/ref and module path; plan and apply are recorded as typed Run against it. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
