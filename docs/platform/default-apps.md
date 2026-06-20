# バンドルアプリ

Takosumi v1 uses OpenTofu Capsules. Takosumi is an OpenTofu-native deploy control plane that installs an OpenTofu Capsule and records an **Installation**, typed **Run** entries, **StateSnapshot**, **OutputSnapshot**, and **Deployment** ledger. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Create an Installation from a Git URL/ref pointing at a OpenTofu Capsule.
2. Trigger a **`plan` type Run** and review the recorded plan, changes, and warnings before approval.
3. Apply the reviewed plan as an **`apply` type Run**. A successful apply updates the **Deployment** and its **OutputSnapshot**.
4. Connections hold credential references, Installation provider connections resolve each provider (plus optional alias) to an explicit provider connection (`own_key` or `takos_provided`), and policy resolves provider allowlists, state backend, and Cloudflare Container execution used by each run.
5. Infrastructure lifecycle credentials, OIDC clients, billing, domains, and account-plane policy belong to the embedded Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takosumi records the Installation, `plan` type Run, `apply` type Run, Deployment, and OutputSnapshot run ledger. Takosumi Accounts plane owns account-plane policy such as accounts, billing, OIDC, and dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "source": {
    "kind": "git",
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

An Installation references the OpenTofu Capsule repo; a `plan` type Run then records the plan an `apply` type Run applies. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
