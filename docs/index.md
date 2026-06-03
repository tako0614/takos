# index

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repo as an **Installation** and records a **PlanRun**, an **ApplyRun**, and the resulting **Deployment** plus **DeploymentOutput**. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path. Takos itself is deployed by Takosumi as an installed-and-applied OpenTofu module (`deploy/opentofu`, with `var.target` ∈ `aws` | `gcp` | `cloudflare`; the `cloudflare` target provisions the D1 / KV / R2 / Queues backing resources).

## Current Flow

1. Point an Installation at a plain OpenTofu module repo by Git URL/ref.
2. Run a **PlanRun** and review the recorded plan, changes, and warnings.
3. Apply the reviewed plan as an **ApplyRun**.
4. A successful ApplyRun updates the **Deployment** and its **DeploymentOutput**.
5. Provider allowlist, credentials, state backend, execution image / resource limits, and Cloudflare Container execution are owned by the **RunnerProfile**; account-plane policy, OIDC clients, billing, and domains belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state and runs against the policy of a RunnerProfile. Takosumi or another operator distribution owns account-plane policy, billing, OIDC, and the dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

An Installation references the OpenTofu module repo; a PlanRun then records the plan an ApplyRun applies. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
