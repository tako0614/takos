# サンプル集

Takosumi v1 uses OpenTofu Capsules. Takosumi is an OpenTofu-native deploy control plane: it registers a Git Source, creates a Capsule, records typed Runs for plan/apply/destroy, and stores StateVersion / Output evidence after a successful apply. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref for an OpenTofu Capsule repo (Takos itself is the module under `deploy/opentofu`, with the current Cloudflare target).
2. Create the Capsule with target ProviderConnection / ProviderBinding settings.
3. Run a plan; Takosumi records it as a **`plan` type Run** and surfaces the proposed changes for review.
4. Apply the reviewed plan; Takosumi records an **`apply` type Run**, and a successful apply updates StateVersion and Output. Destroy uses a reviewed destroy plan followed by destroy apply.
5. ProviderConnections hold credential references, ProviderBindings resolve each provider (plus optional alias) to an explicit connection, and policy resolves provider allowlists, state backend, execution image/resource limits, and Cloudflare Container execution. Account-plane policy, OIDC clients, billing, and domains belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are projected from Capsule outputs and Takos runtime contracts. Takosumi records Capsule / Run / StateVersion / Output state and policy decisions for each run. The embedded Takosumi Accounts plane owns account-plane policy such as accounts, billing, OIDC, and the dashboard.

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

Plan, apply, and destroy Runs are submitted against the Capsule as typed Runs, and a successful apply updates StateVersion and Output. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane Capsule install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
