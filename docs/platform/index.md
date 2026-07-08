# Takos の概念

Takos is the OpenTofu-native AI Workspace distribution managed by external Takosumi control plane. Takos Workspaces provide
the user-facing chat, agents, memory, Git, files, and app launcher experience. Takosumi owns the OpenTofu
Source / Project / Capsule / Run / StateVersion / Output authority behind that Workspace.

## Current Flow

1. Deploy the Takos distribution topology with `deploy/opentofu` and the worker artifact.
2. The worker exposes Takos product routes and consumes external Takosumi Accounts / deploy-control / dashboard / OpenTofu runner services.
3. Create a Takos Workspace; users explicitly add Capsule apps through plan/apply Runs.
4. Infrastructure lifecycle credentials, OIDC clients, billing, domains, and account-plane policy belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takosumi owns Workspace / Project / Capsule / Source / ProviderConnection / ProviderBinding / Run / StateVersion / Output authority. The Takosumi Accounts plane owns account-plane policy,
billing, and OIDC.

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

A Capsule created this way is materialized through typed Runs. Takos product routes call the Takosumi deploy
control plane or the Takosumi account-plane install flow instead of exposing a separate deployment authority.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
