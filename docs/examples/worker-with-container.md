# Worker + Container

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repository as an **Installation** and records a **PlanRun**, then an **ApplyRun**, and a successful apply updates the **Deployment** and its **DeploymentOutput**. Repository metadata comes from generic information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Create an Installation from a plain OpenTofu module repository (Git URL/ref or module path).
2. Trigger a plan; Takosumi records a `PlanRun` with the reviewed plan, warnings, and policy decision.
3. Apply the reviewed plan; Takosumi records an `ApplyRun`, and on success updates the `Deployment` and `DeploymentOutput`.
4. A `RunnerProfile` owns the provider allowlist, credential reference, state backend, and Cloudflare Container execution for each run.
5. Account-plane policy, credentials, OIDC clients, billing, and domains belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos itself is deployed by Takosumi as an installed and applied OpenTofu module (`deploy/opentofu`, `var.target ∈ aws | gcp | cloudflare`; the `cloudflare` target provisions D1/KV/R2/Queues backing resources). Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state. Takosumi or another operator distribution owns account-plane policy, billing, and OIDC.

## API Shape

```json
{
  "spaceId": "space_1",
  "installation": {
    "repository": {
      "url": "https://github.com/example/app.git",
      "ref": "main"
    }
  }
}
```

A plan produces a `PlanRun`, and the reviewed plan is applied as an `ApplyRun`. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
