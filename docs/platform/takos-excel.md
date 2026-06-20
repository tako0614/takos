# takos-excel

Takosumi v1 uses OpenTofu Capsules. Takosumi is an OpenTofu-native deploy control plane: it installs an OpenTofu Capsule repository as an **Installation** and records a run ledger of **`plan` type Run** → **`apply` type Run** → **Deployment** → **OutputSnapshot**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Choose a Git URL/ref for the OpenTofu Capsule repository.
2. Create a **`plan` type Run** and review its proposed changes, warnings, and policy decision before approving.
3. Approve the reviewed plan to start an **`apply` type Run**. A successful apply updates the **Deployment** and its **OutputSnapshot** snapshot.
4. Connections hold credential references, Installation provider connections resolve each provider (plus optional alias) to an explicit provider connection (`own_key` or `takos_provided`), and policy resolves provider allowlists, state backend, and Cloudflare Container execution that the run uses.
5. Account-plane policy, credentials, OIDC clients, billing, domains, and dashboard belong to the embedded Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state under a Connection / Installation provider connection / policy. Takosumi Accounts or Takosumi Accounts plane owns account-plane policy, billing, OIDC, and dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "git": "https://github.com/example/app.git",
    "ref": "main",
    "path": "."
  }
}
```

`apply` type Run requests reference the reviewed `plan` type Run before applying. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
