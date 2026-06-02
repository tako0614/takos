# MCP Server

This page has been reset for Takosumi v1. Takosumi installs a plain OpenTofu module repo and records an **Installation**, then a **PlanRun** and **ApplyRun** per run, with a successful apply updating the **Deployment** and its **DeploymentOutput**. Repo metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Choose a Git URL/ref pointing at a plain OpenTofu module repo.
2. Create a **PlanRun** and review its diff, warnings, and policy decision.
3. Promote the reviewed plan to an **ApplyRun**.
4. A successful apply updates the **Deployment** and records its **DeploymentOutput** in the audit ledger.
5. Provider allowlist, credentials, state backend, execution image / resource limits, and Cloudflare Container execution are owned by the **RunnerProfile**; account-plane policy, OIDC clients, billing, and domains belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state and run-ledger evidence. The operator distribution owns account-plane policy, OIDC clients, billing, and dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "repo": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

An ApplyRun promotes a reviewed PlanRun. Takos product routes should call the Takosumi deploy control plane or the operator distribution account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
