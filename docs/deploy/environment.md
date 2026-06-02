# 環境変数

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module and records an **Installation**, then a **PlanRun**, an **ApplyRun**, and a resulting **Deployment** plus **DeploymentOutput**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Create an Installation from a Git URL/ref pointing at a plain OpenTofu module.
2. Start a PlanRun and review the recorded plan, changes, warnings, and policy decision.
3. Approve the reviewed plan to start an ApplyRun. A successful apply updates the Deployment and its DeploymentOutput.
4. A RunnerProfile owns the provider allowlist, credential references, state backend, and Cloudflare Container execution for each run.
5. Infrastructure lifecycle, credentials, OIDC clients, billing, domains, and account-plane policy belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos itself is deployed by Takosumi as an installed and applied OpenTofu module (`deploy/opentofu`, with `var.target` ∈ `aws` / `gcp` / `cloudflare`; the `cloudflare` target provisions the D1/KV/R2/Queues backing resources). Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state. Takosumi or another operator distribution owns account-plane policy and RunnerProfile configuration.

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

An Installation starts a PlanRun; approving the recorded plan starts an ApplyRun that updates the Deployment and DeploymentOutput. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
