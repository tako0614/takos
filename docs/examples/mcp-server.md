# MCP Server

This page has been reset for Takosumi v1. Takosumi installs a plain OpenTofu module repository and records an **Installation**, then a **PlanRun**, an **ApplyRun**, and the resulting **Deployment** with its **DeploymentOutput**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref pointing at the OpenTofu module repository.
2. Create an **Installation**, then start a **PlanRun** and review its diff, warnings, and policy decision.
3. Promote the reviewed plan to an **ApplyRun**; a successful apply updates the **Deployment** and its **DeploymentOutput**.
4. A **RunnerProfile** owns the provider allowlist, credential references, state backend, and Cloudflare Container execution for each run.
5. Account-plane policy, credentials, OIDC clients, billing, domains, and dashboard surface belong to the operator distribution (Takosumi Accounts).

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos itself is deployed by Takosumi as an installed and applied OpenTofu module (`deploy/opentofu`, with `var.target` in `aws | gcp | cloudflare`). Takosumi records the Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput run ledger. Takosumi or another operator distribution owns account / billing / OIDC / dashboard.

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

A PlanRun is reviewed before it is promoted to an ApplyRun. Takos product routes should call the Takosumi deploy control plane or Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
