# Worker + DB

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repo as an **Installation** and records each run as a **PlanRun** then an **ApplyRun**, with a successful apply updating the **Deployment** and its **DeploymentOutput**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path. A Worker-plus-DB topology is provisioned by the OpenTofu module itself; on Cloudflare it backs the Worker with D1/KV/R2/Queues resources.

## Current Flow

1. Point an Installation at a Git URL/ref for the OpenTofu module repo.
2. Run a plan and review the resulting PlanRun, its proposed changes, and warnings.
3. Apply the reviewed plan; the apply is recorded as an ApplyRun against that PlanRun.
4. A successful ApplyRun updates the Deployment and writes a new DeploymentOutput, which surfaces the database connection details produced by the module; destroy runs are recorded as ApplyRuns too.
5. Provider allowlist, credentials, state backend, and Cloudflare Container execution are owned by the RunnerProfile, while OIDC clients, billing, domains, and the dashboard belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state and RunnerProfile policy decisions. Takosumi or another operator distribution owns account-plane policy such as accounts, billing, OIDC, and the dashboard.

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

A plan request creates a PlanRun; the apply request references that PlanRun so only a reviewed plan is applied. Takos product routes should call the Takosumi deploy control plane or the operator distribution account-plane flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
