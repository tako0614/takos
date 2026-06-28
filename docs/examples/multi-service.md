# Multi-Service 構成

Takosumi v1 uses OpenTofu Capsules. Takosumi registers a Git Source, creates a Capsule, records typed Run entries, and stores StateVersion / Output evidence after a successful apply. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Create a Capsule from a Git URL/ref pointing at an OpenTofu module.
2. Trigger a plan; Takosumi records a plan Run against the reviewed module and ProviderConnection / ProviderBinding / policy.
3. Apply the reviewed plan; Takosumi records an apply Run and, on success, updates StateVersion and Output.
4. ProviderConnections hold credential references, ProviderBindings resolve each provider (plus optional alias) the module uses, and policy resolves provider allowlists, state backend, and Cloudflare Container execution for each run.
5. Account-plane policy, credentials, OIDC clients, billing, and domains belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are projected from Capsule outputs and Takos runtime contracts. Takosumi records Capsule / Run / StateVersion / Output state and policy decisions. Takosumi Accounts plane owns account-plane policy, billing, OIDC, and the dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main",
    "modulePath": "deploy/opentofu"
  }
}
```

Creating the Installation records the module reference; subsequent typed Runs record `plan` type Run / `apply` type Run entries against the bound Connection / Installation provider connection / policy. Takos product routes should call the Takosumi deploy control plane or Takosumi account-plane flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
