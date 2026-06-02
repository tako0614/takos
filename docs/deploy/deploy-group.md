# Deployment History

This page has been reset for Takosumi v1. Takosumi installs a plain OpenTofu module and records an **Installation**, then a **PlanRun** and **ApplyRun** per `plan` / `apply` / `destroy`, with a successful apply updating the **Deployment** and its **DeploymentOutput**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Create an Installation from a Git URL/ref pointing at a plain OpenTofu module.
2. Run `plan` to produce a **PlanRun** and review its proposed changes, warnings, and policy decision.
3. Apply the reviewed plan to produce an **ApplyRun**; a successful apply updates the **Deployment** and records its **DeploymentOutput**.
4. `destroy` is recorded as an **ApplyRun** against the same Installation, keeping the run ledger append-only.
5. Provider allowlist, credentials, state backend, execution image / resource limits, and Cloudflare Container execution belong to the **RunnerProfile**; account-plane concerns (credentials issuance, OIDC clients, billing, domains, dashboard) belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos itself is deployed by Takosumi as an installed and applied OpenTofu module (`deploy/opentofu`, with `var.target` in aws / gcp / cloudflare). Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state through a RunnerProfile. An operator distribution owns account-plane policy such as accounts, billing, OIDC, and the dashboard.

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

An apply targets a reviewed PlanRun and records an ApplyRun against the Installation. Takos product routes should call the Takosumi deploy control plane or the operator account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/installer-api)
