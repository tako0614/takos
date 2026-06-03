# takos-docs

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module and records an **Installation**, then a **PlanRun**, an **ApplyRun**, and on success an updated **Deployment** with its **DeploymentOutput**. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref for the OpenTofu module repository to install.
2. Run `plan`. Takosumi records a `PlanRun` capturing the proposed changes against the resolved Git commit.
3. Run `apply` against the reviewed `PlanRun`. Takosumi records an `ApplyRun` and, on success, updates the `Deployment` and `DeploymentOutput`.
4. Run `destroy` when tearing down; it is recorded as an `ApplyRun` over the same `Installation`.
5. Provider allowlist, credentials, state backend, execution image/resource limits, and Cloudflare Container execution are owned by the `RunnerProfile`. Account-plane policy (credentials issuance, OIDC clients, billing, domains, dashboard) belongs to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos itself is deployed by Takosumi as an installed and applied OpenTofu module (`deploy/opentofu`, where `var.target` is one of `aws`, `gcp`, or `cloudflare`; the Cloudflare target provisions the D1/KV/R2/Queues backing resources). Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput and the RunnerProfile policy decisions. Takosumi or another operator distribution owns account-plane policy (account, billing, OIDC, dashboard).

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

An Installation pins the resolved Git commit; subsequent `PlanRun` and `ApplyRun` records reference that Installation. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
