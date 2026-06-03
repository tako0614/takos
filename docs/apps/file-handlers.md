# File Handlers

This page has been reset for Takosumi v1. Takosumi installs a plain OpenTofu module and records an **Installation** plus the **Installation → PlanRun → ApplyRun → Deployment → DeploymentOutput** run ledger. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Install the Takos OpenTofu module (`deploy/opentofu`) to create an **Installation**, choosing `var.target` (`aws | gcp | cloudflare`).
2. Run a **PlanRun** and review the recorded plan, diff, and warnings.
3. Apply the reviewed plan as an **ApplyRun**. A successful apply updates the **Deployment** and **DeploymentOutput**.
4. Provider allowlist, credential reference, state backend, execution image / resource limits, and Cloudflare Container execution are owned by the **RunnerProfile**; Takosumi records the RunnerProfile policy decision and each run in the audit ledger.
5. Account-plane policy (OIDC clients, billing, domains, dashboard) belongs to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the run ledger (Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput) for the applied OpenTofu module, while the RunnerProfile owns the provider allowlist, credentials, and state backend. The operator distribution / Takosumi Accounts owns account-plane policy (OIDC / billing / dashboard).

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "source": "github.com/example/takos//deploy/opentofu",
    "ref": "main"
  },
  "vars": {
    "target": "cloudflare"
  }
}
```

Selecting a target runs a PlanRun and then an ApplyRun, which updates the Deployment and records non-sensitive endpoints as DeploymentOutput. Takos product routes should rely on the Takosumi deploy control plane run ledger instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
