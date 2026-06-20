# Takos の概念

Takos is the OpenTofu-native AI Workspace distribution managed by embedded Takosumi services. Takos Workspaces project chat, agents, memory, Git, and
bundled apps over a Takosumi Space, which is the owner namespace for OpenTofu Capsule Installations.

## Current Flow

1. Deploy the Takos distribution topology with `deploy/opentofu` and the worker artifact.
2. The worker composes Takos product routes with Takosumi Accounts, deploy-control, dashboard, and the OpenTofu runner in one origin.
3. Create a Takos Workspace; bundled apps are seeded as normal Takosumi Installations through plan/apply Runs.
4. Infrastructure lifecycle credentials, OIDC clients, billing, domains, and account-plane policy belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takosumi owns Space / Source / Connection / Installation / Run /
StateSnapshot / Deployment / OutputSnapshot authority. The Takosumi Accounts plane owns account-plane policy,
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

An Installation created this way is materialized through typed Runs. Takos product routes call the Takosumi deploy
control plane or the Takosumi account-plane install flow instead of exposing a separate deployment authority.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
