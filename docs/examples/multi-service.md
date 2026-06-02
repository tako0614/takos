# Multi-Service 構成

This page has been reset for Takosumi v1. Takosumi installs a plain OpenTofu module and records an **Installation**, then a **PlanRun** and **ApplyRun** per run, with a successful apply updating the **Deployment** and its **DeploymentOutput**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Create an Installation from a Git URL/ref pointing at a plain OpenTofu module.
2. Trigger a plan; Takosumi records a `PlanRun` against the reviewed module and runner profile.
3. Apply the reviewed plan; Takosumi records an `ApplyRun` and, on success, updates the `Deployment` and `DeploymentOutput`.
4. A `RunnerProfile` owns the provider allowlist, credentials, state backend, and Cloudflare Container execution for each run.
5. Account-plane policy, credentials, OIDC clients, billing, and domains belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state and runner profile policy decisions. An operator distribution owns account-plane policy, billing, OIDC, and the dashboard.

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

Creating the Installation records the module reference; subsequent plan and apply runs record `PlanRun` / `ApplyRun` entries against the bound runner profile. Takos product routes should call the Takosumi deploy control plane or Takosumi account-plane flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
