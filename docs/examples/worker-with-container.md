# Worker + Container

Takosumi v1 uses OpenTofu Capsules. Takosumi is an OpenTofu-native deploy control plane: it installs an OpenTofu Capsule repository as an **Installation** and records a **`plan` type Run**, then an **`apply` type Run**, and a successful apply updates the **Deployment** and its **OutputSnapshot**. Repository metadata comes from generic information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Create an Installation from a OpenTofu Capsule repository (Git URL/ref or module path).
2. Trigger a plan; Takosumi records a `plan` type Run with the reviewed plan, warnings, and policy decision.
3. Apply the reviewed plan; Takosumi records an `apply` type Run, and on success records `StateSnapshot`, `OutputSnapshot`, and `Deployment`.
4. Connections hold credential references, Installation provider connections resolve each provider (plus optional alias) the module uses, and policy resolves provider allowlists, state backend, and Cloudflare Container execution for each run.
5. Account-plane policy, credentials, OIDC clients, billing, and domains belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions D1/KV/R2/Queues backing resources, while embedded Takosumi services record Installation / Run / StateSnapshot / OutputSnapshot / Deployment state, policy decisions, and audit trail.

## API Shape

```json
{
  "spaceId": "space_1",
  "source": {
    "kind": "git",
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "path": "."
  }
}
```

A plan produces a `plan` type Run, and the reviewed plan is applied as an `apply` type Run. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
