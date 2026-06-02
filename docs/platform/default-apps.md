# バンドルアプリ

This page describes Takosumi v1. Takosumi is an OpenTofu-native deploy control plane that installs a plain OpenTofu module and records an **Installation**, then a **PlanRun** → **ApplyRun** → **Deployment** → **DeploymentOutput** run ledger. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Create an Installation from a Git URL/ref pointing at a plain OpenTofu module.
2. Trigger a **PlanRun** and review the recorded plan, changes, and warnings before approval.
3. Apply the reviewed plan as an **ApplyRun**. A successful apply updates the **Deployment** and its **DeploymentOutput**.
4. A **RunnerProfile** owns the provider allowlist, credential references, state backend, and Cloudflare Container execution used by each run.
5. Infrastructure lifecycle credentials, OIDC clients, billing, domains, and account-plane policy belong to the operator distribution (Takosumi Accounts).

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the Installation, PlanRun, ApplyRun, Deployment, and DeploymentOutput run ledger. Takosumi or another operator distribution owns account-plane policy such as accounts, billing, OIDC, and dashboard.

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

An Installation references the OpenTofu module repo; a PlanRun then records the plan an ApplyRun applies. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
