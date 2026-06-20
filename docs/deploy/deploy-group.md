# Deployment History

Takosumi v1 uses OpenTofu Capsules. Takosumi installs an OpenTofu Capsule and records an **Installation**, typed **Run** entries for `plan` / `apply` / `destroy_plan` / `destroy_apply`, and a successful apply updates the **Deployment** and its **OutputSnapshot**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Create an Installation from a Git URL/ref pointing at a OpenTofu Capsule.
2. Run `plan` to produce a **`plan` type Run** and review its proposed changes, warnings, and policy decision.
3. Apply the reviewed plan to produce an **`apply` type Run**; a successful apply updates the **Deployment** and records its **OutputSnapshot**.
4. Destroy is recorded as a two-phase **`destroy_plan` -> approval -> `destroy_apply`** flow against the same Installation, keeping the run ledger append-only.
5. Connections hold credential references, Installation provider connections resolve each provider (+ optional alias) to an explicit provider connection, and policy resolves provider allowlists, state backend, execution image / resource limits, and Cloudflare Container execution; account-plane concerns (credentials issuance, OIDC clients, billing, domains, dashboard) belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions D1/KV/R2/Queues backing resources, while embedded Takosumi services record Installation / Run / StateSnapshot / OutputSnapshot / Deployment state, policy decisions, and audit trail.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "path": "deploy/opentofu"
  }
}
```

An apply targets a reviewed `plan` type Run and records an `apply` type Run against the Installation. Takos product routes should call the Takosumi deploy control plane or the operator account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
