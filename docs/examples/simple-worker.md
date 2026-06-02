# Simple Worker

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repo as an **Installation** and records each run as a **PlanRun** then an **ApplyRun**, with a successful apply updating the **Deployment** and its **DeploymentOutput**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Point an Installation at a Git URL/ref for the OpenTofu module repo.
2. Run a plan and review the resulting PlanRun, its proposed changes, and warnings.
3. Apply the reviewed plan; the apply is recorded as an ApplyRun against that PlanRun.
4. A successful ApplyRun updates the Deployment and writes a new DeploymentOutput; destroy runs are recorded as ApplyRuns too.
5. Provider allowlist, credentials, state backend, and Cloudflare Container execution are owned by the RunnerProfile, while OIDC clients, billing, domains, and the dashboard belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos itself is deployed by Takosumi as an installed-and-applied OpenTofu module (`deploy/opentofu`, with `var.target` ∈ `aws | gcp | cloudflare`; the `cloudflare` target provisions the backing D1/KV/R2/Queues resources). Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state and run evidence. The RunnerProfile owns provider allowlist, credentials, and state backend, and the operator distribution owns account-plane policy.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "path": "."
  }
}
```

This creates an Installation that points at the OpenTofu module repo; subsequent plan and apply runs are recorded as PlanRun and ApplyRun entries. Takos product routes should call the Takosumi deploy control API or Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/installer-api)
