# yurucommu

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repository and records an **Installation**, then **PlanRun** and **ApplyRun** entries, and on success a **Deployment** with its **DeploymentOutput**. Repository metadata comes from generic information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Choose a Git URL/ref for the OpenTofu module repository.
2. Create a PlanRun and review its proposed changes, warnings, and run ledger entry.
3. Apply the reviewed plan as an ApplyRun, which records a Deployment and its DeploymentOutput on success.
4. A RunnerProfile owns the provider allowlist, credential references, state backend, and Cloudflare Container execution for the run.
5. Infrastructure lifecycle, credentials, OIDC clients, billing, domains, and account-plane policy belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state and run ledger evidence. Takosumi or another operator distribution owns account-plane policy, billing, OIDC, and the dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "repository": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

ApplyRun requests reference the reviewed PlanRun returned by the plan step. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/control-api)
