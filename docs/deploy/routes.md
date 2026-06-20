# ルーティング

Takos deploys from `takos/deploy/opentofu` plus one wrangler artifact upload. The resulting worker composes Takos
product routes with Takosumi Accounts, deploy-control, dashboard, and the OpenTofu runner in one origin. Takosumi
records **Run**, **StateSnapshot**, **OutputSnapshot**, and **Deployment** evidence. Repository metadata comes from
generic information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Run the Takos OpenTofu module and upload the worker artifact.
2. Use the embedded Takosumi Accounts / deploy-control surface to create Workspaces and app Installations.
3. Choose provider ownership, then run a plan. Review the resulting **`plan` type Run** changes and warnings.
4. Apply the reviewed plan. A successful **`apply` type Run** updates the **Deployment** and **OutputSnapshot**.
5. Billing, OIDC clients, domains, and dashboard belong to the Takosumi Accounts plane, not to the Takos chat product surface.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takosumi records Installation / Run / StateSnapshot / OutputSnapshot /
Deployment state and policy decisions for the Takos distribution and app Installations. The account plane owns account,
billing, OIDC, and dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "kind": "git",
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

Apply requests reference the reviewed `plan` type Run returned by the plan step. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
