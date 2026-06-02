# Store

This page has been reset for Takosumi v1. Takosumi installs a plain OpenTofu module and records an **Installation**, then a run ledger of **PlanRun** → **ApplyRun** entries whose successful apply updates the **Deployment** and its **DeploymentOutput**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref that points at a plain OpenTofu module.
2. Create the Installation, then request a `PlanRun` and review its planned changes and policy decision.
3. Promote the reviewed plan to an `ApplyRun`. A successful apply updates the `Deployment` and records its `DeploymentOutput`.
4. The `RunnerProfile` owns the provider allowlist, credential references, state backend, and Cloudflare Container execution that each run uses.
5. Account-plane policy, OIDC clients, billing, domains, and dashboard surfaces belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state and the runs' policy decisions. Takosumi or another operator distribution owns account-plane policy, billing, and OIDC.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

The Installation references a plain OpenTofu module by Git URL/ref; runs against it are recorded as `PlanRun` and `ApplyRun` entries. Takos product routes should call the Takosumi deploy control API or the operator distribution account-plane flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
