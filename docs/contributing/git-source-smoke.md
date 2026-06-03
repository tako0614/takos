# Git Source Proof

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repo as an **Installation**, then records a **PlanRun** for each plan and an **ApplyRun** for each apply/destroy. A successful apply updates the **Deployment** and its **DeploymentOutput**. Repo metadata comes from generic information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Register the Git URL/ref of the OpenTofu module repo as an Installation.
2. Plan the module. Takosumi records a `PlanRun` with the proposed changes, warnings, and the resolved commit.
3. Apply the reviewed plan. Takosumi records an `ApplyRun`; on success it updates the `Deployment` and `DeploymentOutput`.
4. Destroy is also recorded as an `ApplyRun` against the same Installation.
5. The provider allowlist, credential references, state backend, and Cloudflare Container execution belong to the `RunnerProfile`. Credentials, OIDC clients, billing, domains, and account-plane policy belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos itself is deployed by Takosumi as an installed-and-applied OpenTofu module (`deploy/opentofu`, with `var.target` ∈ `aws` | `gcp` | `cloudflare`; the `cloudflare` target provisions D1/KV/R2/Queues backing resources). Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state. Takosumi or another operator distribution owns account-plane policy, billing, and OIDC.

## API Shape

```json
{
  "spaceId": "space_1",
  "repo": {
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "modulePath": "."
  }
}
```

An Installation points at a Git URL/ref and module path; plan and apply are recorded as PlanRun and ApplyRun against it. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
