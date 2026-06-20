# サンプル集

Takosumi v1 uses OpenTofu Capsules. Takosumi is an OpenTofu-native deploy control plane: it installs an OpenTofu Capsule repo as an **Installation** and records typed Runs for `plan`, `apply`, `destroy_plan`, and `destroy_apply`, with a successful apply updating the **Deployment** and its **OutputSnapshot**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Choose a Git URL/ref for a OpenTofu Capsule repo (Takos itself is the module under `deploy/opentofu`, with `var.target = cloudflare`).
2. Create the Installation with target Connection / Installation provider connection settings.
3. Run a plan; Takosumi records it as a **`plan` type Run** and surfaces the proposed changes for review.
4. Apply the reviewed plan; Takosumi records an **`apply` type Run**, and a successful apply updates the **Deployment** and **OutputSnapshot**. Destroy uses `destroy_plan` followed by approved `destroy_apply`.
5. Connections hold credential references, Installation provider connections resolve each provider (plus optional alias) to `own_key` or `takos_provided` provider connection, and policy resolves provider allowlists, state backend, execution image/resource limits, and Cloudflare Container execution. Account-plane policy, OIDC clients, billing, and domains belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state and policy decisions for each run. The embedded Takosumi Accounts plane owns account-plane policy such as accounts, billing, OIDC, and the dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main",
    "path": "."
  }
}
```

Plan, apply, and destroy Runs are submitted against the Installation as typed Runs, and a successful apply updates the Deployment and OutputSnapshot. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
