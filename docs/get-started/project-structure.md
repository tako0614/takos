# プロジェクト構成

This page describes how Takos relates to Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repo and records an **Installation**, then a **PlanRun**, an **ApplyRun**, a **Deployment**, and **DeploymentOutput**. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Create an Installation from a Git URL/ref (and module path) pointing at a plain OpenTofu module.
2. Run plan to produce a `PlanRun` and review its proposed changes, warnings, and policy decision.
3. Apply the reviewed plan to produce an `ApplyRun`. A successful apply updates the `Deployment` and its `DeploymentOutput`.
4. Provider allowlist, credentials, state backend, execution image/resource limits, and Cloudflare Container execution are owned by a `RunnerProfile`; Takosumi records the run ledger and policy decisions for each plan/apply/destroy.
5. Account-plane concerns — accounts, billing, OIDC clients, dashboard, and the deploy facade — belong to the operator distribution (Takosumi Accounts).

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos itself is deployed by Takosumi as an installed and applied OpenTofu module (`deploy/opentofu`, with `var.target` ∈ `aws` | `gcp` | `cloudflare`; the `cloudflare` target provisions D1/KV/R2/Queues backing resources). Takosumi records the Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput ledger. Takosumi Accounts or another operator distribution owns account-plane policy.

## API Shape

An Installation references the OpenTofu module to deploy:

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main",
    "path": "deploy/opentofu"
  }
}
```

Plan and apply requests reference the Installation and the reviewed `PlanRun`. Takos product routes should call the Takosumi deploy control API or the Takosumi Accounts deploy facade instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
