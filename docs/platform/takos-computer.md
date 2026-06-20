# takos-computer

Takosumi v1 uses OpenTofu Capsules. Takosumi is an OpenTofu-native deploy control plane: it installs an OpenTofu Capsule and records an **Installation**, a **`plan` type Run** for each plan, an **`apply` type Run** for each apply, and two-phase **`destroy_plan` / `destroy_apply`** Runs for teardown. A successful apply records the resulting **Deployment** plus **OutputSnapshot**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Choose a Git URL/ref pointing at a OpenTofu Capsule.
2. Run a plan; Takosumi records a `plan` type Run with the reviewed plan, changes, and warnings.
3. Apply the reviewed plan; Takosumi records an `apply` type Run and, on success, updates the `Deployment` and its `OutputSnapshot`.
4. Destroy is recorded as `destroy_plan` followed by approved `destroy_apply` so teardown stays reviewable and tied to the current `Deployment`.
5. Connections hold credential references, Installation provider connections resolve each provider (plus optional alias) to an explicit provider connection (`own_key` or `takos_provided`), and policy resolves provider allowlists, state backend, execution image, and Cloudflare Container execution; account-plane policy, OIDC clients, billing, and domains belong to the Takosumi Accounts plane.

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

An apply request references the reviewed `plan` type Run, and Takosumi records the resulting `apply` type Run, `Deployment`, and `OutputSnapshot`. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi deploy model](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
